import { describe, it, expect } from 'vitest'
import { compareWeeks, computeWeeklyDetail, type WeekTotals } from '@/lib/weekly'
import { compareToSelf } from '@/lib/compare'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'

/**
 * Audit P0 — no-data states in the weekly review.
 *
 * The bug: `computeMetrics([])` returns zeros, because it must return a
 * Metrics. The review card then subtracted last week from those zeros and drew
 * an up arrow, so a trader who took no trades at all was told their average R
 * and their P/L had improved. The absence of data was rendered as progress.
 *
 * The empty-current-period case therefore gets its own file and its own
 * assertions — it is the case that produced the false improvement, and the one
 * a future refactor is most likely to reintroduce by defaulting a null to 0.
 */

const wk = (over: Partial<WeekTotals> = {}): WeekTotals => ({
  total: 0, netPnl: 0, winRate: 0, avgRr: 0, rCount: 0, ...over,
})

describe('compareWeeks — empty current period', () => {
  // Last week: 6 trades, lost $400, averaged −0.6R. This week: nothing.
  const previous = wk({ total: 6, netPnl: -400, winRate: 0.33, avgRr: -0.6, rCount: 6 })
  const current = wk()

  it('reports no comparison rather than an improvement in average R', () => {
    const c = compareWeeks(current, previous)
    // The exact regression: 0 − (−0.6) = +0.6, rendered as "▲ 0.60R".
    expect(c.deltas.avgRr).toBeNull()
    expect(c.deltas.avgRr).not.toBe(0.6)
  })

  it('reports no comparison for P/L or win rate either', () => {
    const c = compareWeeks(current, previous)
    expect(c.deltas.netPnl).toBeNull()   // would have been +400
    expect(c.deltas.winRate).toBeNull()  // would have been −0.33
  })

  it('asks the card for a not-enough-data state', () => {
    const c = compareWeeks(current, previous)
    expect(c.hasCurrent).toBe(false)
    expect(c.emptyReason).toBe('no-current')
  })

  it('still reports the change in trade count, which is real', () => {
    // Going from 6 trades to 0 is a measured fact about a count, not a rate
    // computed over an empty denominator. Nulling it would hide the one thing
    // that actually happened.
    expect(compareWeeks(current, previous).deltas.trades).toBe(-6)
  })

  it('distinguishes a first-ever week from a week off', () => {
    expect(compareWeeks(wk(), wk()).emptyReason).toBe('no-history')
  })
})

describe('compareWeeks — empty previous period', () => {
  const current = wk({ total: 4, netPnl: 300, winRate: 0.75, avgRr: 0.9, rCount: 4 })

  it('does not present a first week as a gain over nothing', () => {
    const c = compareWeeks(current, wk())
    expect(c.emptyReason).toBeNull()   // this week has data; render it
    expect(c.hasPrevious).toBe(false)
    expect(c.deltas.netPnl).toBeNull()
    expect(c.deltas.winRate).toBeNull()
    expect(c.deltas.avgRr).toBeNull()
  })
})

describe('compareWeeks — avg R needs R on both sides', () => {
  it('withholds the avg R delta when a week is entirely stop-less', () => {
    // Both weeks traded, but last week's trades carried no r_multiple, so
    // `computeMetrics` reported avgRr 0 — a placeholder, not an average.
    const current = wk({ total: 3, netPnl: 120, winRate: 0.66, avgRr: 0.8, rCount: 3 })
    const previous = wk({ total: 3, netPnl: 90, winRate: 0.66, avgRr: 0, rCount: 0 })
    const c = compareWeeks(current, previous)
    expect(c.deltas.avgRr).toBeNull()
    // Money and win rate are still comparable — those count every closed trade.
    expect(c.deltas.netPnl).toBe(30)
    expect(c.deltas.winRate).toBe(0)
  })
})

describe('compareWeeks — normal week', () => {
  it('reports real deltas when both periods have trades', () => {
    const c = compareWeeks(
      wk({ total: 5, netPnl: 500, winRate: 0.6, avgRr: 0.4, rCount: 5 }),
      wk({ total: 4, netPnl: 200, winRate: 0.5, avgRr: 0.1, rCount: 4 }),
    )
    expect(c.emptyReason).toBeNull()
    expect(c.deltas.trades).toBe(1)
    expect(c.deltas.netPnl).toBe(300)
    expect(c.deltas.winRate).toBeCloseTo(0.1)
    expect(c.deltas.avgRr).toBeCloseTo(0.3)
  })
})

