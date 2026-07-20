import { describe, it, expect } from 'vitest'
import { statsFor, compareToSelf, benchmarkAgainstPeers, MIN_COHORT, type PeriodStats } from '@/lib/compare'

const st = (winRate: number, avgR: number, trades = 20): PeriodStats =>
  ({ trades, winRate, avgR, profitFactor: 1.5 })

describe('statsFor', () => {
  it('handles an empty set', () => {
    expect(statsFor([])).toEqual({ trades: 0, winRate: 0, avgR: 0, profitFactor: 0 })
  })
  it('computes win rate and avg R', () => {
    const s = statsFor([
      { rMultiple: 2, tradedAt: '2026-07-01T00:00:00Z' },
      { rMultiple: -1, tradedAt: '2026-07-02T00:00:00Z' },
    ])
    expect(s.trades).toBe(2)
    expect(s.winRate).toBe(0.5)
    expect(s.avgR).toBe(0.5)
  })
})

describe('compareToSelf', () => {
  it('splits current vs previous window and reports deltas', () => {
    const now = Date.parse('2026-07-31T00:00:00Z')
    const trades = [
      { rMultiple: 2, tradedAt: '2026-07-20T00:00:00Z' },   // current 30d
      { rMultiple: 1, tradedAt: '2026-07-15T00:00:00Z' },   // current
      { rMultiple: -1, tradedAt: '2026-06-15T00:00:00Z' },  // previous 30d
    ]
    const c = compareToSelf(trades, 30, now)
    expect(c.current.trades).toBe(2)
    expect(c.previous.trades).toBe(1)
    expect(c.deltas.trades).toBe(1)
    expect(c.deltas.winRate).toBeGreaterThan(0)
  })
})

describe('benchmarkAgainstPeers (privacy)', () => {
  it('suppresses the benchmark below the minimum cohort', () => {
    const peers = Array.from({ length: MIN_COHORT - 1 }, () => st(0.5, 0.3))
    const b = benchmarkAgainstPeers(st(0.6, 0.4), peers, 'forex · intermediate')
    expect(b.median).toBeNull()
    expect(b.percentile).toBeNull()
    expect(b.cohortSize).toBe(MIN_COHORT - 1)
  })

  it('reports medians once the cohort is large enough', () => {
    const peers = [st(0.4, 0.1), st(0.5, 0.2), st(0.6, 0.3), st(0.7, 0.4), st(0.8, 0.5)]
    const b = benchmarkAgainstPeers(st(0.75, 0.45), peers, 'forex')
    expect(b.median).not.toBeNull()
    expect(b.median!.winRate).toBeCloseTo(0.6)
    expect(b.percentile!.winRate).toBe(80)
  })

  it('never leaks an individual peer value as the median for even cohorts', () => {
    const peers = [st(0.2, 0), st(0.4, 0), st(0.6, 0), st(0.8, 0), st(1.0, 0), st(0.5, 0)]
    const b = benchmarkAgainstPeers(st(0.5, 0), peers, 'x')
    // even-sized cohort -> median is an average of the two middle values
    expect(b.median!.winRate).toBeCloseTo(0.55)
  })
})
