// app/tests/unit/oauth-signup.test.ts
//
// `signup_completed` had exactly one emitter — the email/password action — so
// the Google half of the funnel was invisible. Over the audited 30-day window:
// 11 genuine profiles, 4 email and 7 Google; the event fired 4 times. Every
// bar below it was being measured against a denominator that counted one of
// the two ways in, which is where "225% onboarding completion" came from.
//
// The emitter cannot be unconditional: /auth/callback serves login as well as
// signup and cannot tell them apart, and the funnel counts ROWS, so a returning
// Google user firing signup_completed on every sign-in would be a worse number
// than the missing one. Both guards are pinned here.
//
// Mocking style follows tests/unit/billing-checkout-retry.test.ts: mock the
// server-only edge (trackServer) and let the module's own logic run.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const trackServer = vi.fn(async () => {})
vi.mock('@/lib/server/track', () => ({ trackServer }))

const UID = '11111111-2222-4333-8444-555555555555'
const NOW = Date.parse('2026-09-09T12:00:00.000Z')

/** Minimal PostgREST shape for the one query the module makes: the
 *  already-emitted lookup. `rows` is what that lookup finds. */
const fakeSvc = (rows: unknown[] = [], onQuery?: () => void) => ({
  from: () => {
    const b: Record<string, unknown> = {}
    const self = () => b
    for (const m of ['select', 'eq']) b[m] = self
    b.limit = async () => { onQuery?.(); return { data: rows, error: null } }
    return b
  },
}) as never

const user = (over: Record<string, unknown> = {}) => ({
  id: UID,
  email: 'trader@example.com',
  created_at: new Date(NOW - 3_000).toISOString(), // seconds old: this callback IS the signup
  app_metadata: { provider: 'google' },
  ...over,
})

async function mod() {
  return import('@/lib/server/oauth-signup')
}

beforeEach(() => { trackServer.mockClear() })

describe('isFreshAccount — "this callback is the signup, not a login"', () => {
  it('accepts an account created seconds ago', async () => {
    const { isFreshAccount } = await mod()
    expect(isFreshAccount(new Date(NOW - 3_000).toISOString(), NOW)).toBe(true)
  })

  it('rejects an account that predates the window', async () => {
    const { isFreshAccount, OAUTH_SIGNUP_WINDOW_MS } = await mod()
    expect(isFreshAccount(new Date(NOW - OAUTH_SIGNUP_WINDOW_MS - 1).toISOString(), NOW)).toBe(false)
    // The case that matters: every Google account that signed up before this
    // code existed. Backfilling those as fresh signups would be worse than the
    // undercount it replaces.
    expect(isFreshAccount('2026-06-01T00:00:00.000Z', NOW)).toBe(false)
  })

  it('tolerates the database clock running slightly ahead of Node', async () => {
    // A created_at a few seconds in the future must not read as "old".
    expect((await mod()).isFreshAccount(new Date(NOW + 5_000).toISOString(), NOW)).toBe(true)
    // But not an arbitrary future timestamp.
    expect((await mod()).isFreshAccount(new Date(NOW + 3_600_000).toISOString(), NOW)).toBe(false)
  })

  it('rejects a missing or unparseable timestamp rather than guessing', async () => {
    const { isFreshAccount } = await mod()
    expect(isFreshAccount(undefined, NOW)).toBe(false)
    expect(isFreshAccount(null, NOW)).toBe(false)
    expect(isFreshAccount('not-a-date', NOW)).toBe(false)
  })
})

describe('trackOAuthSignup', () => {
  it('emits for a brand-new Google account', async () => {
    const { trackOAuthSignup } = await mod()
    const fired = await trackOAuthSignup(fakeSvc(), user(), {
      source: 'spring-campaign', confirmed: true, now: NOW,
    })
    expect(fired).toBe(true)
    expect(trackServer).toHaveBeenCalledTimes(1)
    const [event, who, props] = trackServer.mock.calls[0] as unknown as [string, unknown, Record<string, unknown>]
    expect(event).toBe('signup_completed')
    // The user must be passed through: trackServer stamps is_internal from it.
    expect(who).toEqual({ id: UID, email: 'trader@example.com' })
    // Props shape matches the email emitter in actions/auth.ts, so the two
    // paths are queryable together — same keys, `method` the discriminator.
    expect(props).toEqual({ method: 'google', source: 'spring-campaign', confirmed: true })
  })

  it('does not emit on a returning user signing in again', async () => {
    const { trackOAuthSignup } = await mod()
    const fired = await trackOAuthSignup(
      fakeSvc(), user({ created_at: '2026-07-01T00:00:00.000Z' }),
      { source: null, confirmed: true, now: NOW },
    )
    expect(fired).toBe(false)
    expect(trackServer).not.toHaveBeenCalled()
  })

  it('does not emit twice for the same user inside the window', async () => {
    // Sign out and straight back in: the clock test alone would let this
    // through, and the funnel counts rows.
    const { trackOAuthSignup } = await mod()
    const fired = await trackOAuthSignup(fakeSvc([{ id: 'existing-event' }]), user(), {
      source: null, confirmed: true, now: NOW,
    })
    expect(fired).toBe(false)
    expect(trackServer).not.toHaveBeenCalled()
  })

  it('skips the lookup entirely when the account is not new', async () => {
    // The old-account case is every sign-in on the platform; it must not cost
    // a query on the hot path.
    const queried = vi.fn()
    const { trackOAuthSignup } = await mod()
    await trackOAuthSignup(
      fakeSvc([], queried), user({ created_at: '2026-07-01T00:00:00.000Z' }),
      { source: null, confirmed: true, now: NOW },
    )
    expect(queried).not.toHaveBeenCalled()
  })

  it('falls back to a generic method if the provider is missing', async () => {
    const { trackOAuthSignup } = await mod()
    await trackOAuthSignup(fakeSvc(), user({ app_metadata: null }), {
      source: null, confirmed: true, now: NOW,
    })
    const props = (trackServer.mock.calls[0] as unknown as unknown[])[2] as Record<string, unknown>
    expect(props.method).toBe('oauth')
  })

  it('never throws — the sign-in redirect does not depend on analytics', async () => {
    const exploding = { from: () => { throw new Error('supabase down') } } as never
    const { trackOAuthSignup } = await mod()
    await expect(trackOAuthSignup(exploding, user(), { source: null, confirmed: true, now: NOW }))
      .resolves.toBe(false)
  })
})

describe('the callback route wires it up', () => {
  it('calls trackOAuthSignup with the ts_ref cookie and the session flag', async () => {
    // Structural: the route is a thin Next handler, and what can regress is the
    // wiring, not the logic above.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'app/src/app/auth/callback/route.ts'), 'utf8',
    )
    expect(src).toContain('trackOAuthSignup')
    expect(src).toContain("request.cookies.get('ts_ref')")
    expect(src).toContain('confirmed: !!data.session')
    // Reuses the service client already built for recordTermsAcceptance.
    expect(src.match(/createServiceClient\(\)/g)).toHaveLength(1)
  })
})
