import { describe, it, expect } from 'vitest'
import { computeOpen, computeClose, MISTAKE_TAGS, SETUP_PRESETS } from '@/lib/trade'

const base = {
  direction: 'long' as const,
  entry: 1.0856,
  stop: 1.0806,
  target: 1.0936,
  pipSize: 0.0001,
}

describe('computeOpen', () => {
  it('computes pips, planned R:R and risk amount (risk%)', () => {
    const r = computeOpen({
      ...base, sizingMode: 'risk_percent', riskPercent: 1, lots: null,
      accountBalance: 16000, pipValuePerLot: 10,
    })
    if ('error' in r) throw new Error(r.error)
    expect(Math.round(r.slPips)).toBe(50)
    expect(Math.round(r.tpPips!)).toBe(80)
    expect(r.plannedRr).toBeCloseTo(1.6, 5)
    expect(r.riskAmount).toBe(160) // 16000 * 1%
    expect(r.estPnl).toBeCloseTo(256, 5) // 160 * 1.6
  })

  it('computes risk amount in lot mode from pips × pip value × lots', () => {
    const r = computeOpen({
      ...base, sizingMode: 'lots', riskPercent: null, lots: 1,
      accountBalance: 0, pipValuePerLot: 10,
    })
    if ('error' in r) throw new Error(r.error)
    expect(r.riskAmount).toBeCloseTo(500, 5) // 50 pips * 10 * 1
  })

  it('errors when stop equals entry', () => {
    const r = computeOpen({
      ...base, stop: base.entry, sizingMode: 'risk_percent', riskPercent: 1,
      lots: null, accountBalance: 1000, pipValuePerLot: 10,
    })
    expect(r).toEqual({ error: 'Stop cannot equal entry.' })
  })
})

describe('computeClose', () => {
  it('long winner: realized R and P/L from exit', () => {
    const r = computeClose({
      direction: 'long', entry: 1.0856, stop: 1.0806, exit: 1.0936,
      pipSize: 0.0001, riskAmount: 160,
    })
    expect(Math.round(r.realizedPips)).toBe(80)
    expect(r.rMultiple).toBeCloseTo(1.6, 5)
    expect(r.pnlAmount).toBeCloseTo(256, 5)
    expect(r.outcome).toBe('win')
  })

  it('short winner: price drops', () => {
    const r = computeClose({
      direction: 'short', entry: 1.1000, stop: 1.1050, exit: 1.0900,
      pipSize: 0.0001, riskAmount: 100,
    })
    expect(Math.round(r.realizedPips)).toBe(100)
    expect(r.rMultiple).toBeCloseTo(2, 5)
    expect(r.outcome).toBe('win')
  })

  it('loss when stopped out', () => {
    const r = computeClose({
      direction: 'long', entry: 1.0856, stop: 1.0806, exit: 1.0806,
      pipSize: 0.0001, riskAmount: 160,
    })
    expect(r.rMultiple).toBeCloseTo(-1, 5)
    expect(r.outcome).toBe('loss')
  })

  it('breakeven', () => {
    const r = computeClose({
      direction: 'long', entry: 1.0856, stop: 1.0806, exit: 1.0856,
      pipSize: 0.0001, riskAmount: 160,
    })
    expect(r.outcome).toBe('breakeven')
  })
})

it('exposes tag lists', () => {
  expect(MISTAKE_TAGS).toContain('FOMO')
  expect(SETUP_PRESETS).toContain('Breakout')
})

import { computeMetrics } from '@/lib/trade'

describe('computeMetrics', () => {
  const closed = (rMultiple: number, pnl: number, mistakes: string[] = []) => ({
    status: 'closed' as const, outcome: rMultiple > 0 ? ('win' as const) : ('loss' as const),
    rMultiple, pnlAmount: pnl, tradedAt: '2026-06-01T00:00:00Z', mistakeTags: mistakes,
  })

  it('aggregates win rate, profit factor, best/worst, net P/L', () => {
    const m = computeMetrics([
      closed(2, 200), closed(-1, -100), closed(1, 100, ['FOMO']),
      { status: 'open', outcome: 'open', rMultiple: null, pnlAmount: null, tradedAt: '2026-06-02T00:00:00Z', mistakeTags: [] },
    ])
    expect(m.total).toBe(3)        // closed only
    expect(m.open).toBe(1)
    expect(m.wins).toBe(2)
    expect(m.losses).toBe(1)
    expect(m.winRate).toBeCloseTo(2 / 3, 5)
    expect(m.avgRr).toBeCloseTo((2 - 1 + 1) / 3, 5)
    expect(m.profitFactor).toBeCloseTo(3 / 1, 5) // (2+1)/|-1|
    expect(m.best).toBe(2)
    expect(m.worst).toBe(-1)
    expect(m.netPnl).toBe(200)
    expect(m.mistakeCounts.FOMO).toBe(1)
  })

  it('empty input yields zeros', () => {
    const m = computeMetrics([])
    expect(m).toMatchObject({ total: 0, wins: 0, winRate: 0, profitFactor: 0, netPnl: 0 })
  })
})