describe('compareWeeks fed by computeMetrics (the real call path)', () => {
  it('an empty current week yields no rate deltas end to end', () => {
    const lastWeekTrades: TradeForMetrics[] = [
      { status: 'closed', outcome: 'loss', rMultiple: -1, pnlAmount: -200, tradedAt: '2026-08-28T10:00:00Z', mistakeTags: [] },
      { status: 'closed', outcome: 'loss', rMultiple: -0.2, pnlAmount: -200, tradedAt: '2026-08-29T10:00:00Z', mistakeTags: [] },
    ]
    const thisWeek = computeMetrics([])
    const lastWeek = computeMetrics(lastWeekTrades)
    const t = (m: typeof thisWeek): WeekTotals =>
      ({ total: m.total, netPnl: m.netPnl, winRate: m.winRate, avgRr: m.avgRr, rCount: m.rCount })

    expect(lastWeek.avgRr).toBeCloseTo(-0.6)
    expect(thisWeek.avgRr).toBe(0)   // the zero that started it all

    const c = compareWeeks(t(thisWeek), t(lastWeek))
    expect(c.emptyReason).toBe('no-current')
    expect(c.deltas.avgRr).toBeNull()
    expect(c.deltas.netPnl).toBeNull()
  })
})

describe('computeWeeklyDetail — no data', () => {
  it('returns null rather than a zeroed detail block', () => {
    expect(computeWeeklyDetail([])).toBeNull()
    // Open trades carry no R; a week of them is still "not enough data".
    expect(computeWeeklyDetail([
      { rMultiple: null, pnlAmount: null, tradedAt: '2026-09-08T10:00:00Z', strategyTags: [], setupType: null, mistakeTags: [] },
    ])).toBeNull()
  })
})

describe('compareToSelf — empty current window', () => {
  const now = Date.parse('2026-09-09T00:00:00Z')

  it('does not report an improvement in avg R when nothing was traded', () => {
    // Only previous-window trades, all losers.
    const trades = [
      { rMultiple: -1, tradedAt: '2026-07-20T00:00:00Z' },
      { rMultiple: -0.6, tradedAt: '2026-07-25T00:00:00Z' },
    ]
    const c = compareToSelf(trades, 30, now)
    expect(c.current.trades).toBe(0)
    expect(c.previous.trades).toBe(2)
    expect(c.comparable).toBe(false)
    expect(c.deltas.avgR).toBeNull()      // would have been +0.8
    expect(c.deltas.winRate).toBeNull()
    expect(c.deltas.profitFactor).toBeNull()
    expect(c.deltas.trades).toBe(-2)      // the count is still real
  })

  it('withholds deltas when the previous window is the empty one', () => {
    const c = compareToSelf([{ rMultiple: 2, tradedAt: '2026-09-05T00:00:00Z' }], 30, now)
    expect(c.current.trades).toBe(1)
    expect(c.previous.trades).toBe(0)
    expect(c.comparable).toBe(false)
    expect(c.deltas.avgR).toBeNull()
  })

  it('still computes deltas when both windows have trades', () => {
    const c = compareToSelf([
      { rMultiple: 2, tradedAt: '2026-09-05T00:00:00Z' },
      { rMultiple: -1, tradedAt: '2026-08-05T00:00:00Z' },
    ], 30, now)
    expect(c.comparable).toBe(true)
    expect(c.deltas.avgR).toBeCloseTo(3)
    expect(c.deltas.winRate).toBeCloseTo(1)
  })

  it('does not turn an infinite profit factor into a numeric change', () => {
    // Winners and no losers gives Infinity. Infinity − 1.5 is not a quantity;
    // it used to be reported as 0, i.e. "no change", which is worse than saying
    // there is no comparable value.
    const c = compareToSelf([
      { rMultiple: 2, tradedAt: '2026-09-05T00:00:00Z' },
      { rMultiple: 3, tradedAt: '2026-09-06T00:00:00Z' },
      { rMultiple: 3, tradedAt: '2026-08-05T00:00:00Z' },
      { rMultiple: -2, tradedAt: '2026-08-06T00:00:00Z' },
    ], 30, now)
    expect(c.current.profitFactor).toBe(Infinity)
    expect(c.deltas.profitFactor).toBeNull()
    // The finite ones beside it still work.
    expect(c.deltas.avgR).not.toBeNull()
  })
})
