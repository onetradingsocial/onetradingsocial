export type Period = 'week' | 'month' | 'all'
export type PerfSort = 'pnl' | 'winRate' | 'avgR' | 'trades'

export type PerfTrade = { user_id: string; pnl_amount: number | null; r_multiple: number | null; outcome: string }
export type Agg = { userId: string; pnl: number; wins: number; losses: number; winRate: number; avgR: number; trades: number }
export type RankedPerf = Agg & { rank: number }
export type RankedCount = { userId: string; count: number; rank: number }

export function aggregatePerformance(trades: PerfTrade[]): Map<string, Agg> {
  const m = new Map<string, Agg>()
  for (const t of trades) {
    const a = m.get(t.user_id) ?? { userId: t.user_id, pnl: 0, wins: 0, losses: 0, winRate: 0, avgR: 0, trades: 0 }
    a.pnl += t.pnl_amount ?? 0
    a.avgR += t.r_multiple ?? 0 // running sum; divided to a mean below
    if (t.outcome === 'win') a.wins += 1
    else if (t.outcome === 'loss') a.losses += 1
    a.trades += 1
    m.set(t.user_id, a)
  }
  for (const a of m.values()) {
    a.winRate = a.trades ? a.wins / a.trades : 0
    a.avgR = a.trades ? a.avgR / a.trades : 0
  }
  return m
}

const perfKey = (a: Agg, sort: PerfSort): number =>
  sort === 'pnl' ? a.pnl : sort === 'winRate' ? a.winRate : sort === 'avgR' ? a.avgR : a.trades

export function rankPerformance(aggs: Agg[], sort: PerfSort = 'pnl'): RankedPerf[] {
  const sorted = [...aggs].sort(
    (a, b) => perfKey(b, sort) - perfKey(a, sort) || b.trades - a.trades || b.pnl - a.pnl,
  )
  let rank = 0
  let prev: number | null = null
  return sorted.map((a) => {
    const k = perfKey(a, sort)
    if (prev === null || k !== prev) { rank += 1; prev = k } // dense rank on the chosen key
    return { ...a, rank }
  })
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
  const days = period === 'week' ? 7 : 30
  return new Date(now - days * 864e5).toISOString()
}
