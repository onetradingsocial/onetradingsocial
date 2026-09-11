import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The trial's chokepoint (trialStartForSession, called from getEntitlements).
 *
 * The bug it closes: GoTrue confirms an email inside its own /verify endpoint
 * BEFORE redirecting to /auth/confirm. If the code exchange there fails — the
 * ordinary case being a confirmation email opened on a phone when the signup
 * happened on a laptop — the account is confirmed with no session and no
 * trial, and none of the three entry points ever runs for it again. Seen on dev
 * 2026-09-11 (confirmed 04:40:39, password sign-in 04:43:16, trial NULL).
 *
 * Properties tested, one per requirement:
 *   - confirmation-link failure, then password sign-in → the trial starts;
 *   - the 0041-skipped cohort signing in with a password → no trial, no write;
 *   - an existing trial → never restarted or extended, and costs no I/O;
 *   - every other session route reaches the chokepoint;
 *   - a normal authenticated request writes nothing;
 *   - someone ELSE's session (a public profile, a cron) never starts a trial.
 */

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const UID = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'
const MARKER_MISSING = { code: '42703', message: 'column profiles.trial_eligible does not exist' }

// ---------------------------------------------------------------------------
// A fake database holding one profile row, and the two clients that reach it:
// the service client (writes, and the reads getEntitlements makes) and the
// caller's session client (its JWT claims, and the subscriptions read).
// ---------------------------------------------------------------------------

type Profile = {
  trial_started_at: string | null
  trial_eligible?: boolean
  trial_ack_at?: string | null
  comp_tier?: string | null
  welcome_tier_seen?: string | null
  onboarding_completed?: boolean
}

function fakeDb(initial: Profile | undefined, opts: { markerMissing?: boolean } = {}) {
  let row = initial === undefined ? undefined : { ...initial }
  const calls = { reads: [] as string[], writes: [] as Record<string, unknown>[] }

  const svc = {
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { id, email: 'member@example.com' } }, error: null }),
      },
    },
    from(_table: string) {
      return {
        select(cols: string) {
          calls.reads.push(cols)
          let id: unknown
          const chain = {
            eq(_c: string, v: unknown) { id = v; return chain },
            maybeSingle() {
              if (opts.markerMissing && cols.includes('trial_eligible')) {
                return Promise.resolve({ data: null, error: MARKER_MISSING })
              }
              if (id !== UID || !row) return Promise.resolve({ data: null, error: null })
              return Promise.resolve({ data: { ...row }, error: null })
            },
          }
          return chain
        },
        update(values: Record<string, unknown>) {
          calls.writes.push(values)
          const f: [string, unknown][] = []
          const chain = {
            eq(c: string, v: unknown) { f.push([c, v]); return chain },
            is(c: string, v: unknown) {
              f.push([c, v])
              if (opts.markerMissing && f.some(([k]) => k === 'trial_eligible')) {
                return Promise.resolve({ error: MARKER_MISSING, count: null })
              }
              const matches = row !== undefined && f.every(([k, val]) =>
                k === 'id' ? val === UID : (row as Record<string, unknown>)[k] === val)
              if (matches) row = { ...row!, ...(values as { trial_started_at: string }) }
              return Promise.resolve({ error: null, count: matches ? 1 : 0 })
            },
          }
          return chain
        },
      }
    },
  }

  /** The caller's client. `sub` is whose session it holds; null = none. */
  const sessionFor = (sub: string | null) => {
    const claimsCalls = { n: 0 }
    const client = {
      auth: {
        getClaims: async () => {
          claimsCalls.n++
          return sub ? { data: { claims: { sub } }, error: null } : { data: null, error: null }
        },
      },
      from(_t: string) {
        // subscriptions: none — a Free account apart from its trial.
        const chain = {
          select() { return chain },
          eq() { return Promise.resolve({ data: [], error: null }) },
        }
        return chain
      },
    }
    return { client, claimsCalls }
  }

  return { svc, sessionFor, calls, current: () => row }
}

/** A client whose every touch fails the test — proves "no I/O at all". */
const untouchable = new Proxy({}, {
  get(_t, prop) { throw new Error(`unexpected access: ${String(prop)}`) },
})

let db: ReturnType<typeof fakeDb>
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.svc }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/server/feature-flags', () => ({ getFeatureFlags: async () => ({}) }))

import { trialStartForSession } from '@/lib/server/trial-start'
import { getEntitlements } from '@/lib/server/entitlements'

beforeEach(() => {
  delete process.env.ADMIN_EMAILS
})
afterEach(() => vi.restoreAllMocks())

// ---------------------------------------------------------------------------
// The bug, end to end through getEntitlements
// ---------------------------------------------------------------------------

