import type { SupabaseClient } from '@supabase/supabase-js'
import {
  aggregatePerformance, rankPerformance, windowStart,
  type PerfTrade, type Period, type PerfSort,
} from '@/lib/leaderboard'

export type RankedEntry = {
  rank: number
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  pnl: number
  winRate: number
  avgR: number
  trades: number
}

// Public closed trades -> aggregate -> keep only visible profiles -> rank -> attach profile fields.
export async function getPerformanceRanking(
  supabase: SupabaseClient,
  period: Period,
  sort: PerfSort = 'pnl',
): Promise<RankedEntry[]> {
  const cutoff = windowStart(period, Date.now())
  let q = supabase
    .from('trades')
    .select('user_id, pnl_amount, r_multiple, outcome, traded_at')
    .eq('is_public', true)
    .eq('status', 'closed')
  if (cutoff) q = q.gte('traded_at', cutoff)
  const { data: rows } = await q

  const aggs = [...aggregatePerformance((rows ?? []) as PerfTrade[]).values()]
  if (aggs.length === 0) return []

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', aggs.map((a) => a.userId))
    .eq('is_public', true)
    .eq('onboarding_completed', true)
  const pmap = new Map((profs ?? []).map((p) => [p.id, p]))

  const visible = aggs.filter((a) => pmap.has(a.userId))
  return rankPerformance(visible, sort).map((r) => {
    const p = pmap.get(r.userId)!
    return {
      rank: r.rank, userId: r.userId,
      username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url,
      pnl: r.pnl, winRate: r.winRate, avgR: r.avgR, trades: r.trades,
    }
  })
}
