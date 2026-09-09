import type { ProcessKind, ProcessLog } from '@/lib/process'

export type Period = 'week' | 'month' | 'all'

export type XpTrade = {
  traded_at: string
  closed_at: string | null
  status: 'open' | 'closed'
  outcome: string
  /**
   * `trades.created_at` — when the row was written, not when the market moved.
   *
   * Optional only so that callers constructing partial rows (tests, fixtures)
   * still typecheck; every production read selects it, and when it is absent the
   * code falls back to the old user-controlled fields rather than silently
   * awarding nothing.
   */
  created_at?: string | null
}

export const XP = {
  BASE_PER_TRADE: 50,
  DAILY_QUEST_BONUS: 30,
  WEEKLY_QUEST_BONUS: 150,
  LEVEL_BASE: 100,
} as const

// Cumulative XP required to REACH level L (L>=1). reach(1)=0, rising cost LEVEL_BASE*L per level.
export function xpForLevel(level: number): number {
  const L = Math.max(1, Math.floor(level))
  return (XP.LEVEL_BASE * (L - 1) * L) / 2
}

export type LevelInfo = { level: number; xpIntoLevel: number; xpToNext: number; progress: number }

export function levelFromXp(totalXp: number): LevelInfo {
  const xp = Math.max(0, totalXp)
  let level = 1
  while (xpForLevel(level + 1) <= xp) level += 1
  const base = xpForLevel(level)
  const next = xpForLevel(level + 1)
  const xpToNext = next - base
  const xpIntoLevel = xp - base
  return { level, xpIntoLevel, xpToNext, progress: xpToNext ? xpIntoLevel / xpToNext : 0 }
}

const DAY = 864e5

/* ── Quests ─────────────────────────────────────────────────────────────────
 *
 * ── Audit 2026-09-05, P0: the reward system paid for volume ─────────────────
 *
 * BEFORE                                            AFTER
 *   daily   log_trade    1 trade created     ->      daily_process    1 process entry
 *   daily   close_trade  1 trade closed      ->      (removed)
 *   weekly  log_10       10 trades created   ->      weekly_review    1 review
 *   weekly  close_5      5 trades closed     ->      weekly_reflect   3 reflection days
 *
 * Every quest below is satisfiable with the market closed and with no position
 * ever opened. Nothing in this file counts trades toward a quest, a streak or a
 * badge any more; the only place a trade still earns is `XP.BASE_PER_TRADE`,
 * which is a flat recognition of a journalled trade with no threshold, no
 * streak and no maintenance requirement attached (see `baseTradeXp`).
 *
 * There is exactly ONE daily quest, on purpose. `questStreak` requires every
 * daily quest to be met for a day to count, so a second daily quest would be a
 * second thing a resting trader has to do to keep their streak alive — and
 * "scheduled rest must not break the chain" is the whole point of the change.
 */

/** What a quest counts. All four are process entries; none touches `trades`. */
export type QuestSource =
  /** any process entry that day/week — review, reflection, no-trade or rest */
  | 'any_process'
  /** completed reviews */
  | 'review'
  /** distinct days carrying a rule reflection (any outcome, 'unknown' included) */
  | 'reflection_days'

export type QuestDef = { id: string; label: string; target: number; source: QuestSource }

export const DAILY_QUESTS: QuestDef[] = [
  { id: 'daily_process', label: 'Log today’s process — review, reflection, or a planned day out', target: 1, source: 'any_process' },
]
export const WEEKLY_QUESTS: QuestDef[] = [
  { id: 'weekly_review', label: 'Complete a review this week', target: 1, source: 'review' },
  { id: 'weekly_reflect', label: 'Reflect on your rules on 3 days this week', target: 3, source: 'reflection_days' },
]

export function utcDayStart(now: number): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
export function utcWeekStart(now: number): number {
  const ds = utcDayStart(now)
  const offset = (new Date(ds).getUTCDay() + 6) % 7
  return ds - offset * DAY
}
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
export function weekKey(ms: number): string {
  return dayKey(utcWeekStart(ms))
}

