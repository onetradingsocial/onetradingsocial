import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type XpTrade, type Period, type QuestProgress, type EvaluatedBadge, type LevelInfo,
  totalXpFromTrades, levelFromXp, dailyQuestProgress, weeklyQuestProgress,
  questStreak, maxQuestStreak, winStreakMax, closedCount, evaluateBadges, windowXp,
} from '@/lib/xp'

export type UserXp = {
  totalXp: number
  level: LevelInfo
  daily: QuestProgress[]
  weekly: QuestProgress[]
  questStreak: number
  badges: EvaluatedBadge[]
}

// One user's XP picture. Owner view (default) counts ALL their trades; pass
// `publicOnly` for cross-viewer surfaces (public profile) so private-trade XP never leaks.
export async function getUserXp(
  supabase: SupabaseClient,
  userId: string,
  opts: { now?: number; publicOnly?: boolean } = {},
): Promise<UserXp> {
  const now = opts.now ?? Date.now()
  let q = supabase
    .from('trades')
    .select('traded_at, closed_at, status, outcome')
    .eq('user_id', userId)
  if (opts.publicOnly) q = q.eq('is_public', true)
  const { data } = await q
  const trades = (data ?? []) as XpTrade[]
  const totalXp = totalXpFromTrades(trades)
  const level = levelFromXp(totalXp)
  return {
    totalXp,
    level,
    daily: dailyQuestProgress(trades, now),
    weekly: weeklyQuestProgress(trades, now),
    questStreak: questStreak(trades, now),
    badges: evaluateBadges({
      closedCount: closedCount(trades),
      level: level.level,
      maxQuestStreak: maxQuestStreak(trades),
      maxWinStreak: winStreakMax(trades),
    }),
  }
}

export type XpRankedEntry = {
  rank: number; userId: string; username: string; displayName: string | null; avatarUrl: string | null
  xp: number; level: number
}

// Public closed trades -> per-user windowXp -> keep visible profiles -> rank by window XP.
// Level column reflects all-time PUBLIC XP (privacy-by-construction, same as performance board).
export async function getXpRanking(supabase: SupabaseClient, period: Period, now = Date.now()): Promise<XpRankedEntry[]> {
  const { data: rows } = await supabase
    .from('trades')
    .select('user_id, traded_at, closed_at, status, outcome')
    .eq('is_public', true)
    .eq('status', 'closed')

  const byUser = new Map<string, XpTrade[]>()
  for (const r of (rows ?? []) as (XpTrade & { user_id: string })[]) {
    const arr = byUser.get(r.user_id) ?? []
    arr.push(r)
    byUser.set(r.user_id, arr)
  }
  const scored = [...byUser.entries()]
    .map(([userId, trades]) => ({ userId, xp: windowXp(trades, period, now), level: levelFromXp(totalXpFromTrades(trades)).level }))
    .filter((s) => s.xp > 0)
  if (scored.length === 0) return []

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, created_at')
    .in('id', scored.map((s) => s.userId))
    .eq('is_public', true)
    .eq('onboarding_completed', true)
  const pmap = new Map((profs ?? []).map((p) => [p.id, p]))

  const visible = scored
    .filter((s) => pmap.has(s.userId))
    .map((s) => ({ ...s, joinedAt: Date.parse(pmap.get(s.userId)!.created_at) }))
    .sort((a, b) => b.xp - a.xp || a.joinedAt - b.joinedAt)

  return visible.map((s, i) => {
    const p = pmap.get(s.userId)!
    return {
      rank: i + 1, userId: s.userId,
      username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url,
      xp: s.xp, level: s.level,
    }
  })
}