describe('a confirmation link whose exchange failed, then a password sign-in', () => {
  // GoTrue confirmed the address at /verify; /auth/confirm never got a
  // session; the account was created after 0074, so 0075 marked it eligible.
  const stranded = (): Profile => ({
    trial_started_at: null, trial_eligible: true, onboarding_completed: false,
  })

  it('starts the trial on the first render after sign-in, and that render already shows it', async () => {
    db = fakeDb(stranded())
    const { client } = db.sessionFor(UID)
    const ent = await getEntitlements(client as never, UID)

    expect(db.current()?.trial_started_at).not.toBeNull()
    expect(db.calls.writes).toHaveLength(1)
    // Not "stamped now, visible next time": this very render is Pro, mid-trial.
    expect(ent.tier).toBe('pro')
    expect(ent.gate.state).toBe('active')
    expect(ent.gate.daysLeft).toBe(14)
  })

  it('is start-ONCE: the next request reads the stamp and writes nothing', async () => {
    db = fakeDb(stranded())
    const { client } = db.sessionFor(UID)
    await getEntitlements(client as never, UID)
    const first = db.current()?.trial_started_at
    await getEntitlements(client as never, UID)
    await getEntitlements(client as never, UID)
    expect(db.calls.writes).toHaveLength(1)
    expect(db.current()?.trial_started_at).toBe(first)
  })

  it('the layout and the page racing on the first render stamp exactly once, and agree', async () => {
    // RootLayout and e.g. /onboarding each call getEntitlements/getTier in
    // the same request. Both see null; the conditional write lets one win.
    db = fakeDb(stranded())
    const { client } = db.sessionFor(UID)
    const [a, b] = await Promise.all([
      getEntitlements(client as never, UID),
      getEntitlements(client as never, UID),
    ])
    expect(db.calls.writes.length).toBeLessThanOrEqual(2)
    expect(a.tier).toBe('pro')
    expect(b.tier).toBe('pro')
    expect(a.gate.daysLeft).toBe(b.gate.daysLeft)
    expect(db.current()?.trial_started_at).not.toBeNull()
  })
})

describe('the 0041-skipped cohort signing in with a password', () => {
  // An internal/seed account, or a then-live subscriber: trial null ON
  // PURPOSE, created before 0075 so the marker is false.
  const skipped = (): Profile => ({ trial_started_at: null, trial_eligible: false, onboarding_completed: true })

  it('gets no trial and causes NO write — on this request or any other', async () => {
    db = fakeDb(skipped())
    const { client } = db.sessionFor(UID)
    for (let i = 0; i < 5; i++) {
      const ent = await getEntitlements(client as never, UID)
      expect(ent.tier).toBe('free')
      expect(ent.gate.state).toBe('none')
      expect(ent.gate.showWall).toBe(false)
    }
    expect(db.calls.writes).toEqual([])
    expect(db.current()?.trial_started_at).toBeNull()
  })

  it('costs one marker read per lookup, never an UPDATE', async () => {
    db = fakeDb(skipped())
    const { client } = db.sessionFor(UID)
    await trialStartForSession(db.svc as never, client as never, UID, null)
    expect(db.calls.reads).toEqual(['trial_eligible'])
    expect(db.calls.writes).toEqual([])
  })

  it('even if the pre-read were bypassed, the write itself refuses it', async () => {
    // Belt and braces: the marker is also in the UPDATE's WHERE clause. Drive
    // the entry-point latch straight at a skipped row.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { startTrialIfUnstarted } = await import('@/lib/server/trial-start')
    db = fakeDb(skipped())
    expect(await startTrialIfUnstarted(db.svc as never, UID)).toBe('ineligible')
    expect(db.current()?.trial_started_at).toBeNull()
  })
})

