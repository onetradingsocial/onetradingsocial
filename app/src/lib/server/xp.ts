import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type XpTrade, type Period, type QuestProgress, type EvaluatedBadge, type LevelInfo,
  totalXpFromTrades, levelFromXp, dailyQuestProgress, weeklyQuestProgress,
  questStreak, maxQuestStreak, winStreakMax, closedCount, evaluateBadges, windowXp,
} from '@/lib/xp'
import { learningTotalXp, learningWindowXp, type LearningCompletion } from '@/lib/learning'

// A user's lesson completions joined to each lesson's xp_reward (+ any
// streak-boost bonus granted at completion time).
async function fetchCompletions(supabase: SupabaseClient, userId: string): Promise<LearningCompletion[]> {
  const { data } = await supabase
    .from('lesson_completions')
    .select('completed_at, bonus_xp, lessons(xp_reward)')
    .eq('user_id', userId)
  return (data ?? []).map((r) => {
    const l = r.lessons as { xp_reward: number } | { xp_reward: number }[] | null
    const xp = Array.isArray(l) ? (l[0]?.xp_reward ?? 0) : (l?.xp_reward ?? 0)
    return { completed_at: r.completed_at as string, xp_reward: xp + ((r.bonus_xp as number) ?? 0) }
  })
}

export type UserXp = {
  totalXp: number
  learningXp: number
  lessonsCompleted: number
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
  const completions = await fetchCompletions(supabase, userId)
  const learningXp = learningTotalXp(completions)
  const totalXp = totalXpFromTrades(trades) + learningXp
  const level = levelFromXp(totalXp)
  return {
    totalXp,
    learningXp,
    lessonsCompleted: completions.length,
    level,
    daily: dailyQuestProgress(trades, now),
    weekly: weeklyQuestProgress(trades, now),
    questStreak: questStreak(trades, now),
    badges: evaluateBadges({
      closedCount: closedCount(trades),
      level: level.level,
      maxQuestStreak: maxQuestStreak(trades),
      maxWinStreak: winStreakMax(trades),
      lessonsCompleted: completions.length,
    }),
  }
}

export type XpRankedEntry = {
  rank: number; userId: string; username: string; displayName: string | null; avatarUrl: string | null
  xp: number; level: number
}

// Combined XP board: public-closed-trade XP + learning XP, per user, in a window.
// Candidates = union of trade-XP owners and learning-XP owners; keep visible profiles.
// Level column reflects all-time combined PUBLIC XP (privacy-by-construction).
export async function getXpRanking(supabase: SupabaseClient, period: Period, now = Date.now()): Promise<XpRankedEntry[]> {
  const { data: tradeRows } = await supabase
    .from('trades')
    .select('user_id, traded_at, closed_at, status, outcome')
    .eq('is_public', true)
    .eq('status', 'closed')
  const tradeByUser = new Map<string, XpTrade[]>()
  for (const r of (tradeRows ?? []) as (XpTrade & { user_id: string })[]) {
    const arr = tradeByUser.get(r.user_id) ?? []
    arr.push(r)
    tradeByUser.set(r.user_id, arr)
  }

  const { data: compRows } = await supabase
    .from('lesson_completions')
    .select('user_id, completed_at, bonus_xp, lessons(xp_reward)')
  const learnByUser = new Map<string, LearningCompletion[]>()
  for (const r of compRows ?? []) {
    const l = r.lessons as { xp_reward: number } | { xp_reward: number }[] | null
    const xp = (Array.isArray(l) ? (l[0]?.xp_reward ?? 0) : (l?.xp_reward ?? 0)) + ((r.bonus_xp as number) ?? 0)
    const uid = r.user_id as string
    const arr = learnByUser.get(uid) ?? []
    arr.push({ completed_at: r.completed_at as string, xp_reward: xp })
    learnByUser.set(uid, arr)
  }

  const userIds = new Set<string>([...tradeByUser.keys(), ...learnByUser.keys()])
  const scored = [...userIds].map((userId) => {
    const t = tradeByUser.get(userId) ?? []
    const l = learnByUser.get(userId) ?? []
    const xp = windowXp(t, period, now) + learningWindowXp(l, period, now)
    const level = levelFromXp(totalXpFromTrades(t) + learningTotalXp(l)).level
    return { userId, xp, level }
  }).filter((s) => s.xp > 0)
  if (scored.length === 0) return []

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, created_at')
    .in('id', scored.map((s) => s.userId))
    .eq('is_public', true)
    .eq('onboarding_completed', true)
    .eq('leaderboard_optout', false)
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
