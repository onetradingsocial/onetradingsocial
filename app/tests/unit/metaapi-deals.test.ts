import { describe, it, expect } from 'vitest'
import { pairDealsToTrades, type MetaApiDeal } from '@/lib/metaapi-deals'

const IN = (over: Partial<MetaApiDeal> = {}): MetaApiDeal => ({
  id: 'd1', type: 'DEAL_TYPE_BUY', entryType: 'DEAL_ENTRY_IN', symbol: 'EURUSD',
  positionId: 'p1', volume: 1, price: 1.085, time: '2026-06-01T09:30:00.000Z',
  profit: 0, commission: -4, swap: 0, ...over,
})
const OUT = (over: Partial<MetaApiDeal> = {}): MetaApiDeal => ({
  id: 'd2', type: 'DEAL_TYPE_SELL', entryType: 'DEAL_ENTRY_OUT', symbol: 'EURUSD',
  positionId: 'p1', volume: 1, price: 1.0905, time: '2026-06-01T14:45:10.000Z',
  profit: 55, commission: -4, swap: -1, ...over,
})

describe('pairDealsToTrades', () => {
  it('pairs simple IN+OUT into one closed trade', () => {
    const { trades, maxDealTime } = pairDealsToTrades([IN(), OUT()])
    expect(trades).toHaveLength(1)
    expect(trades[0]).toMatchObject({
      ticket: 'd2', symbol: 'EURUSD', direction: 'long', lots: 1,
      openPrice: 1.085, closePrice: 1.0905,
      openTime: '2026-06-01T09:30:00Z', closeTime: '2026-06-01T14:45:10Z',
      profit: 55, swap: -1, commission: -8,   // -4 OUT + -4 IN (full volume)
    })
    expect(trades[0].netPnl).toBeCloseTo(46)
    expect(maxDealTime).toBe('2026-06-01T14:45:10Z')
  })

  it('partial close: two OUTs → two trades, IN commission apportioned', () => {
    const { trades } = pairDealsToTrades([
      IN({ volume: 1, commission: -4 }),
      OUT({ id: 'o1', volume: 0.4, profit: 20, commission: -1.6, time: '2026-06-01T11:00:00.000Z' }),
      OUT({ id: 'o2', volume: 0.6, profit: 35, commission: -2.4, time: '2026-06-01T12:00:00.000Z' }),
    ])
    expect(trades).toHaveLength(2)
    expect(trades[0]).toMatchObject({ ticket: 'o1', lots: 0.4 })
    expect(trades[0].commission).toBeCloseTo(-1.6 + -4 * 0.4)
    expect(trades[1].commission).toBeCloseTo(-2.4 + -4 * 0.6)
  })

  it('short direction from SELL entry', () => {
    const { trades } = pairDealsToTrades([
      IN({ type: 'DEAL_TYPE_SELL' }),
      OUT({ type: 'DEAL_TYPE_BUY', profit: -30 }),
    ])
    expect(trades[0].direction).toBe('short')
  })

  it('open position (IN only) produces nothing; balance deals ignored', () => {
    const { trades, maxDealTime } = pairDealsToTrades([
      { id: 'b1', type: 'DEAL_TYPE_BALANCE', time: '2026-06-01T08:00:00.000Z', profit: 1000 },
      IN(),
    ])
    expect(trades).toHaveLength(0)
    expect(maxDealTime).toBe('2026-06-01T09:30:00Z')
  })

  it('weighted average entry across multiple INs', () => {
    const { trades } = pairDealsToTrades([
      IN({ id: 'i1', volume: 1, price: 1.08 }),
      IN({ id: 'i2', volume: 1, price: 1.09, time: '2026-06-01T10:00:00.000Z' }),
      OUT({ volume: 2, profit: 10 }),
    ])
    expect(trades[0].openPrice).toBeCloseTo(1.085)
    expect(trades[0].lots).toBe(2)
  })

  it('stopLoss/takeProfit on OUT map to stop/target; absent → null', () => {
    const a = pairDealsToTrades([IN(), OUT({ stopLoss: 1.082, takeProfit: 1.091 })])
    expect(a.trades[0]).toMatchObject({ stopPrice: 1.082, targetPrice: 1.091 })
    const b = pairDealsToTrades([IN(), OUT()])
    expect(b.trades[0]).toMatchObject({ stopPrice: null, targetPrice: null })
  })

  it('empty input → no trades, null cursor', () => {
    expect(pairDealsToTrades([])).toEqual({ trades: [], maxDealTime: null })
  })

  it('instant scalp: OUT before IN in input array with identical timestamp still pairs', () => {
    const t = '2026-06-01T09:30:00.000Z'
    const { trades } = pairDealsToTrades([OUT({ time: t }), IN({ time: t })])
    expect(trades).toHaveLength(1)
    expect(trades[0]).toMatchObject({
      ticket: 'd2', symbol: 'EURUSD', direction: 'long', lots: 1,
      openPrice: 1.085, closePrice: 1.0905,
      openTime: '2026-06-01T09:30:00Z', closeTime: '2026-06-01T09:30:00Z',
      profit: 55, swap: -1, commission: -8,
    })
  })
})
