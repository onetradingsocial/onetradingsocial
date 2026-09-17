// app/tests/unit/mt5-sync-entitlement-counts.test.ts
//
// mt5-sync.yml fails the run when `deployed < total` (or `synced < total`).
// From 2026-09-14 it failed every hour because a user whose plan lapsed was
// counted as a failed deploy — which also buried the real failure beside it.
// An account skipped for lack of entitlement must not be in `total`; a genuine
// deploy error still must.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rows = [
  { id: 'b1', user_id: 'paying', metaapi_account_id: 'm1' },
  { id: 'b2', user_id: 'lapsed', metaapi_account_id: 'm2' },
]
const updates: Array<Record<string, unknown>> = []

vi.mock('@/lib/cron', () => ({ authorizedCron: () => true }))
vi.mock('@/lib/market-hours', () => ({ isForexOpen: () => true }))
vi.mock('@/lib/server/feature-flags', () => ({ getFeatureFlags: async () => ({}) }))
vi.mock('@/lib/feature-flags', () => ({ canFlag: (_f: unknown, tier: string) => tier === 'pro' }))
vi.mock('@/lib/server/entitlements', () => ({
  getTier: async (_svc: unknown, uid: string) => (uid === 'paying' ? 'pro' : 'free'),
}))

const isAccountRunning = vi.fn(async () => false)
const deployAccount = vi.fn<(id: string) => Promise<{ ok: true } | { error: string }>>(async () => ({ ok: true }))
vi.mock('@/lib/server/metaapi', () => ({
  isAccountRunning: () => isAccountRunning(),
  deployAccount: (id: string) => deployAccount(id),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({ in: async () => ({ data: rows, error: null }) }),
      update: (p: Record<string, unknown>) => { updates.push(p); return { eq: async () => ({ error: null }) } },
    }),
  }),
}))

async function deploy() {
  const mod = await import('@/app/api/mt5-sync/deploy/route')
  const res = await mod.GET(new Request('https://app.example.com/api/mt5-sync/deploy'))
  return res.json() as Promise<{ deployed: number; total: number; notEntitled: number }>
}

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
})

describe('mt5-sync deploy counts', () => {
  it('leaves a lapsed plan out of total, so a healthy run is not red', async () => {
    expect(await deploy()).toEqual({ deployed: 1, total: 1, notEntitled: 1 })
    // Still recorded on the account for the owner and the admin panel.
    expect(updates.some((u) => u.sync_error === 'Pro plan required for auto-sync.')).toBe(true)
    // Never deployed: no start fee for someone who is not paying.
    expect(deployAccount).toHaveBeenCalledTimes(1)
  })

  it('still counts a real deploy failure against total', async () => {
    deployAccount.mockResolvedValueOnce({ error: 'To allow trading account deployment please top up your account.' })
    const out = await deploy()
    expect(out.total).toBe(1)
    expect(out.deployed).toBeLessThan(out.total)
  })
})
