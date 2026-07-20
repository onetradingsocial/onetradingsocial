import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  statsFor, compareToSelf, benchmarkAgainstPeers, MIN_COHORT,
  type PeriodStats, type SelfComparison, type PeerBenchmark, type CompareTrade,
} from '@/lib/compare'

export type ComparisonData = { self: SelfComparison; peers: PeerBenchmark }

const DAY = 864e5

/**
 * Trader comparison (row 36). The peer cohort is chosen by shared market +
 * experience level; only per-peer AGGREGATES ever leave the database layer,
 * and the benchmark is suppressed below MIN_COHORT.
 */
export async function getComparison(
  svc: SupabaseClient,
  viewerId: string,
  windowDays = 30,
  now = Date.now(),
): Promise<ComparisonData | null> {
  const { data: me } = await svc
    .from('profiles').select('main_markets, experience_level').eq('id', viewerId).maybeSingle()
  if (!me) return null

  const { data: myTrades } = await svc
    .from('trades').select('r_multiple, traded_at')
    .eq('user_id', viewerId).eq('status', 'closed').limit(2000)
  const mine: CompareTrade[] = (myTrades ?? []).map((t) => ({ rMultiple: t.r_multiple, tradedAt: t.traded_at }))
  const self = compareToSelf(mine, windowDays, now)

  // Cohort: public, onboarded, non-internal traders sharing a market and
  // experience level. Never includes the viewer.
  const market = (me.main_markets ?? [])[0] ?? null
  let q = svc.from('profiles')
    .select('id')
    .eq('is_public', true).eq('onboarding_completed', true).eq('is_internal', false)
    .neq('id', viewerId)
  if (me.experience_level) q = q.eq('experience_level', me.experience_level)
  if (market) q = q.contains('main_markets', [market])
  const { data: peerProfiles } = await q.limit(500)

  const cohortLabel = [market, me.experience_level].filter(Boolean).join(' · ') || 'all traders'
  const peerIds = (peerProfiles ?? []).map((p) => p.id)
  if (peerIds.length === 0) {
    return { self, peers: { cohortSize: 0, median: null, percentile: null, cohortLabel } }
  }

  const since = new Date(now - windowDays * DAY).toISOString()
  const { data: peerTrades } = await svc
    .from('trades').select('user_id, r_multiple, traded_at')
    .in('user_id', peerIds).eq('status', 'closed').eq('is_public', true)
    .gte('traded_at', since).limit(20000)

  // Aggregate per peer, then discard the per-user mapping entirely.
  const byPeer = new Map<string, CompareTrade[]>()
  for (const t of peerTrades ?? []) {
    const arr = byPeer.get(t.user_id) ?? []
    arr.push({ rMultiple: t.r_multiple, tradedAt: t.traded_at })
    byPeer.set(t.user_id, arr)
  }
  // Require a minimum of activity per peer so one-trade accounts don't skew it.
  const peerStats: PeriodStats[] = [...byPeer.values()]
    .map((ts) => statsFor(ts))
    .filter((s) => s.trades >= 3)

  return { self, peers: benchmarkAgainstPeers(self.current, peerStats, cohortLabel) }
}

export { MIN_COHORT }
