import { describe, it, expect } from 'vitest'
import { planImport } from '@/lib/server/crypto-sync'
import type { Fill } from '@/lib/crypto/fills'

const f = (o: Partial<Fill> & { id: string; side: 'buy' | 'sell'; price: number; amount: number; timestamp: number }): Fill => ({
  symbol: 'BTC/USDT', ...o,
})

describe('planImport', () => {
  it('rolls a closed cycle into one prefixed, broker-sourced row', () => {
    const res = planImport([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1000 }),
      f({ id: '2', side: 'sell', price: 110, amount: 1, timestamp: 2000 }),
    ], { userId: 'u1', isPublic: true, exchange: 'binance' })
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0]).toMatchObject({
      user_id: 'u1', broker_deal_id: 'binance:2', source: 'broker',
      instrument: 'BTC/USD', pnl_amount: 10, status: 'closed',
    })
  })

  it('reports the cursor as the max fill timestamp', () => {
    const res = planImport([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1000 }),
      f({ id: '2', side: 'sell', price: 110, amount: 1, timestamp: 5000 }),
    ], { userId: 'u1', isPublic: true, exchange: 'binance' })
    expect(res.cursor).toBe(5000)
  })

  it('emits no rows and a null cursor for no fills', () => {
    const res = planImport([], { userId: 'u1', isPublic: true, exchange: 'binance' })
    expect(res.rows).toEqual([])
    expect(res.cursor).toBeNull()
  })

  it('still advances the cursor when fills are all still-open (no closed cycle)', () => {
    const res = planImport([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 4000 }),
    ], { userId: 'u1', isPublic: true, exchange: 'binance' })
    expect(res.rows).toEqual([])
    expect(res.cursor).toBe(4000) // so the open position isn't re-fetched from scratch next run
  })
})

import { syncExchangeAccount, type ExchangeRow } from '@/lib/server/crypto-sync'
import type { SupabaseClient } from '@supabase/supabase-js'

// Minimal fake service client capturing upserts + row updates.
function fakeSvc() {
  const calls = { upserted: [] as Record<string, unknown>[], updated: [] as Record<string, unknown>[] }
  const svc = {
    from(table: string) {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { is_public: true } }) }) }) }
      }
      if (table === 'trades') {
        return { upsert: (rows: Record<string, unknown>[]) => ({ select: async () => { calls.upserted.push(...rows); return { data: rows.map((_, i) => ({ id: `t${i}` })), error: null } } }) }
      }
      if (table === 'exchange_accounts') {
        return { update: (patch: Record<string, unknown>) => ({ eq: async () => { calls.updated.push(patch); return { error: null } } }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as unknown as SupabaseClient
  return { svc, calls }
}

const row = (o: Partial<ExchangeRow> = {}): ExchangeRow => ({
  id: 'row1', user_id: 'u1', exchange: 'binance',
  api_key_enc: 'KENC', api_secret_enc: 'SENC',
  symbols: ['BTC/USDT'], last_fill_at: null, ...o,
})

const okDeps = (fills: Parameters<typeof import('@/lib/crypto/fills')['rollupFills']>[0]) => ({
  decryptSecret: async (enc: string) => (enc === 'KENC' ? 'apikey' : 'apisecret'),
  fetchFillsSince: async () => fills,
  insertSystemNotification: async () => {},
})

describe('syncExchangeAccount', () => {
  it('imports fills, advances the cursor, and reports the count', async () => {
    const { svc, calls } = fakeSvc()
    const notes: string[] = []
    const res = await syncExchangeAccount(svc, row(), {
      ...okDeps([
        { id: '1', symbol: 'BTC/USDT', side: 'buy', price: 100, amount: 1, timestamp: 1000 },
        { id: '2', symbol: 'BTC/USDT', side: 'sell', price: 110, amount: 1, timestamp: 5000 },
      ]),
      insertSystemNotification: async (a) => { notes.push(a.type) },
    })
    expect(res).toEqual({ imported: 1 })
    expect(calls.upserted[0]).toMatchObject({ broker_deal_id: 'binance:2' })
    // cursor persisted as an ISO string of the max fill ts (5000ms)
    expect(calls.updated.at(-1)).toMatchObject({ status: 'active', sync_error: null })
    expect(String(calls.updated.at(-1)!.last_fill_at)).toBe(new Date(5000).toISOString())
    expect(notes).toContain('import_done')
  })

  it('on a fetch failure sets error status, notifies, and returns an error', async () => {
    const { svc, calls } = fakeSvc()
    const notes: string[] = []
    const res = await syncExchangeAccount(svc, row(), {
      decryptSecret: async () => 'x',
      fetchFillsSince: async () => { throw new Error('451 unavailable') },
      insertSystemNotification: async (a) => { notes.push(a.type) },
    })
    expect('error' in res).toBe(true)
    expect(calls.updated.at(-1)).toMatchObject({ status: 'error' })
    expect(notes).toContain('sync_failed')
  })
})