/**
 * When, for bucketing purposes, did the user DO the thing?
 *
 * ── Audit item 15, F7 (P2) ───────────────────────────────────────────────────
 *
 * Kept for `journaledCloseAt` below, which the weekly digest and the lifecycle
 * cron both bucket on. Quests no longer use it — they read `process_logs.day`,
 * which Postgres stamps and migration 0070 withholds from the client grants, so
 * the same backdating hole cannot reopen on the new surface.
 *
 * The rule in words: a trade cannot be closed, as an act by a person, before it
 * was recorded. Open Monday, close Wednesday and `closed_at` (Wednesday) is
 * later than `created_at` (Monday), so it buckets on Wednesday exactly as
 * before. Backfilling an already-closed trade from last month lands on today,
 * because today is when the user did the work.
 */
function metricTime(t: XpTrade): number | null {
  const created = t.created_at ? Date.parse(t.created_at) : NaN
  if (t.status !== 'closed' || !t.closed_at) return null
  const closed = Date.parse(t.closed_at)
  if (!Number.isFinite(created)) return closed
  return Math.max(closed, created)
}

/**
 * When the user did the work of closing this trade in their journal, as
 * opposed to when the market moved. `max(closed_at, created_at)` — exported so
 * the weekly digest buckets a trade into the same week XP does, and the two
 * rules cannot drift apart. Null for a trade that is not closed.
 */
export function journaledCloseAt(t: XpTrade): number | null {
  return metricTime(t)
}

/* ── Quest progress over process entries ────────────────────────────────── */

export type QuestProgress = { id: string; label: string; target: number; current: number; done: boolean }

/**
 * How many times `source` was satisfied inside `[start, end)`.
 *
 * `process_logs` is unique on (user, day, kind), so 'any_process' and 'review'
 * are already capped per day by the database; 'reflection_days' counts distinct
 * days for symmetry with the way the quest is worded.
 */
function countInBucket(logs: ProcessLog[], source: QuestSource, start: number, end: number): number {
  const inWindow = logs.filter((l) => {
    const ts = Date.parse(l.day + 'T00:00:00.000Z')
    return Number.isFinite(ts) && ts >= start && ts < end
  })
  if (source === 'any_process') return new Set(inWindow.map((l) => l.day)).size
  if (source === 'review') return inWindow.filter((l) => l.kind === 'review').length
  return new Set(inWindow.filter((l) => l.kind === 'rule_reflection').map((l) => l.day)).size
}

function progressFor(defs: QuestDef[], logs: ProcessLog[], start: number, end: number): QuestProgress[] {
  return defs.map((q) => {
    const current = countInBucket(logs, q.source, start, end)
    return { id: q.id, label: q.label, target: q.target, current, done: current >= q.target }
  })
}
export function dailyQuestProgress(logs: ProcessLog[], now: number): QuestProgress[] {
  const start = utcDayStart(now)
  return progressFor(DAILY_QUESTS, logs, start, start + DAY)
}
export function weeklyQuestProgress(logs: ProcessLog[], now: number): QuestProgress[] {
  const start = utcWeekStart(now)
  return progressFor(WEEKLY_QUESTS, logs, start, start + 7 * DAY)
}

/**
 * Per-bucket counts for one quest source. `keyOf` names the bucket a log falls
 * in (day or ISO week) and `spanDays` is that bucket's width, so the count for
 * each bucket is taken over exactly the bucket's own interval.
 */
function bucketCounts(
  logs: ProcessLog[], source: QuestSource, keyOf: (ms: number) => string, spanDays: number,
): Map<string, number> {
  const keys = new Set<string>()
  for (const l of logs) {
    const ts = Date.parse(l.day + 'T00:00:00.000Z')
    if (Number.isFinite(ts)) keys.add(keyOf(ts))
  }
  const out = new Map<string, number>()
  for (const k of keys) {
    const start = Date.parse(k + 'T00:00:00.000Z')
    out.set(k, countInBucket(logs, source, start, start + spanDays * DAY))
  }
  return out
}

