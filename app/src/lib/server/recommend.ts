import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recommendTraders, type CandidateTrader, type Recommendation, type ViewerProfile } from '@/lib/recommend'
import { profileLevel, type SourceCounts } from '@/lib/verification'

/**
 * Builds the candidate pool for personalised recommendations (row 35).
 * Only public, onboarded, non-internal profiles are eligible.
 */
export async function getRecommendedTraders(
  svc: SupabaseClient,
  viewerId: string,
  opts: { limit?: number } = {},
): Promise<Recommendation[]> {
  const [{ data: me }, { data: myTrades }, { data: follows }, { data: myLessons }] = await Promise.all([
    svc.from('profiles').select('main_markets, trading_styles, experience_level').eq('id', viewerId).maybeSingle(),
    svc.from('trades').select('setup_type, strategy_tags').eq('user_id', viewerId).limit(500),
    svc.from('follows').select('following_id').eq('follower_id', viewerId),
    svc.from('lesson_completions').select('lesson_id', { count: 'exact', head: true }).eq('user_id', viewerId),
  ])
  if (!me) return []

  const myStrategies = new Set<string>()
  for (const t of myTrades ?? []) {
    if (t.setup_type) myStrategies.add(t.setup_type)
    for (const s of t.strategy_tags ?? []) myStrategies.add(s)
  }

  const viewer: ViewerProfile = {
    markets: me.main_markets ?? [],
    styles: me.trading_styles ?? [],
    experience: me.experience_level ?? null,
    strategies: [...myStrategies],
    lessonsCompleted: myLessons?.length ?? 0,
  }

  const { data: profiles } = await svc
    .from('profiles')
    .select('id, username, display_name, avatar_url, main_markets, trading_styles, experience_level')
    .eq('is_public', true).eq('onboarding_completed', true).eq('is_internal', false)
    .neq('id', viewerId)
    .limit(300)
  if (!profiles?.length) return []

  const ids = profiles.map((p) => p.id)
  const [{ data: trades }, { data: lessons }, { data: followerRows }] = await Promise.all([
    svc.from('trades').select('user_id, setup_type, strategy_tags, source')
      .in('user_id', ids).eq('is_public', true).eq('status', 'closed').limit(20000),
    svc.from('lesson_completions').select('user_id').in('user_id', ids).limit(20000),
    svc.from('follows').select('following_id').in('following_id', ids),
  ])

  const strategiesBy = new Map<string, Set<string>>()
  const sourceBy = new Map<string, SourceCounts>()
  const tradeCount = new Map<string, number>()
  for (const t of trades ?? []) {
    const set = strategiesBy.get(t.user_id) ?? new Set<string>()
    if (t.setup_type) set.add(t.setup_type)
    for (const s of t.strategy_tags ?? []) set.add(s)
    strategiesBy.set(t.user_id, set)

    const sc = sourceBy.get(t.user_id) ?? { manual: 0, statement: 0, broker: 0 }
    sc[(t.source ?? 'manual') as keyof SourceCounts]++
    sourceBy.set(t.user_id, sc)

    tradeCount.set(t.user_id, (tradeCount.get(t.user_id) ?? 0) + 1)
  }
  const lessonCount = new Map<string, number>()
  for (const l of lessons ?? []) lessonCount.set(l.user_id, (lessonCount.get(l.user_id) ?? 0) + 1)
  const followerCount = new Map<string, number>()
  for (const f of followerRows ?? []) followerCount.set(f.following_id, (followerCount.get(f.following_id) ?? 0) + 1)

  const candidates: CandidateTrader[] = profiles.map((p) => ({
    userId: p.id,
    username: p.username,
    displayName: p.display_name,
    avatarUrl: p.avatar_url,
    markets: p.main_markets ?? [],
    styles: p.trading_styles ?? [],
    experience: p.experience_level ?? null,
    strategies: [...(strategiesBy.get(p.id) ?? [])],
    lessonsCompleted: lessonCount.get(p.id) ?? 0,
    verification: profileLevel(sourceBy.get(p.id) ?? { manual: 0, statement: 0, broker: 0 }, null),
    publicTrades: tradeCount.get(p.id) ?? 0,
    followers: followerCount.get(p.id) ?? 0,
  }))

  const exclude = new Set([...(follows ?? []).map((f) => f.following_id), viewerId])
  return recommendTraders(viewer, candidates, { exclude, limit: opts.limit ?? 5 })
}

/** Author affinity scores, for re-ranking the discovery portion of the feed. */
export async function getAffinityScores(svc: SupabaseClient, viewerId: string): Promise<Map<string, number>> {
  const recs = await getRecommendedTraders(svc, viewerId, { limit: 100 })
  return new Map(recs.map((r) => [r.userId, r.score]))
}
