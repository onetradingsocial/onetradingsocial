import { describe, it, expect } from 'vitest'
import { mapCycleToTrade } from '@/lib/crypto/map'
import type { Cycle } from '@/lib/crypto/fills'

const cycle = (o: Partial<Cycle> = {}): Cycle => ({
  dedupeId: 'fill-9', symbol: 'BTC/USDT', direction: 'long', size: 0.5,
  entryPrice: 60000, exitPrice: 61000, fees: 12, pnl: 488,
  openedAt: '2026-07-01T10:00:00.000Z', closedAt: '2026-07-01T12:00:00.000Z', ...o,
})

describe('mapCycleToTrade', () => {
  it('produces a closed, broker-sourced crypto row', () => {
    expect(mapCycleToTrade(cycle(), { userId: 'u1', isPublic: true })).toMatchObject({
      user_id: 'u1', broker_deal_id: 'fill-9', source: 'broker',
      market: 'crypto', instrument: 'BTC/USD', direction: 'long',
      sizing_mode: 'lots', lots: 0.5,
      entry_price: 60000, exit_price: 61000,
      pnl_amount: 488, outcome: 'win', status: 'closed',
      is_public: true,
      traded_at: '2026-07-01T10:00:00.000Z', closed_at: '2026-07-01T12:00:00.000Z',
    })
  })

  it('leaves every stop/risk field neutral because imports carry no stop', () => {
    const row = mapCycleToTrade(cycle(), { userId: 'u1', isPublic: false })
    expect(row).toMatchObject({
      stop_price: null, target_price: null, tp_pips: null,
      planned_rr: null, r_multiple: null, risk_percent: null,
      sl_pips: 0, risk_amount: 0, is_public: false,
    })
  })

  it('marks a losing short and rounds pnl to cents', () => {
    const row = mapCycleToTrade(
      cycle({ direction: 'short', entryPrice: 100, exitPrice: 110, pnl: -10.005 }),
      { userId: 'u1', isPublic: true },
    )
    expect(row.outcome).toBe('loss')
    expect(row.pnl_amount).toBe(-10.01)
  })

  it('treats a zero-pnl cycle as breakeven', () => {
    const row = mapCycleToTrade(cycle({ pnl: 0 }), { userId: 'u1', isPublic: true })
    expect(row.outcome).toBe('breakeven')
  })

  it('computes realized_pips from the catalog pip size', () => {
    // BTC/USD pipSize is 1, so 61000 - 60000 = 1000 pips.
    expect(mapCycleToTrade(cycle(), { userId: 'u1', isPublic: true }).realized_pips).toBe(1000)
  })
})
