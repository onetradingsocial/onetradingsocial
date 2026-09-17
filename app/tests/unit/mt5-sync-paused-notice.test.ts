// app/tests/unit/mt5-sync-paused-notice.test.ts
//
// A user whose plan stops including MT5 auto-sync used to get "Broker sync
// failed — reconnect to keep verifying" on the first hourly skip and then once
// a day, indefinitely (one real user from 2026-09-14). Nothing had failed. They
// now get ONE 'sync_paused' notice per lapse, and a real failure still gets
// 'sync_failed'.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
let accounts: Row[] = []
let priorNotices: Array<{ type: string; created_at: string }> = []
const noticeQueries: Array<{ type?: string; since?: string }> = []

function fakeFrom(table: string) {
  const filters: Record<string, unknown> = {}
  const result = () => {
    if (table === 'broker_accounts') return { data: accounts, error: null }
    if (table === 'notifications') {
      noticeQueries.push({ type: filters.type as string, since: filters.since as string | undefined })
      const hit = priorNotices.filter((n) =>
        n.type === filters.type && (!filters.since || n.created_at >= (filters.since as string)))
      return { data: hit.map(() => ({ id: 'n' })), error: null }
    }
    return { data: null, error: null }
  }
  const b: Record<string, unknown> = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(result()).then(res, rej)
      if (prop === 'eq') return (col: string, v: unknown) => { filters[col] = v; return b }
      if (prop === 'gte') return (_c: string, v: unknown) => { filters.since = v; return b }
      if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null })
      return () => b
    },
  })
  return b
}

vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: fakeFrom }) }))
vi.mock('@/lib/cron', () => ({ authorizedCron: () => true }))
vi.mock('@/lib/market-hours', () => ({ isForexOpen: () => true }))
vi.mock('@/lib/server/feature-flags', () => ({ getFeatureFlags: async () => ({}) }))
vi.mock('@/lib/feature-flags', () => ({ canFlag: (_f: unknown, tier: string) => tier === 'pro' }))
vi.mock('@/lib/server/entitlements', () => ({
  getTier: async (_s: unknown, uid: string) => (uid === 'lapsed' ? 'free' : 'pro'),
}))
const fetchDealsSince = vi.fn(async () => ({ error: 'upstream timeout' }) as { error: string } | { deals: unknown[] })
vi.mock('@/lib/server/metaapi', () => ({
  undeployAccount: vi.fn(async () => ({})),
  fetchDealsSince: () => fetchDealsSince(),
}))
vi.mock('@/lib/server/track', () => ({ trackServer: vi.fn(async () => {}) }))
const notices: Array<{ userId: string; type: string }> = []
vi.mock('@/lib/notifications', () => ({
  insertSystemNotification: async (a: { userId: string; type: string }) => { notices.push({ userId: a.userId, type: a.type }) },
}))

async function collect() {
  const mod = await import('@/app/api/mt5-sync/collect/route')
  await mod.GET(new Request('https://app.example.com/api/mt5-sync/collect'))
}

const account = (user_id: string, over: Row = {}): Row => ({
  id: `b-${user_id}`, user_id, metaapi_account_id: 'm', region: 'london', last_deal_time: null,
  created_at: '2026-09-01T00:00:00Z', status: 'active', sync_error_phase: null, sync_error_at: null,
  last_sync_at: '2026-09-14T06:10:39Z', ...over,
})

beforeEach(() => {
  accounts = []
  priorNotices = []
  notices.length = 0
  noticeQueries.length = 0
})

describe('lapsed plan: one sync_paused notice per lapse', () => {
  it('sends sync_paused, not sync_failed, the first time', async () => {
    accounts = [account('lapsed')]
    await collect()
    expect(notices).toEqual([{ userId: 'lapsed', type: 'sync_paused' }])
  })

  it('does not repeat while the same lapse continues — even a day later', async () => {
    accounts = [account('lapsed', { status: 'error' })]
    priorNotices = [{ type: 'sync_paused', created_at: '2026-09-14T07:10:00Z' }]
    await collect()
    expect(notices).toEqual([])
    // Scoped to notices since the last successful sync, so a later lapse notifies again.
    expect(noticeQueries).toContainEqual({ type: 'sync_paused', since: '2026-09-14T06:10:39Z' })
  })

  it('notifies again after an upgrade synced and the plan lapsed a second time', async () => {
    accounts = [account('lapsed', { last_sync_at: '2026-10-20T10:10:00Z' })]
    priorNotices = [{ type: 'sync_paused', created_at: '2026-09-14T07:10:00Z' }]
    await collect()
    expect(notices).toEqual([{ userId: 'lapsed', type: 'sync_paused' }])
  })
})

describe('a real failure is unchanged', () => {
  it('still sends sync_failed when a paying account cannot fetch', async () => {
    accounts = [account('paying')]
    await collect()
    expect(notices).toEqual([{ userId: 'paying', type: 'sync_failed' }])
  })
})
