// app/tests/unit/trade-delete.test.ts
//
// Guards for `deleteTrade` (src/app/actions/trade.ts).
//
// The action has existed and been unreachable since it was written — nothing
// called it, so nothing tested it. Wiring the button up makes both worth
// fixing, because the failure this action is built around is silent:
//
//   Migration 0053 narrowed `trades_delete` to `source = 'manual'`. A DELETE
//   refused by RLS does not error — PostgREST reports success having matched
//   zero rows. So the manual-only check in the action is not belt-and-braces;
//   it is the only reason a user who tries to delete a broker-synced trade
//   sees a message instead of a success that did nothing. If that check is
//   ever "simplified" away, these tests fail rather than production going
//   quietly wrong.
//
// Mocking style follows tests/unit/trade-edit.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const UID = '11111111-2222-4333-8444-555555555555'

const getUser = vi.fn(async () => ({ data: { user: { id: UID, email: 'a@b.co' } } }))
const selectRow = vi.fn<() => Promise<{ data: Record<string, unknown> | null; error: unknown }>>()
const deleteCalled = vi.fn()
const deleteError = vi.fn<() => unknown>(() => null)
const allowAction = vi.fn(async () => ({ ok: true }))
const revalidatePath = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: () => selectRow() }) }),
      }),
      delete: () => {
        deleteCalled()
        return { eq: () => ({ eq: async () => ({ error: deleteError() }) }) }
      },
    }),
  }),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {} }) }) }) }),
  }),
}))

vi.mock('@/lib/server/action-throttle', () => ({
  allowAction: (...args: unknown[]) => allowAction(...(args as [])),
  JOURNAL_BUDGET: { scope: 'act:journal', max: 60, windowMs: 600_000 },
  UPLOAD_BUDGET: { scope: 'act:upload', max: 20, windowMs: 600_000 },
}))

vi.mock('next/cache', () => ({ revalidatePath, revalidateTag: vi.fn() }))
vi.mock('@/lib/server/track', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ insertSystemNotification: vi.fn() }))
vi.mock('@/lib/server/referral', () => ({ markReferralActivated: vi.fn() }))
vi.mock('@/lib/server/entitlements', () => ({ getTier: async () => 'pro' }))
vi.mock('@/lib/server/feature-flags', () => ({ getFeatureFlags: async () => ({}) }))

async function deleteTrade(id: string) {
  const mod = await import('@/app/actions/trade')
  return mod.deleteTrade(id)
}

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: UID, email: 'a@b.co' } } })
  allowAction.mockResolvedValue({ ok: true })
  deleteError.mockReturnValue(null)
  selectRow.mockResolvedValue({ data: { source: 'manual' }, error: null })
})

describe('deleteTrade — manual trades', () => {
  it('deletes a manual trade and revalidates the journal', async () => {
    const res = await deleteTrade('t1')

    expect(res).toEqual({ ok: true })
    expect(deleteCalled).toHaveBeenCalledTimes(1)
    expect(revalidatePath).toHaveBeenCalledWith('/journal')
  })

  it('surfaces a delete error rather than reporting success', async () => {
    deleteError.mockReturnValue({ message: 'connection reset' })

    expect(await deleteTrade('t1')).toEqual({ error: 'connection reset' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('deleteTrade — imported trades', () => {
  // The whole point of the pre-read. Without it RLS refuses the DELETE, the
  // client is told it succeeded, and the trade is still there on refresh.
  for (const source of ['broker', 'statement'] as const) {
    it(`refuses a ${source} trade without attempting the delete`, async () => {
      selectRow.mockResolvedValue({ data: { source }, error: null })

      const res = await deleteTrade('t1')

      expect(res.error).toMatch(/Imported trades cannot be deleted/)
      expect(res.ok).toBeUndefined()
      expect(deleteCalled).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  }
})

describe('deleteTrade — refusals', () => {
  it('treats a foreign or missing id as not found', async () => {
    // The read is scoped `.eq('user_id', user.id)`, so somebody else's trade
    // and a deleted one are indistinguishable — deliberately.
    selectRow.mockResolvedValue({ data: null, error: null })

    expect(await deleteTrade('t-someone-else')).toEqual({ error: 'Trade not found.' })
    expect(deleteCalled).not.toHaveBeenCalled()
  })

  it('requires a signed-in user', async () => {
    getUser.mockResolvedValue({ data: { user: null } } as never)

    expect(await deleteTrade('t1')).toEqual({ error: 'Not authenticated.' })
    expect(deleteCalled).not.toHaveBeenCalled()
  })

  it('respects the journal throttle', async () => {
    allowAction.mockResolvedValue({ ok: false, message: 'Too many journal actions.' } as never)

    expect(await deleteTrade('t1')).toEqual({ error: 'Too many journal actions.' })
    expect(deleteCalled).not.toHaveBeenCalled()
  })
})
