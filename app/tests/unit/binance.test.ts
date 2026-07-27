import { describe, it, expect } from 'vitest'
import { verifyReadOnly, type BinanceClient } from '@/lib/server/binance'
import { fetchFillsSince } from '@/lib/server/binance'
import type { Fill } from '@/lib/crypto/fills'

// A fake CCXT-like client whose apiRestrictions payload we control.
const clientWith = (restrictions: Record<string, unknown>): BinanceClient => ({
  fetchMyTrades: async () => [],
  sapiGetAccountApiRestrictions: async () => restrictions,
})

const READ_ONLY = {
  enableReading: true,
  enableWithdrawals: false,
  enableInternalTransfer: false,
  enableSpotAndMarginTrading: false,
  enableFutures: false,
  enableMargin: false,
}

describe('verifyReadOnly', () => {
  it('accepts a strictly read-only key', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' }, clientWith(READ_ONLY))
    expect(res).toEqual({ ok: true })
  })

  it('rejects a key that can withdraw', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith({ ...READ_ONLY, enableWithdrawals: true }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/trade or move funds/i)
  })

  it('rejects a key that can trade spot/margin', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith({ ...READ_ONLY, enableSpotAndMarginTrading: true }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/trade/i)
  })

  it('rejects a key that can trade futures', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith({ ...READ_ONLY, enableFutures: true }))
    expect(res.ok).toBe(false)
  })

  it('rejects a key that can make internal transfers', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith({ ...READ_ONLY, enableInternalTransfer: true }))
    expect(res.ok).toBe(false)
  })

  it('rejects a key with universal transfer permission', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith({ ...READ_ONLY, permitsUniversalTransfer: true }))
    expect(res.ok).toBe(false)
  })

  it('rejects a key that can trade vanilla options', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith({ ...READ_ONLY, enableVanillaOptions: true }))
    expect(res.ok).toBe(false)
  })

  it('rejects a key without read permission', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith({ ...READ_ONLY, enableReading: false }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/read/i)
  })

  it('rejects a key with no enableReading field at all', async () => {
    const { enableReading: _enableReading, ...withoutReading } = READ_ONLY
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith(withoutReading))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/read/i)
  })

  it('reports a read failure without leaking the key', async () => {
    const throwing: BinanceClient = {
      fetchMyTrades: async () => [],
      sapiGetAccountApiRestrictions: async () => { throw new Error('Invalid Api-Key ID') },
    }
    const res = await verifyReadOnly({ apiKey: 'SECRET_KEY', apiSecret: 's' }, throwing)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).not.toContain('SECRET_KEY')
      expect(res.reason).toMatch(/could not|check/i)
    }
  })
})

// A CCXT trade object (the fields fetchFillsSince reads).
const ccxtTrade = (o: Partial<{ id: string; timestamp: number; side: string; price: number; amount: number; fee: unknown }>) => ({
  id: 'x', timestamp: 1_000, symbol: 'BTC/USDT', side: 'buy', price: 100, amount: 1,
  fee: { cost: 0.1, currency: 'USDT' }, ...o,
})

// Fake client that returns a scripted page per call, then empties.
const pagingClient = (pages: unknown[][]): BinanceClient => {
  let i = 0
  return {
    sapiGetAccountApiRestrictions: async () => ({}),
    fetchMyTrades: async () => (i < pages.length ? pages[i++] : []),
  }
}

// Fake client modeling the millisecond-boundary case: the first "page" is
// capped at 2 items (simulating hitting the exchange's page limit) even
// though a third fill ('c') shares the same millisecond as the page's last
// fill ('b'). Every call after the first actually honors `since` (ms
// granularity, inclusive) like the real exchange would, so it re-returns any
// same-ms siblings until the caller's cursor moves past that millisecond.
const boundaryClient = (): BinanceClient => {
  const store = [
    ccxtTrade({ id: 'a', timestamp: 5 }),
    ccxtTrade({ id: 'b', timestamp: 10 }),
    ccxtTrade({ id: 'c', timestamp: 10 }), // shares 'b' timestamp; dropped by an exclusive (+1) cursor
  ]
  let calls = 0
  return {
    sapiGetAccountApiRestrictions: async () => ({}),
    fetchMyTrades: async (_symbol: string, since?: number) => {
      calls += 1
      if (calls === 1) return [store[0], store[1]] // simulated page cap: 'c' held back
      return store.filter((t) => t.timestamp >= (since ?? 0))
    },
  }
}

describe('fetchFillsSince', () => {
  it('normalizes a ccxt trade into a Fill', async () => {
    const fills = await fetchFillsSince({ apiKey: 'k', apiSecret: 's' }, 'BTC/USDT', null,
      pagingClient([[ccxtTrade({ id: 'a', timestamp: 5, side: 'sell', price: 110, amount: 2 })]]))
    expect(fills).toHaveLength(1)
    const f: Fill = fills[0]
    expect(f).toEqual({
      id: 'a', symbol: 'BTC/USDT', timestamp: 5, side: 'sell', price: 110, amount: 2,
      fee: { cost: 0.1, currency: 'USDT' },
    })
  })

  it('pages forward until an empty page and concatenates', async () => {
    const fills = await fetchFillsSince({ apiKey: 'k', apiSecret: 's' }, 'BTC/USDT', 0,
      pagingClient([
        [ccxtTrade({ id: 'a', timestamp: 10 }), ccxtTrade({ id: 'b', timestamp: 20 })],
        [ccxtTrade({ id: 'c', timestamp: 30 })],
      ]))
    expect(fills.map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('stops paging when a page repeats the last id (no forward progress)', async () => {
    const t = ccxtTrade({ id: 'a', timestamp: 10 })
    const fills = await fetchFillsSince({ apiKey: 'k', apiSecret: 's' }, 'BTC/USDT', 0,
      pagingClient([[t], [t]]))
    expect(fills.map((f) => f.id)).toEqual(['a'])
  })

  it('captures a fill sharing a timestamp with the prior page boundary (inclusive cursor)', async () => {
    const fills = await fetchFillsSince({ apiKey: 'k', apiSecret: 's' }, 'BTC/USDT', 0, boundaryClient())
    expect(fills.map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })
})
