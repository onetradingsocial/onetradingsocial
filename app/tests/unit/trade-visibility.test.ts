// app/tests/unit/trade-visibility.test.ts
//
// Guards the default visibility of a newly logged trade.
//
// Publishing a trade is the one journal decision that cannot be reversed: once
// the trade is closed, `updateTrade` refuses to take it private again
// (VISIBILITY_ONE_WAY), so that a bad week cannot be lifted off the leaderboard
// after the result is known. That rule is right, and it is exactly why the
// default has to point the other way. The fastest path in the product — Quick
// Trade Capture — carries instrument, entry, exit, size and P/L, and it used to
// arrive at the server pre-set to Public.
//
// Two things were wrong and both are covered here:
//
//   1. The modal keyed its default on `profiles.is_public`, which means "my
//      profile is discoverable" and defaults to true. A user who wanted to be
//      findable — the whole point of the social product — was opted into
//      publishing every trade they logged.
//   2. The server fell back to the same profile flag when the field was absent,
//      so a hand-built request, or any form that dropped the field, published.
//
// Neither failed loudly. The trade saved, the toast said saved, and the row was
// public. Mocking style follows tests/unit/trade-edit.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const UID = '11111111-2222-4333-8444-555555555555'

// --- the edges -------------------------------------------------------------

const getUser = vi.fn(async () => ({ data: { user: { id: UID, email: 'a@b.co' } } }))
const insertPayload = vi.fn<(p: Record<string, unknown>) => void>()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        insertPayload(payload)
        return { select: () => ({ single: async () => ({ data: { id: 't1' }, error: null }) }) }
      },
      // The activation-count read that follows the insert.
      select: () => ({ eq: async () => ({ count: 2 }) }),
    }),
  }),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { account_balance: 16000 } }) }) }),
    }),
  }),
}))

vi.mock('@/lib/server/action-throttle', () => ({
  allowAction: async () => ({ ok: true }),
  JOURNAL_BUDGET: { scope: 'act:journal', max: 60, windowMs: 600_000 },
  UPLOAD_BUDGET: { scope: 'act:upload', max: 20, windowMs: 600_000 },
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/server/track', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ insertSystemNotification: vi.fn() }))
vi.mock('@/lib/server/referral', () => ({ markReferralActivated: vi.fn() }))
vi.mock('@/lib/server/entitlements', () => ({ getTier: async () => 'pro' }))
vi.mock('@/lib/server/feature-flags', () => ({ getFeatureFlags: async () => ({}) }))

async function createTrade(fd: FormData) {
  const mod = await import('@/app/actions/trade')
  return mod.createTrade({}, fd)
}

/** The execution half of a valid manual log — EUR/USD, 50-pip stop, still open. */
function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData()
  const fields: Record<string, string> = {
    market: 'forex',
    instrument: 'EUR/USD',
    direction: 'long',
    sizing_mode: 'risk_percent',
    entry_price: '1.0856',
    stop_price: '1.0806',
    risk_percent: '1',
    ...over,
  }
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  insertPayload.mockClear()
})

describe('createTrade — visibility', () => {
  it('keeps a trade private when the form does not say', async () => {
    // The floor under the modal. A caller that says nothing must get the
    // outcome that can still be changed later, not the one that cannot.
    const res = await createTrade(form())
    expect(res.ok).toBe(true)
    expect(insertPayload.mock.calls[0][0].is_public).toBe(false)
  })

  it('keeps a trade private when the form says private', async () => {
    await createTrade(form({ is_public: 'private' }))
    expect(insertPayload.mock.calls[0][0].is_public).toBe(false)
  })

  it('publishes only on an explicit public', async () => {
    await createTrade(form({ is_public: 'public' }))
    expect(insertPayload.mock.calls[0][0].is_public).toBe(true)
  })

  it('ignores a value it does not recognise', async () => {
    // Anything that is not the word "public" is not consent to publish.
    await createTrade(form({ is_public: 'yes' }))
    expect(insertPayload.mock.calls[0][0].is_public).toBe(false)
  })
})

describe('the control that produces that form field', () => {
  // The action test above cannot see what the modal pre-selects, and the
  // original bug lived there: the server default was only ever reached when the
  // field was missing, which the modal never does.
  const MODAL = readFileSync(
    join(process.cwd(), 'src', 'app', '_components', 'TradeModalProvider.tsx'),
    'utf8',
  )

  it('defaults the visibility select to private', () => {
    const select = MODAL.slice(MODAL.indexOf('name="is_public"'))
    const decl = select.slice(0, select.indexOf('>'))
    expect(
      decl.includes('defaultValue="private"'),
      'The Quick Trade Capture visibility select must default to private. It is ' +
      'the fastest path in the product and it carries entry, exit, size and P/L, ' +
      'and publishing cannot be undone once the trade is closed.',
    ).toBe(true)
  })

  it('does not key the default on the profile visibility flag', () => {
    // `profiles.is_public` means "my profile is discoverable" and defaults to
    // true. Reading it here is what published a public-profile user's trades.
    expect(
      /defaultPublic/.test(MODAL),
      'The trade visibility default must not be derived from the profile flag — ' +
      'wanting to be findable is not the same decision as publishing every trade.',
    ).toBe(false)
  })
})