export function historicalDailyBonus(logs: ProcessLog[]): number {
  let bonus = 0
  for (const q of DAILY_QUESTS)
    for (const c of bucketCounts(logs, q.source, dayKey, 1).values())
      if (c >= q.target) bonus += XP.DAILY_QUEST_BONUS
  return bonus
}
export function historicalWeeklyBonus(logs: ProcessLog[]): number {
  let bonus = 0
  for (const q of WEEKLY_QUESTS)
    for (const c of bucketCounts(logs, q.source, weekKey, 7).values())
      if (c >= q.target) bonus += XP.WEEKLY_QUEST_BONUS
  return bonus
}

/** All quest XP a user has earned, from process entries alone. */
export function totalProcessXp(logs: ProcessLog[]): number {
  return historicalDailyBonus(logs) + historicalWeeklyBonus(logs)
}

/* ── Trade XP ───────────────────────────────────────────────────────────────
 *
 * The only remaining place a trade earns anything. Flat, per closed trade, with
 * no threshold, no streak and no quota resting on it — closing a tenth trade is
 * worth exactly what closing a first one is, and closing none costs nothing that
 * was already banked. Quest bonuses used to ride on top of this and are gone
 * from it entirely; they are computed from `process_logs` above.
 */

export function closedCount(trades: XpTrade[]): number {
  return trades.filter((t) => t.status === 'closed').length
}

/** Flat trade XP, all time. */
export function baseTradeXp(trades: XpTrade[]): number {
  return XP.BASE_PER_TRADE * closedCount(trades)
}

export function windowCutoff(period: Period, now: number): number | null {
  if (period === 'all') return null
  return now - (period === 'week' ? 7 : 30) * DAY
}

/** Flat trade XP inside a rolling window, gated on the exact `closed_at`. */
export function windowTradeXp(trades: XpTrade[], period: Period, now: number): number {
  const cutoff = windowCutoff(period, now)
  if (cutoff == null) return baseTradeXp(trades)
  let base = 0
  for (const t of trades)
    if (t.status === 'closed' && t.closed_at && Date.parse(t.closed_at) >= cutoff) base += XP.BASE_PER_TRADE
  return base
}

/**
 * Quest XP inside a rolling window. Attributed by whole bucket: a day/week
 * counts if its UTC start is >= cutoff. A bucket straddling the cutoff is
 * counted whole — acceptable since quests are inherently per-day/per-week units.
 */
export function processWindowXp(logs: ProcessLog[], period: Period, now: number): number {
  const cutoff = windowCutoff(period, now)
  if (cutoff == null) return totalProcessXp(logs)
  const windowed = (defs: QuestDef[], keyOf: (ms: number) => string, spanDays: number, perBonus: number): number => {
    let bonus = 0
    for (const q of defs)
      for (const [k, c] of bucketCounts(logs, q.source, keyOf, spanDays))
        if (c >= q.target && Date.parse(k + 'T00:00:00.000Z') >= cutoff) bonus += perBonus
    return bonus
  }
  return windowed(DAILY_QUESTS, dayKey, 1, XP.DAILY_QUEST_BONUS)
    + windowed(WEEKLY_QUESTS, weekKey, 7, XP.WEEKLY_QUEST_BONUS)
}

/* ── Streaks ────────────────────────────────────────────────────────────────
 *
 * A day counts when every daily quest is met, which — since the only daily quest
 * is "log any process entry" — means: a day you reviewed, reflected, deliberately
 * stood aside, or took a scheduled rest. A flat week is a full streak week.
 */

function dayComplete(logs: ProcessLog[], key: string): boolean {
  const start = Date.parse(key + 'T00:00:00.000Z')
  if (!Number.isFinite(start)) return false
  return DAILY_QUESTS.every((q) => countInBucket(logs, q.source, start, start + DAY) >= q.target)
}

// Today counts toward the streak only if complete; if today is incomplete, the streak
// is the run of complete days ending yesterday (so a day-in-progress never zeroes it).
export function questStreak(logs: ProcessLog[], now: number): number {
  let cursor = utcDayStart(now)
  if (!dayComplete(logs, dayKey(cursor))) cursor -= DAY
  let streak = 0
  while (dayComplete(logs, dayKey(cursor))) { streak += 1; cursor -= DAY }
  return streak
}