describe('an account whose trial is already set', () => {
  it('is never restarted or extended, whatever its state', async () => {
    for (const started of [
      '2026-09-05T00:00:00.000Z', // active
      '2020-01-01T00:00:00.000Z', // long expired
    ]) {
      db = fakeDb({ trial_started_at: started, trial_eligible: true })
      const { client } = db.sessionFor(UID)
      await getEntitlements(client as never, UID)
      expect(db.current()?.trial_started_at).toBe(started)
      expect(db.calls.writes).toEqual([])
    }
  })

  it('a pre-0074 account (eligible false, trial set) is untouched too', async () => {
    db = fakeDb({ trial_started_at: '2026-08-01T00:00:00.000Z', trial_eligible: false })
    const { client } = db.sessionFor(UID)
    const ent = await getEntitlements(client as never, UID)
    expect(ent.gate.state).toBe('expired')
    expect(db.calls.writes).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// A normal authenticated request
// ---------------------------------------------------------------------------

describe('a normal authenticated request', () => {
  it('does no I/O at all in the chokepoint when the trial is set', async () => {
    // Both clients explode on any access: the check reads only what the
    // caller already loaded.
    const started = '2026-09-05T00:00:00.000Z'
    await expect(
      trialStartForSession(untouchable as never, untouchable as never, UID, started),
    ).resolves.toBe(started)
  })

  it('through getEntitlements: no write, no marker read, no JWT check', async () => {
    db = fakeDb({ trial_started_at: '2026-09-05T00:00:00.000Z', trial_eligible: true })
    const { client, claimsCalls } = db.sessionFor(UID)
    await getEntitlements(client as never, UID)
    expect(db.calls.writes).toEqual([])
    expect(db.calls.reads.some((c) => c.includes('trial_eligible'))).toBe(false)
    expect(claimsCalls.n).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Only the account's OWN session counts
// ---------------------------------------------------------------------------

describe('someone else looking is not a session', () => {
  it("a public profile reading its OWNER's tier does not start the owner's trial", async () => {
    // [username]/page.tsx: getTier(createServiceClient(), profileId) — a
    // service client holds no session at all.
    db = fakeDb({ trial_started_at: null, trial_eligible: true })
    const { client } = db.sessionFor(null)
    await getEntitlements(client as never, UID)
    expect(db.calls.writes).toEqual([])
    expect(db.current()?.trial_started_at).toBeNull()
  })

  it("a viewer's session asking about a different user does not start that user's trial", async () => {
    db = fakeDb({ trial_started_at: null, trial_eligible: true })
    const { client } = db.sessionFor(OTHER)
    await getEntitlements(client as never, UID)
    expect(db.calls.writes).toEqual([])
    // It did not even read the marker: the claims check comes first.
    expect(db.calls.reads.some((c) => c.includes('trial_eligible'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Before 0075 is applied (code first)
// ---------------------------------------------------------------------------

describe('running ahead of migration 0075', () => {
  it('the chokepoint stays off — no write, no error log, the render is unaffected', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db = fakeDb({ trial_started_at: null }, { markerMissing: true })
    const { client } = db.sessionFor(UID)
    const ent = await getEntitlements(client as never, UID)
    expect(ent.tier).toBe('free')
    expect(db.calls.writes).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Every route by which a session can first appear reaches the chokepoint
// ---------------------------------------------------------------------------

describe('every route by which a session first appears lands on a render that reaches the chokepoint', () => {
  it('the root layout runs getEntitlements for the signed-in user on every page', () => {
    // The chokepoint's reach is the layout's reach: every page render of an
    // authenticated user. If this ever stops being true, the routes below lose
    // their coverage.
    const src = read('app/src/app/layout.tsx')
    expect(src).toContain('const user = await getSessionUser(supabase)')
    expect(src).toMatch(/if \(user\) \{[\s\S]*getEntitlements\(supabase, user\.id\)/)
  })

  it('getEntitlements hands the chokepoint the caller\'s own client and the trial it loaded', () => {
    const src = read('app/src/lib/server/entitlements.ts')
    expect(src).toContain('trialStartForSession(svc, supabase, userId, prof.trial_started_at, now)')
    // And computes the tier and gate from the RESULT, not the stale load.
    expect(src).toContain('trialState(trialStartedAt, prof?.trial_ack_at, now)')
    expect(src).toContain('trialDaysLeft(trialStartedAt, now)')
    expect(src).not.toContain('trialState(prof?.trial_started_at')
  })

  const pageExists = (route: string) =>
    existsSync(join(ROOT, 'app/src/app', route === '/' ? '' : route, 'page.tsx'))

  it('password sign-in → redirects to a page', () => {
    const src = read('app/src/app/actions/auth.ts')
    const signIn = src.slice(src.indexOf('export async function signIn'))
    const body = signIn.slice(0, signIn.indexOf('export async function', 1))
    expect(body).toContain("redirect('/')")
    expect(pageExists('/')).toBe(true)
  })

  it('password reset (/auth/reset) → a page, and so does the password update after it', () => {
    expect(read('app/src/app/auth/reset/route.ts')).toContain("successPath: '/reset-password'")
    expect(pageExists('/reset-password')).toBe(true)
    const src = read('app/src/app/actions/auth.ts')
    expect(src).toContain("redirect('/?password=updated')")
  })

  it('magic link and email_change grants (/auth/confirm) → a page', () => {
    // Nothing in the app issues either today, but GoTrue can (the dashboard
    // sends both), and /auth/confirm redeems them. The OTP-type test there
    // declines to start a trial for them; the /welcome render after it runs
    // the chokepoint, where the marker decides.
    const src = read('app/src/app/auth/confirm/route.ts')
    expect(src).toContain("expectTypes: ['signup', 'invite', 'magiclink', 'email_change']")
    expect(src).toContain("successPath: '/welcome'")
    expect(pageExists('/welcome')).toBe(true)
  })

  it('Google sign-in on a NON-fresh account (/auth/callback) → a page', () => {
    // Confirmed by email on another device, then chose "Continue with Google":
    // isFreshAccount is false, so the callback does not stamp. The redirect
    // target is a render.
    const src = read('app/src/app/auth/callback/route.ts')
    expect(src).toContain('NextResponse.redirect(`${base}/`)')
  })

  it('the confirmation link itself, when its exchange fails, creates no session — nothing to cover', () => {
    // consumeGrant redirects to the error page without calling onSession; the
    // account's FIRST session is whichever of the routes above comes next.
    const src = read('app/src/lib/server/auth-grant.ts')
    const pkce = src.slice(src.indexOf('exchangeCodeForSession'))
    const failBranch = pkce.slice(0, pkce.indexOf('userId = data.user'))
    expect(failBranch).toContain("recoveryErrorRedirect('expired')")
    expect(failBranch).not.toContain('onSession')
  })
})
