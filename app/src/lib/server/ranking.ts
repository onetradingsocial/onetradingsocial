import type { SupabaseClient } from '@supabase/supabase-js'
import {
  aggregatePerformance, rankPerformance, windowStart,
  type PerfTrade, type Period, type PerfSort,
} from '@/lib/leaderboard'
import { profileLevel, type SourceCounts, type VerificationLevel, type AccountType, type TradeSource } from '@/lib/verification'

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
  verification: VerificationLevel
  accountType: AccountType | null
}

/** Leaderboard verification filter: trade-source or account-type based. */
export type VerifyFilter = 'all' | 'broker' | 'statement' | 'self' | 'live' | 'demo' | 'prop'

const SOURCE_FILTER: Partial<Record<VerifyFilter, TradeSource>> = {
  broker: 'broker', statement: 'statement', self: 'manual',
}
const ACCOUNT_FILTER: Partial<Record<VerifyFilter, AccountType>> = {
  live: 'live', demo: 'demo', prop: 'prop',
}

// Public closed trades -> aggregate -> keep only visible profiles -> rank -> attach profile fields.
export async function getPerformanceRanking(
  supabase: SupabaseClient,
  period: Period,
  sort: PerfSort = 'pnl',
  verify: VerifyFilter = 'all',
): Promise<RankedEntry[]> {
  const cutoff = windowStart(period, Date.now())
  let q = supabase
    .from('trades')
    .select('user_id, pnl_amount, r_multiple, outcome, traded_at, source')
    .eq('is_public', true)
    .eq('status', 'closed')
  if (cutoff) q = q.gte('traded_at', cutoff)
  const sourceFilter = SOURCE_FILTER[verify]
  if (sourceFilter) q = q.eq('source', sourceFilter)
  const { data: rows } = await q

  const aggs = [...aggregatePerformance((rows ?? []) as PerfTrade[]).values()]
  if (aggs.length === 0) return []

  // Verification level per user = mix of the sources behind their ranked trades.
  const counts = new Map<string, SourceCounts>()
  for (const r of (rows ?? []) as { user_id: string; source?: TradeSource | null }[]) {
    const c = counts.get(r.user_id) ?? { manual: 0, statement: 0, broker: 0 }
    c[(r.source ?? 'manual') as keyof SourceCounts] += 1
    counts.set(r.user_id, c)
  }

  let pq = supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, created_at, account_type')
    .in('id', aggs.map((a) => a.userId))
    .eq('is_public', true)
    .eq('onboarding_completed', true)
    .eq('leaderboard_optout', false)
  const accountFilter = ACCOUNT_FILTER[verify]
  if (accountFilter) pq = pq.eq('account_type', accountFilter)
  const { data: profs } = await pq
  const pmap = new Map((profs ?? []).map((p) => [p.id, p]))

  // Attach join date so equal scores tie-break by who joined first.
  const visible = aggs
    .filter((a) => pmap.has(a.userId))
    .map((a) => ({ ...a, joinedAt: Date.parse(pmap.get(a.userId)!.created_at) }))
  return rankPerformance(visible, sort).map((r) => {
    const p = pmap.get(r.userId)!
    return {
      rank: r.rank, userId: r.userId,
      username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url,
      pnl: r.pnl, winRate: r.winRate, avgR: r.avgR, trades: r.trades,
      verification: profileLevel(counts.get(r.userId) ?? { manual: 0, statement: 0, broker: 0 }, null),
      accountType: (p.account_type ?? null) as AccountType | null,
    }
  })
}
