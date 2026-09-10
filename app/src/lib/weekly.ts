// Enriched weekly-review detail (Sprint 3, row 17). Pure + unit-testable.
import { sessionForUtcHour, SESSION_LABELS } from '@/lib/rules'

export type WeeklyTrade = {
  rMultiple: number | null
  pnlAmount: number | null
  tradedAt: string
  strategyTags: string[]
  setupType: string | null
  mistakeTags: string[]
}

export type WeeklyDetail = {
  avgWinner: number      // R
  avgLoser: number       // R
  maxDrawdownR: number   // most negative cumulative-R dip, ≤ 0
  bestStrategy: { name: string; pnl: number } | null
  worstStrategy: { name: string; pnl: number } | null
  bestSession: { name: string; pnl: number } | null
  worstMistake: { tag: string; cost: number } | null
  continueMsg: string
  changeMsg: string
}

const EPS = 1e-9

/** The two periods a weekly review compares, reduced to what the card needs. */
export type WeekTotals = {
  /** closed trades in the window */
  total: number
  netPnl: number
  winRate: number
  avgRr: number
  /** closed trades in the window that carry an r_multiple */
  rCount: number
}

export type WeeklyComparison = {
  /** the current window has at least one closed trade */
  hasCurrent: boolean
  /** the previous window has at least one closed trade */
  hasPrevious: boolean
  /**
   * Null wherever the change cannot be measured. `trades` is a count and is
   * always real; the rest are quantities over a period that may not exist.
   */
  deltas: { trades: number; netPnl: number | null; winRate: number | null; avgRr: number | null }
  /** Set when there is nothing to review. Null when the card should render. */
  emptyReason: 'no-current' | 'no-history' | null
}

/**
 * Weekly review comparison — P0 from the audit.
 *
 * `computeMetrics([])` returns zeros, because it must return a Metrics. The
 * card then subtracted last week from those zeros and drew an arrow. A trader
 * who took no trades this week, after a week that averaged −0.6R and lost $400,
 * was shown "▲ 0.60R vs last week" and "▲ $400 vs last week" — the review
 * congratulated them for the absence of data. Two zeros that mean "nothing
 * happened" are not a result, and the difference between them and last week's
 * result is not an improvement.
 *
 * So: when the current window is empty there are no deltas at all, and
 * `emptyReason` tells the card to render a no-data state instead.
 */
export function compareWeeks(current: WeekTotals, previous: WeekTotals): WeeklyComparison {
  const hasCurrent = current.total > 0
  const hasPrevious = previous.total > 0

  if (!hasCurrent) {
    return {
      hasCurrent, hasPrevious,
      deltas: { trades: current.total - previous.total, netPnl: null, winRate: null, avgRr: null },
      emptyReason: hasPrevious ? 'no-current' : 'no-history',
    }
  }

  // Money and win rate need a previous week to be a change at all. Avg R needs
  // one more thing on top: an R-bearing trade on both sides, or the "previous"
  // avg R is the zero that `computeMetrics` returns for a stop-less week rather
  // than a measured average.
  const both = hasPrevious
  const rBoth = both && current.rCount > 0 && previous.rCount > 0
  return {
    hasCurrent, hasPrevious,
    deltas: {
      trades: current.total - previous.total,
      netPnl: both ? current.netPnl - previous.netPnl : null,
      winRate: both ? current.winRate - previous.winRate : null,
      avgRr: rBoth ? current.avgRr - previous.avgRr : null,
    },
    emptyReason: null,
  }
}

export function computeWeeklyDetail(trades: WeeklyTrade[]): WeeklyDetail | null {
  const closed = trades.filter((t) => t.rMultiple != null)
  if (closed.length === 0) return null

  const rs = closed.map((t) => t.rMultiple as number)
  const winners = rs.filter((r) => r > EPS)
  const losers = rs.filter((r) => r < -EPS)
  const avgWinner = winners.length ? winners.reduce((a, b) => a + b, 0) / winners.length : 0
  const avgLoser = losers.length ? losers.reduce((a, b) => a + b, 0) / losers.length : 0

  // Max drawdown on the cumulative-R curve (chronological).
  const asc = [...closed].sort((a, b) => a.tradedAt.localeCompare(b.tradedAt))
  let cum = 0, peak = 0, maxDd = 0
  for (const t of asc) {
    cum += t.rMultiple as number
    peak = Math.max(peak, cum)
    maxDd = Math.min(maxDd, cum - peak)
  }

  // Strategy P/L (setup_type + strategy tags).
  const strat = new Map<string, number>()
  for (const t of closed) {
    const keys = [t.setupType, ...t.strategyTags].filter(Boolean) as string[]
    for (const k of keys) strat.set(k, (strat.get(k) ?? 0) + (t.pnlAmount ?? 0))
  }
  const stratArr = [...strat.entries()].sort((a, b) => b[1] - a[1])
  const bestStrategy = stratArr.length ? { name: stratArr[0][0], pnl: stratArr[0][1] } : null
  const worstStrategy = stratArr.length > 1 ? { name: stratArr[stratArr.length - 1][0], pnl: stratArr[stratArr.length - 1][1] } : null

  // Session P/L.
  const sess = new Map<string, number>()
  for (const t of closed) {
    const s = SESSION_LABELS[sessionForUtcHour(new Date(t.tradedAt).getUTCHours())]
    sess.set(s, (sess.get(s) ?? 0) + (t.pnlAmount ?? 0))
  }
  const sessArr = [...sess.entries()].sort((a, b) => b[1] - a[1])
  const bestSession = sessArr.length ? { name: sessArr[0][0], pnl: sessArr[0][1] } : null

  // Most expensive mistake.
  const mist = new Map<string, number>()
  for (const t of closed) {
    if ((t.pnlAmount ?? 0) >= 0) continue
    for (const tag of t.mistakeTags) mist.set(tag, (mist.get(tag) ?? 0) + (t.pnlAmount ?? 0))
  }
  const mistArr = [...mist.entries()].sort((a, b) => a[1] - b[1])
  const worstMistake = mistArr.length ? { tag: mistArr[0][0], cost: mistArr[0][1] } : null

  // One thing to continue / one to change.
  const continueMsg = bestStrategy && bestStrategy.pnl > 0
    ? `Keep leaning on "${bestStrategy.name}" — it carried your week.`
    : bestSession && bestSession.pnl > 0
      ? `Your ${bestSession.name} session was your strongest — protect that time block.`
      : 'You kept losses controlled — keep sizing consistent.'
  const changeMsg = worstMistake
    ? `Cut "${worstMistake.tag}" — it cost you the most this week.`
    : worstStrategy && worstStrategy.pnl < 0
      ? `Review "${worstStrategy.name}" setups — they bled P/L.`
      : avgLoser < -1
        ? 'Your average loser is bigger than 1R — tighten stops or exits.'
        : 'Log more trades to surface a clear pattern to fix.'

  return { avgWinner, avgLoser, maxDrawdownR: maxDd, bestStrategy, worstStrategy, bestSession, worstMistake, continueMsg, changeMsg }
}