export function maxQuestStreak(logs: ProcessLog[]): number {
  const completeDays = [...new Set(logs.map((l) => l.day))]
    .filter((k) => dayComplete(logs, k))
    .map((k) => Date.parse(k + 'T00:00:00.000Z'))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b)
  if (completeDays.length === 0) return 0
  let best = 1, run = 1
  for (let i = 1; i < completeDays.length; i++) {
    run = completeDays[i] - completeDays[i - 1] === DAY ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}

/* ── Badges ─────────────────────────────────────────────────────────────────
 *
 * ── Audit 2026-09-05, P0 ────────────────────────────────────────────────────
 *
 * REMOVED (7): trades_1 / trades_10 / trades_50 / trades_100 / trades_500 —
 * a ladder whose only rung was transacting; wins_5 / wins_10 — a reward for a
 * run of winning trades, i.e. for an outcome the trader does not control, paid
 * out per trade taken. A trader chasing 'wins_10' is a trader taking the next
 * marginal trade to keep a streak alive, which is the audit's own guardrail
 * ("whether users feel encouraged to take unnecessary trades") stated as a
 * product feature.
 *
 * ADDED (3): reviews_1 / reviews_10 / reviews_25 — one replacement ladder, on
 * the deepest of the process acts. Deliberately not one ladder per process kind:
 * the audit is explicit that more badges would grow scope before closing the
 * adoption gap, and the net badge count here goes DOWN (15 -> 11).
 *
 * KEPT: level_* (level is now driven by process XP as well as flat trade XP, and
 * requires no trade to progress), streak_* (now a process-day streak — see
 * `questStreak` above), lessons_* (unchanged; still filtered out of both badge
 * grids while Learn is withdrawn).
 */

export type BadgeCategory = 'reviews' | 'level' | 'questStreak' | 'lessons'
export type BadgeDef = { id: string; category: BadgeCategory; label: string; threshold: number }

export const BADGES: BadgeDef[] = [
  { id: 'reviews_1', category: 'reviews', label: 'First Review', threshold: 1 },
  { id: 'reviews_10', category: 'reviews', label: '10 Reviews', threshold: 10 },
  { id: 'reviews_25', category: 'reviews', label: '25 Reviews', threshold: 25 },
  { id: 'level_5', category: 'level', label: 'Level 5', threshold: 5 },
  { id: 'level_10', category: 'level', label: 'Level 10', threshold: 10 },
  { id: 'level_25', category: 'level', label: 'Level 25', threshold: 25 },
  { id: 'streak_7', category: 'questStreak', label: '7-Day Streak', threshold: 7 },
  { id: 'streak_30', category: 'questStreak', label: '30-Day Streak', threshold: 30 },
  { id: 'lessons_1', category: 'lessons', label: 'First Lesson', threshold: 1 },
  { id: 'lessons_5', category: 'lessons', label: '5 Lessons', threshold: 5 },
  { id: 'lessons_25', category: 'lessons', label: '25 Lessons', threshold: 25 },
]

/**
 * Note what is NOT in here: no trade count, no win streak, no P&L. A badge stat
 * that cannot be moved by trading more is the structural form of the audit fix —
 * adding one back is the regression to watch for, and
 * `tests/unit/process-rewards.test.ts` fails if one appears.
 */
export type BadgeStats = { reviewsCompleted: number; level: number; maxQuestStreak: number; lessonsCompleted: number }
export type EvaluatedBadge = BadgeDef & { earned: boolean; current: number }

export function evaluateBadges(stats: BadgeStats): EvaluatedBadge[] {
  const value = (c: BadgeCategory): number =>
    c === 'reviews' ? stats.reviewsCompleted
      : c === 'level' ? stats.level
      : c === 'questStreak' ? stats.maxQuestStreak
      : stats.lessonsCompleted
  return BADGES.map((b) => {
    const current = value(b.category)
    return { ...b, current, earned: current >= b.threshold }
  })
}

/** Re-exported so callers wiring the reward system have one import site. */
export type { ProcessKind, ProcessLog }
