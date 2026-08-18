import type { SupabaseClient } from '@supabase/supabase-js'
import {
  aggregatePerformance, rankPerformance, windowStart,
  type PerfTrade, type Period, type PerfSort,
} from '@/lib/leaderboard'
import { profileLevel, type SourceCounts, type VerificationLevel, type AccountType, type TradeSource } from '@/lib/verification'
import { leaderboardEligibleIds } from '@/lib/server/entitlements'

/**
 * The three cohorts a public board is ranked in, strongest evidence first.
 *
 * ── Audit item 15, F5 (P1) ───────────────────────────────────────────────────
 *
 * `/verification` tells users, in the document the verification chip links to:
 *
 *     "Manual trades never appear equivalent to broker-synced trades
 *      anywhere on TradingSocial."
 *
 * That was not true. The default board (`verify='all'`) applied no source
 * filter and sorted every trader into ONE ordered list on ONE P&L column with
 * ONE shared podium, so a self-reported trader could and did hold rank 1, gold
 * ring and all, above a broker-synced one. The only thing distinguishing them
 * was a small text chip rendered at the same size as the account-type chip.
 *
 * The instruction for this workstream was to fix the product rather than
 * rewrite the claim, so: traders are now ranked WITHIN their cohort and never
 * across cohorts. Rank 1 self-reported and rank 1 broker-connected are two
 * different positions on two separately headed boards. A manual trader cannot
 * outrank a broker-synced trader because they are not in the same ordering —
 * which is what "never appear equivalent" has to mean if it means anything.
 *
 * Why three cohorts and not two. The page describes a three-level hierarchy
 * and is explicit that a statement import is "a step below a live broker
 * connection" because the file is produced on the trader's own machine.
 * Folding statement in with broker would have made the board contradict the
 * page in the other direction. The cohorts are the page's own levels.
 *
 * Note this is a change to how results are PRESENTED, not to who may rank.
 * Nobody is dropped by it. What used to be one list of N is now up to three
 * lists totalling N.
 */
export type RankCohort = 'broker_connected' | 'statement_imported' | 'self_reported'

/** Presentation order. Strongest evidence first, and the board renders them in
 *  exactly this order so position on the page tracks evidence quality. */
export const COHORT_ORDER: readonly RankCohort[] = ['broker_connected', 'statement_imported', 'self_reported'] as const

export const COHORT_HEADING: Record<RankCohort, string> = {
  broker_connected: 'Broker-verified traders',
  statement_imported: 'Statement-imported traders',
  self_reported: 'Self-reported traders',
}

export const COHORT_SUB: Record<RankCohort, string> = {
  broker_connected: 'Results pulled directly from the broker. Execution data is locked and cannot be edited or deleted.',
  statement_imported: 'Results from an uploaded broker statement. Locked after import, but the file was produced on the trader’s own machine.',
  self_reported: 'Typed in by the trader. Not verified — useful for journalling, and ranked separately for that reason.',
}

/** Which cohort a profile-level verification lands in. `profileLevel` can also
 *  return pending/failed, but only when a broker status is supplied, and the
 *  board deliberately passes null: a pending connection is not evidence, so
 *  those traders rank on the trades they actually have. */
export function cohortOf(level: VerificationLevel): RankCohort {
  return level === 'broker_connected' || level === 'statement_imported' ? level : 'self_reported'
}

export type RankedEntry = {
  /** Position WITHIN `cohort`, from 1. Never comparable across cohorts. */
  rank: number
  cohort: RankCohort
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  pnl: number
  winRate: number
  avgR: number
  trades: number
  expectancy: number
  profitFactor: number
  maxDrawdownR: number
  consistency: number
  riskAdjusted: number
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
  minTrades = 0,
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

  // Ranking is a paid perk — free accounts never reach a public board.
  const eligible = await leaderboardEligibleIds(aggs.map((a) => a.userId))
  if (eligible.length === 0) return []

  let pq = supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, created_at, account_type')
    .in('id', eligible)
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

  const levelOf = (userId: string) =>
    profileLevel(counts.get(userId) ?? { manual: 0, statement: 0, broker: 0 }, null)

  // Rank inside each cohort, then concatenate in COHORT_ORDER. `rankPerformance`
  // is called once per cohort rather than once overall, which is the whole
  // mechanism: ranks restart at 1 per cohort and the sort never compares a
  // self-reported P&L with a broker-verified one. `minTrades` applies within
  // each cohort, as it did before, so the sample-size floor is unaffected.
  const out: RankedEntry[] = []
  for (const cohort of COHORT_ORDER) {
    const group = visible.filter((a) => cohortOf(levelOf(a.userId)) === cohort)
    if (group.length === 0) continue
    for (const r of rankPerformance(group, sort, minTrades)) {
      const p = pmap.get(r.userId)!
      out.push({
        rank: r.rank, cohort, userId: r.userId,
        username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url,
        pnl: r.pnl, winRate: r.winRate, avgR: r.avgR, trades: r.trades,
        expectancy: r.expectancy, profitFactor: r.profitFactor, maxDrawdownR: r.maxDrawdownR,
        consistency: r.consistency, riskAdjusted: r.riskAdjusted,
        verification: levelOf(r.userId),
        accountType: (p.account_type ?? null) as AccountType | null,
      })
    }
  }
  return out
}

/** Ranked entries split into cohorts, in presentation order, empties dropped.
 *  Pure, so the page does not re-derive the grouping rule. */
export function groupByCohort(entries: RankedEntry[]): { cohort: RankCohort; rows: RankedEntry[] }[] {
  return COHORT_ORDER
    .map((cohort) => ({ cohort, rows: entries.filter((e) => e.cohort === cohort) }))
    .filter((g) => g.rows.length > 0)
}
