import { isWin, isLoss, rValues } from '@/lib/trade'

export type Period = 'day' | 'week' | 'month' | 'all'
// Rank by more than raw profit (Sprint 3, row 9): return%, drawdown, profit
// factor, expectancy, avg R, consistency, risk-adjusted return.
export type PerfSort = 'pnl' | 'winRate' | 'avgR' | 'trades'
  | 'expectancy' | 'profitFactor' | 'consistency' | 'riskAdjusted'

export type PerfTrade = { user_id: string; pnl_amount: number | null; r_multiple: number | null; outcome: string; traded_at?: string }
export type Agg = {
  userId: string; pnl: number; wins: number; losses: number; winRate: number; avgR: number; trades: number
  // Extended methodology metrics:
  expectancy: number     // mean R per trade (edge)
  profitFactor: number   // gross win R / gross loss R
  maxDrawdownR: number   // worst cumulative-R dip, ≤ 0
  consistency: number    // 0..1, 1 = very stable per-trade R (low volatility)
  riskAdjusted: number   // expectancy / stdev(R) — Sharpe-like
}
export type RankedPerf = Agg & { rank: number }
export type RankedCount = { userId: string; count: number; rank: number }

/**
 * The sort keys the performance board offers, in the order it offers them, and
 * the label each one is shown under.
 *
 * Lives in this plain module rather than in the `'use client'` controls so a
 * Server Component can import it: a value imported from a `'use client'` module
 * resolves to a client-reference proxy and throws when touched (see CLAUDE.md,
 * the /admin/feedback outage). The page needs the labels to name the metric it
 * ranked by and to say which sort it discarded.
 */
export const PERF_SORT_LABEL: Record<PerfSort, string> = {
  expectancy: 'Expectancy',
  riskAdjusted: 'Risk-adjusted',
  consistency: 'Consistency',
  profitFactor: 'Profit factor',
  avgR: 'Avg R:R',
  winRate: 'Win rate',
  pnl: 'Total P/L',
  trades: 'Trades',
}

export const PERF_SORTS = Object.keys(PERF_SORT_LABEL) as PerfSort[]

export function isPerfSort(v: string | undefined | null): v is PerfSort {
  return v != null && (PERF_SORTS as string[]).includes(v)
}

/**
 * The metric the board ranks by unless the viewer picks another one.
 *
 * It was Total P/L. Money as the headline ranking is the wrong default for a
 * process-improvement product, and it is not even a fair one: P/L is a function
 * of account size and position sizing, so the largest account wins a contest
 * that claims to be about trading. A trader risking 1% of $500k outranks a
 * better trader risking 1% of $2k, on identical decisions.
 *
 * Expectancy — mean R per trade, already named "edge" where `Agg` is defined —
 * is risk-normalised, so it compares decisions rather than balances. It is also
 * the statistic the product already uses when it compares a trader to anyone
 * else: `lib/server/compare.ts` benchmarks peers on avg R, not on dollars.
 *
 * Rejected alternatives, for the record:
 *   - `consistency` (1/(1+stdev of R)) rewards flatness. A trader who never
 *     takes a real risk scores near 1 and tops the board having done nothing.
 *   - `riskAdjusted` (expectancy/stdev) is the better statistic of the two but
 *     needs a much larger sample than the floor below to mean anything, and it
 *     cannot be explained on a leaderboard row.
 * Both remain available as explicit sorts.
 */
export const DEFAULT_PERF_SORT: PerfSort = 'expectancy'

/**
 * The smallest number of closed trades in the window that earns a rank.
 *
 * The board used to offer "Any sample", so one lucky trade could hold rank 1.
 * This number is not invented for the leaderboard: the codebase already draws
 * two "not enough to be a data point" lines, and both are in the comparison
 * feature — `lib/compare.ts` MIN_COHORT = 5 peers before a benchmark is shown
 * at all, and `lib/server/compare.ts` drops any peer with fewer than 3 trades
 * before computing the median.
 *
 * A public board takes the stricter of the two. Contributing anonymously to a
 * median is a weaker claim than being named and numbered on a public ranking,
 * so the threshold for the louder claim cannot be the looser number.
 */
export const MIN_RANKED_TRADES = 5

/** The floor, applied to whatever the caller asked for. A request for a LOWER
 *  minimum (including the old `0`, still reachable by hand-editing the URL)
 *  cannot lower it; a request for a higher one is honoured. */
export function effectiveMinTrades(requested: number | undefined | null): number {
  const n = typeof requested === 'number' && Number.isFinite(requested) ? requested : 0
  return Math.max(n, MIN_RANKED_TRADES)
}

/**
 * The sort actually applied, and whether the viewer's choice was thrown away.
 *
 * Sorting beyond the default is `advanced_leaderboard_filters` (Trader+). The
 * page used to coerce silently, so a free viewer following a shared
 * `?sort=winRate` link got a differently-ordered board with nothing on the page
 * saying so. Silently discarding an explicit choice is its own trust problem,
 * so the coercion is now reported back and the page discloses it.
 */
export function resolveSort(
  requested: PerfSort,
  canAdvancedFilters: boolean,
): { sort: PerfSort; coerced: boolean } {
  if (canAdvancedFilters) return { sort: requested, coerced: false }
  return { sort: DEFAULT_PERF_SORT, coerced: requested !== DEFAULT_PERF_SORT }
}

const EPS = 1e-9

