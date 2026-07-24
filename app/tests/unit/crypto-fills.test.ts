import { describe, it, expect } from 'vitest'
import { rollupFills, type Fill } from '@/lib/crypto/fills'

const f = (o: Partial<Fill> & { id: string; side: 'buy' | 'sell'; price: number; amount: number }): Fill => ({
  symbol: 'BTC/USDT', timestamp: Date.parse('2026-07-01T00:00:00Z'), ...o,
})

describe('rollupFills', () => {
  it('emits one long cycle from a buy then a sell', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 2, timestamp: 1_000 }),
      f({ id: '2', side: 'sell', price: 110, amount: 2, timestamp: 2_000 }),
    ])
    expect(res.skippedOpen).toBe(0)
    expect(res.warnings).toEqual([])
    expect(res.cycles).toHaveLength(1)
    expect(res.cycles[0]).toMatchObject({
      dedupeId: '2', symbol: 'BTC/USDT', direction: 'long',
      size: 2, entryPrice: 100, exitPrice: 110, fees: 0, pnl: 20,
      openedAt: '1970-01-01T00:00:01.000Z', closedAt: '1970-01-01T00:00:02.000Z',
    })
  })

  it('weights entry and exit across multiple fills', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1 }),
      f({ id: '2', side: 'buy', price: 200, amount: 1, timestamp: 2 }),
      f({ id: '3', side: 'sell', price: 300, amount: 1, timestamp: 3 }),
      f({ id: '4', side: 'sell', price: 100, amount: 1, timestamp: 4 }),
    ])
    expect(res.cycles).toHaveLength(1)
    expect(res.cycles[0].entryPrice).toBeCloseTo(150)
    expect(res.cycles[0].exitPrice).toBeCloseTo(200)
    expect(res.cycles[0].pnl).toBeCloseTo(100)
    expect(res.cycles[0].dedupeId).toBe('4')
  })

  it('handles a short cycle (sell first)', () => {
    const res = rollupFills([
      f({ id: '1', side: 'sell', price: 110, amount: 2, timestamp: 1 }),
      f({ id: '2', side: 'buy', price: 100, amount: 2, timestamp: 2 }),
    ])
    expect(res.cycles[0]).toMatchObject({ direction: 'short', entryPrice: 110, exitPrice: 100 })
    expect(res.cycles[0].pnl).toBeCloseTo(20)
  })

  it('splits a fill that flips through zero and apportions its fee', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 2, timestamp: 1 }),
      f({ id: '2', side: 'sell', price: 110, amount: 3, timestamp: 2, fee: { cost: 3, currency: 'USDT' } }),
      f({ id: '3', side: 'buy', price: 105, amount: 1, timestamp: 3 }),
    ])
    expect(res.cycles).toHaveLength(2)
    expect(res.cycles[0]).toMatchObject({ direction: 'long', size: 2, dedupeId: '2' })
    expect(res.cycles[0].fees).toBeCloseTo(2)      // 2 of the 3 units
    expect(res.cycles[0].pnl).toBeCloseTo(18)      // 20 gross - 2 fee
    expect(res.cycles[1]).toMatchObject({ direction: 'short', size: 1, dedupeId: '3' })
    expect(res.cycles[1].fees).toBeCloseTo(1)      // remaining 1 unit
    expect(res.cycles[1].pnl).toBeCloseTo(4)       // (110-105)*1 - 1
  })

  it('treats sub-1e-8 dust as flat', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1 }),
      f({ id: '2', side: 'sell', price: 100, amount: 0.999999999, timestamp: 2 }),
    ])
    expect(res.cycles).toHaveLength(1)
    expect(res.skippedOpen).toBe(0)
  })

  it('skips a position still open at the end of the batch', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 2, timestamp: 1 }),
      f({ id: '2', side: 'sell', price: 110, amount: 1, timestamp: 2 }),
    ])
    expect(res.cycles).toEqual([])
    expect(res.skippedOpen).toBe(1)
  })

  it('nets a quote-currency fee out of pnl', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1, fee: { cost: 0.5, currency: 'USDT' } }),
      f({ id: '2', side: 'sell', price: 110, amount: 1, timestamp: 2, fee: { cost: 0.5, currency: 'USDT' } }),
    ])
    expect(res.cycles[0].fees).toBeCloseTo(1)
    expect(res.cycles[0].pnl).toBeCloseTo(9)
  })

  it('warns and excludes a fee paid in a non-quote currency', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1, fee: { cost: 0.01, currency: 'BNB' } }),
      f({ id: '2', side: 'sell', price: 110, amount: 1, timestamp: 2 }),
    ])
    expect(res.cycles[0].fees).toBe(0)
    expect(res.cycles[0].pnl).toBeCloseTo(10)
    expect(res.warnings.join(' ')).toContain('BNB')
  })

  it('keeps two symbols independent and sorts by timestamp', () => {
    const res = rollupFills([
      f({ id: 'e2', symbol: 'ETH/USDT', side: 'sell', price: 2100, amount: 1, timestamp: 4 }),
      f({ id: 'b2', side: 'sell', price: 110, amount: 1, timestamp: 3 }),
      f({ id: 'e1', symbol: 'ETH/USDT', side: 'buy', price: 2000, amount: 1, timestamp: 2 }),
      f({ id: 'b1', side: 'buy', price: 100, amount: 1, timestamp: 1 }),
    ])
    expect(res.cycles).toHaveLength(2)
    expect(res.cycles.map((c) => c.dedupeId).sort()).toEqual(['b2', 'e2'])
    const eth = res.cycles.find((c) => c.symbol === 'ETH/USDT')!
    expect(eth.pnl).toBeCloseTo(100)
  })
})
