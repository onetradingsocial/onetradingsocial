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
    const rs = rows.map((t) => t.r_multiple ?? 0)
    const pnl = rows.reduce((s, t) => s + (t.pnl_amount ?? 0), 0)
    const wins = rows.filter((t) => t.outcome === 'win').length
    const losses = rows.filter((t) => t.outcome === 'loss').length
    const trades_ = rows.length
    const sumR = rs.reduce((a, b) => a + b, 0)
    const avgR = trades_ ? sumR / trades_ : 0
    const grossWin = rs.filter((r) => r > EPS).reduce((a, b) => a + b, 0)
    const grossLoss = Math.abs(rs.filter((r) => r < -EPS).reduce((a, b) => a + b, 0))
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0

    // Max drawdown on the cumulative-R curve, in chronological order.
    const asc = [...rows].sort((a, b) => (a.traded_at ?? '').localeCompare(b.traded_at ?? ''))
    let cum = 0, peak = 0, maxDd = 0
    for (const t of asc) { cum += t.r_multiple ?? 0; peak = Math.max(peak, cum); maxDd = Math.min(maxDd, cum - peak) }

    // Volatility of per-trade R -> consistency + risk-adjusted return.
    const mean = avgR
    const variance = trades_ > 1 ? rs.reduce((a, r) => a + (r - mean) ** 2, 0) / (trades_ - 1) : 0
    const stdev = Math.sqrt(variance)
    const consistency = stdev > 0 ? 1 / (1 + stdev) : trades_ > 0 ? 1 : 0
    const riskAdjusted = stdev > 0 ? mean / stdev : mean > 0 ? mean : 0

    m.set(userId, {
      userId, pnl, wins, losses, trades: trades_,
      winRate: trades_ ? wins / trades_ : 0,
      avgR, expectancy: avgR, profitFactor, maxDrawdownR: maxDd, consistency, riskAdjusted,
    })
  }
  return m
}

const perfKey = (a: Agg, sort: PerfSort): number => {
  switch (sort) {
    case 'winRate': return a.winRate
    case 'avgR': return a.avgR
    case 'trades': return a.trades
    case 'expectancy': return a.expectancy
    case 'profitFactor': return a.profitFactor === Infinity ? Number.MAX_SAFE_INTEGER : a.profitFactor
    case 'consistency': return a.consistency
    case 'riskAdjusted': return a.riskAdjusted
    default: return a.pnl
  }
}

// `joinedAt` (profile created_at as a timestamp) breaks ties on the sorted metric.
export type Sortable = Agg & { joinedAt?: number }

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