export function aggregatePerformance(trades: PerfTrade[]): Map<string, Agg> {
  // Group first so per-user series (drawdown, stdev) can be computed.
  const byUser = new Map<string, PerfTrade[]>()
  for (const t of trades) {
    const arr = byUser.get(t.user_id) ?? []
    arr.push(t)
    byUser.set(t.user_id, arr)
  }

  const m = new Map<string, Agg>()
  for (const [userId, rows] of byUser) {
    // Same definition as computeMetrics (see `isClosed` in @/lib/trade): every
    // closed row counts, win/loss comes from outcome, and R metrics run over
    // the rows that actually carry an r_multiple instead of reading a missing
    // one as a flat 0R.
    const rs = rValues(rows.map((t) => t.r_multiple))
    const pnl = rows.reduce((s, t) => s + (t.pnl_amount ?? 0), 0)
    const wins = rows.filter(isWin).length
    const losses = rows.filter(isLoss).length
    const trades_ = rows.length
    const sumR = rs.reduce((a, b) => a + b, 0)
    const avgR = rs.length ? sumR / rs.length : 0
    const grossWin = rs.filter((r) => r > EPS).reduce((a, b) => a + b, 0)
    const grossLoss = Math.abs(rs.filter((r) => r < -EPS).reduce((a, b) => a + b, 0))
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0

    // Max drawdown on the cumulative-R curve, in chronological order.
    const asc = [...rows].sort((a, b) => (a.traded_at ?? '').localeCompare(b.traded_at ?? ''))
    let cum = 0, peak = 0, maxDd = 0
    for (const t of asc) { cum += t.r_multiple ?? 0; peak = Math.max(peak, cum); maxDd = Math.min(maxDd, cum - peak) }

    // Volatility of per-trade R -> consistency + risk-adjusted return.
    const mean = avgR
    const variance = rs.length > 1 ? rs.reduce((a, r) => a + (r - mean) ** 2, 0) / (rs.length - 1) : 0
    const stdev = Math.sqrt(variance)
    const consistency = stdev > 0 ? 1 / (1 + stdev) : rs.length > 0 ? 1 : 0
    const riskAdjusted = stdev > 0 ? mean / stdev : mean > 0 ? mean : 0

    m.set(userId, {
      userId, pnl, wins, losses, trades: trades_,
      winRate: trades_ ? wins / trades_ : 0,
      avgR, expectancy: avgR, profitFactor, maxDrawdownR: maxDd, consistency, riskAdjusted,
    })
  }
  return m
}

/** Just the ranked columns. `RankedEntry` (lib/server/ranking) carries these
 *  but not the win/loss counts, and the standing card reads the metric off a
 *  ranked entry, so `perfMetric` asks for no more than it uses. */
export type MetricSource = Pick<Agg,
  'pnl' | 'winRate' | 'avgR' | 'trades' | 'expectancy' | 'profitFactor' | 'consistency' | 'riskAdjusted'>

/** The raw value of one ranked metric, in its own units. `Infinity` is a real
 *  profit factor (wins and no losses) and is returned as-is — only the SORT
 *  collapses it to a finite number, so display code can render it honestly. */
export function perfMetric(a: MetricSource, sort: PerfSort): number {
  switch (sort) {
    case 'winRate': return a.winRate
    case 'avgR': return a.avgR
    case 'trades': return a.trades
    case 'expectancy': return a.expectancy
    case 'profitFactor': return a.profitFactor
    case 'consistency': return a.consistency
    case 'riskAdjusted': return a.riskAdjusted
    default: return a.pnl
  }
}

const perfKey = (a: Agg, sort: PerfSort): number => {
  const v = perfMetric(a, sort)
  return v === Infinity ? Number.MAX_SAFE_INTEGER : v
}

// `joinedAt` (profile created_at as a timestamp) breaks ties on the sorted metric.
export type Sortable = Agg & { joinedAt?: number }

/** Pure sorter. `minTrades` is taken as given — the platform floor
 *  (MIN_RANKED_TRADES) is applied by `lib/server/ranking.ts` before it gets
 *  here, so every public board is clamped once, at the one place board rows are
 *  produced, rather than at each of its three call sites. */
export function rankPerformance(aggs: Sortable[], sort: PerfSort = 'pnl', minTrades = 0): RankedPerf[] {
  // Minimum sample size so one lucky trade can't top the board (row 9).
  const eligible = minTrades > 0 ? aggs.filter((a) => a.trades >= minTrades) : aggs
  // Sort by the chosen metric desc; equal scores -> the earlier-joined user ranks higher.
  const sorted = [...eligible].sort(
    (a, b) => perfKey(b, sort) - perfKey(a, sort) || (a.joinedAt ?? 0) - (b.joinedAt ?? 0),
  )
  // Unique, gapless ranks: every trader gets a distinct position.
  return sorted.map((a, i) => ({ ...a, rank: i + 1 }))
}

function rankCounts(counts: Map<string, number>): RankedCount[] {
  const arr = [...counts.entries()].map(([userId, count]) => ({ userId, count }))
  arr.sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId))
  let rank = 0
  let prev: number | null = null
  return arr.map((r) => {
    if (prev === null || r.count !== prev) { rank += 1; prev = r.count }
    return { ...r, rank }
  })
}

export function rankConsistency(trades: { user_id: string }[]): RankedCount[] {
  const counts = new Map<string, number>()
  for (const t of trades) counts.set(t.user_id, (counts.get(t.user_id) ?? 0) + 1)
  return rankCounts(counts)
}

export function rankFollowers(follows: { following_id: string }[]): RankedCount[] {
  const counts = new Map<string, number>()
  for (const f of follows) counts.set(f.following_id, (counts.get(f.following_id) ?? 0) + 1)
  return rankCounts(counts)
}

export function windowStart(period: Period, now: number): string | null {
  if (period === 'all') return null
  const days = period === 'day' ? 1 : period === 'week' ? 7 : 30
  return new Date(now - days * 864e5).toISOString()
}
