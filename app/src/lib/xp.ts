export type Period = 'week' | 'month' | 'all'

export type XpTrade = {
  traded_at: string
  closed_at: string | null
  status: 'open' | 'closed'
  outcome: string
  /**
   * `trades.created_at` — when the row was written, not when the market moved.
   *
   * Load-bearing for quest bonuses; see `metricTime`. Optional only so that
   * callers constructing partial rows (tests, fixtures) still typecheck; every
   * production read selects it, and when it is absent the code falls back to
   * the old user-controlled fields rather than silently awarding nothing.
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

export type QuestMetric = 'created' | 'closed'
export type QuestDef = { id: string; label: string; target: number; metric: QuestMetric }

export const DAILY_QUESTS: QuestDef[] = [
  { id: 'log_trade', label: 'Log a trade today', target: 1, metric: 'created' },
  { id: 'close_trade', label: 'Close a trade today', target: 1, metric: 'closed' },
]
export const WEEKLY_QUESTS: QuestDef[] = [
  { id: 'log_10', label: 'Log 10 trades this week', target: 10, metric: 'created' },
  { id: 'close_5', label: 'Close 5 trades this week', target: 5, metric: 'closed' },
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
 * When, for quest purposes, did the user DO the thing?
 *
 * ── Audit item 15, F7 (P2) ───────────────────────────────────────────────────
 *
 * XP is not a ledger. `profiles.xp` is never written; the number is recomputed
 * from the trades table on every read, and quest bonuses are awarded per UTC
 * calendar bucket. This function decides which bucket a trade lands in, so it
 * decides how farmable XP is.
 *
 * It used to return `traded_at` for the 'created' metric and `closed_at` for
 * the 'closed' one. Both are user-supplied. `createTrade` rejects only FUTURE
 * dates — backdating is permitted by design, because logging last week's trade
 * is a legitimate thing to do — so bulk-inserting backdated rows across the
 * past 90 days retroactively awarded 90 daily bonuses (30 XP each) and ~13
 * weekly bonuses (150 XP each) in a single sitting. The XP board is marketed
 * as the fair-play alternative to the P&L board and was derived from exactly
 * the same unconstrained input.
 *
 * The fix is to bucket on `created_at`, which is a Postgres column default and
 * is excluded from the client INSERT and UPDATE grants by migration 0045 —
 * verified live against `information_schema.column_privileges` — so it is the
 * one time on the row that the row's owner cannot choose.
 *
 * The 'closed' metric keeps `closed_at`, CLAMPED to not precede `created_at`.
 * The rule stated in words: a trade cannot be closed, as an act by a person,
 * before it was recorded. Legitimate behaviour is untouched — open Monday,
 * close Wednesday, and `closed_at` (Wednesday) is later than `created_at`
 * (Monday), so it buckets on Wednesday exactly as before. Backfilling a
 * already-closed trade from last month lands on today, because today is when
 * the user did the work. And a bulk backdated insert collapses into a single
 * bucket, which is worth one daily and one weekly bonus rather than months of
 * them.
 *
 * Falls back to the old fields when `created_at` is absent, so a caller that
 * forgets to select it degrades to the previous behaviour rather than silently
 * awarding zero XP to everybody. Every production read passes it
 * (`lib/server/xp.ts`).
 */
function metricTime(t: XpTrade, metric: QuestMetric): number | null {
  const created = t.created_at ? Date.parse(t.created_at) : NaN
  if (metric === 'created') return Number.isFinite(created) ? created : Date.parse(t.traded_at)
  if (t.status !== 'closed' || !t.closed_at) return null
  const closed = Date.parse(t.closed_at)
  if (!Number.isFinite(created)) return closed
  return Math.max(closed, created)
}
function countInBucket(trades: XpTrade[], metric: QuestMetric, start: number, end: number): number {
  let n = 0
  for (const t of trades) {
    const ts = metricTime(t, metric)
    if (ts != null && ts >= start && ts < end) n += 1
  }
  return n
}

export type QuestProgress = { id: string; label: string; target: number; current: number; done: boolean }

function progressFor(defs: QuestDef[], trades: XpTrade[], start: number, end: number): QuestProgress[] {
  return defs.map((q) => {
    const current = countInBucket(trades, q.metric, start, end)
    return { id: q.id, label: q.label, target: q.target, current, done: current >= q.target }
  })
}
export function dailyQuestProgress(trades: XpTrade[], now: number): QuestProgress[] {
  const start = utcDayStart(now)
  return progressFor(DAILY_QUESTS, trades, start, start + DAY)
}
export function weeklyQuestProgress(trades: XpTrade[], now: number): QuestProgress[] {
  const start = utcWeekStart(now)
  return progressFor(WEEKLY_QUESTS, trades, start, start + 7 * DAY)
}

function bucketCounts(trades: XpTrade[], metric: QuestMetric, keyOf: (ms: number) => string): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of trades) {
    const ts = metricTime(t, metric)
    if (ts == null) continue
    const k = keyOf(ts)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

export function closedCount(trades: XpTrade[]): number {
  return trades.filter((t) => t.status === 'closed').length
}
export function historicalDailyBonus(trades: XpTrade[]): number {
  let bonus = 0
  for (const q of DAILY_QUESTS)
    for (const c of bucketCounts(trades, q.metric, dayKey).values())
      if (c >= q.target) bonus += XP.DAILY_QUEST_BONUS
  return bonus
}
export function historicalWeeklyBonus(trades: XpTrade[]): number {
  let bonus = 0
  for (const q of WEEKLY_QUESTS)
    for (const c of bucketCounts(trades, q.metric, weekKey).values())
      if (c >= q.target) bonus += XP.WEEKLY_QUEST_BONUS
  return bonus
}
export function totalXpFromTrades(trades: XpTrade[]): number {
  return XP.BASE_PER_TRADE * closedCount(trades) + historicalDailyBonus(trades) + historicalWeeklyBonus(trades)
}

export function windowCutoff(period: Period, now: number): number | null {
  if (period === 'all') return null
  return now - (period === 'week' ? 7 : 30) * DAY
}
// Bonus XP attributed to a window by whole bucket: a day/week bucket counts if its
// UTC start is >= cutoff. This is intentionally a calendar-bucket approximation, not a
// rolling boundary (the base XP below uses the exact closed_at). A bucket straddling the
// cutoff is counted whole — acceptable since quests are inherently per-day/per-week units.
function windowBonus(trades: XpTrade[], defs: QuestDef[], keyOf: (ms: number) => string, perBonus: number, cutoff: number): number {
  let bonus = 0
  for (const q of defs)
    for (const [k, c] of bucketCounts(trades, q.metric, keyOf))
      if (c >= q.target && Date.parse(k + 'T00:00:00.000Z') >= cutoff) bonus += perBonus
  return bonus
}
export function windowXp(trades: XpTrade[], period: Period, now: number): number {
  const cutoff = windowCutoff(period, now)
  if (cutoff == null) return totalXpFromTrades(trades)
  let base = 0 // base XP gated on the exact closed_at; bonuses gated per calendar bucket (see windowBonus)
  for (const t of trades)
    if (t.status === 'closed' && t.closed_at && Date.parse(t.closed_at) >= cutoff) base += XP.BASE_PER_TRADE
  return base
    + windowBonus(trades, DAILY_QUESTS, dayKey, XP.DAILY_QUEST_BONUS, cutoff)
    + windowBonus(trades, WEEKLY_QUESTS, weekKey, XP.WEEKLY_QUEST_BONUS, cutoff)
}

// Per-metric day-bucket counts. Keyed by metric (not quest id) since each daily quest
// currently uses a distinct metric; revisit if two daily quests ever share a metric.
function dailyCountMaps(trades: XpTrade[]): Map<QuestMetric, Map<string, number>> {
  const per = new Map<QuestMetric, Map<string, number>>()
  for (const q of DAILY_QUESTS) if (!per.has(q.metric)) per.set(q.metric, bucketCounts(trades, q.metric, dayKey))
  return per
}
function dayComplete(per: Map<QuestMetric, Map<string, number>>, key: string): boolean {
  return DAILY_QUESTS.every((q) => (per.get(q.metric)!.get(key) ?? 0) >= q.target)
}

// Today counts toward the streak only if complete; if today is incomplete, the streak
// is the run of complete days ending yesterday (so a day-in-progress never zeroes it).
export function questStreak(trades: XpTrade[], now: number): number {
  const per = dailyCountMaps(trades)
  let cursor = utcDayStart(now)
  if (!dayComplete(per, dayKey(cursor))) cursor -= DAY
  let streak = 0
  while (dayComplete(per, dayKey(cursor))) { streak += 1; cursor -= DAY }
  return streak
}

export function maxQuestStreak(trades: XpTrade[]): number {
  const per = dailyCountMaps(trades)
  const keys = new Set<string>()
  for (const m of per.values()) for (const k of m.keys()) keys.add(k)
  const completeDays = [...keys].filter((k) => dayComplete(per, k))
    .map((k) => Date.parse(k + 'T00:00:00.000Z')).sort((a, b) => a - b)
  if (completeDays.length === 0) return 0
  let best = 1, run = 1
  for (let i = 1; i < completeDays.length; i++) {
    run = completeDays[i] - completeDays[i - 1] === DAY ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}

export function winStreakMax(trades: XpTrade[]): number {
  const closed = trades.filter((t) => t.status === 'closed' && t.closed_at)
    .sort((a, b) => Date.parse(a.closed_at!) - Date.parse(b.closed_at!))
  let best = 0, run = 0
  for (const t of closed) {
    if (t.outcome === 'win') { run += 1; if (run > best) best = run } else run = 0
  }
  return best
}

export type BadgeCategory = 'trades' | 'level' | 'questStreak' | 'winStreak' | 'lessons'
export type BadgeDef = { id: string; category: BadgeCategory; label: string; threshold: number }

export const BADGES: BadgeDef[] = [
  { id: 'trades_1', category: 'trades', label: 'First Trade', threshold: 1 },
  { id: 'trades_10', category: 'trades', label: '10 Trades', threshold: 10 },
  { id: 'trades_50', category: 'trades', label: '50 Trades', threshold: 50 },
  { id: 'trades_100', category: 'trades', label: '100 Trades', threshold: 100 },
  { id: 'trades_500', category: 'trades', label: '500 Trades', threshold: 500 },
  { id: 'level_5', category: 'level', label: 'Level 5', threshold: 5 },
  { id: 'level_10', category: 'level', label: 'Level 10', threshold: 10 },
  { id: 'level_25', category: 'level', label: 'Level 25', threshold: 25 },
  { id: 'streak_7', category: 'questStreak', label: '7-Day Streak', threshold: 7 },
  { id: 'streak_30', category: 'questStreak', label: '30-Day Streak', threshold: 30 },
  { id: 'wins_5', category: 'winStreak', label: '5 Win Streak', threshold: 5 },
  { id: 'wins_10', category: 'winStreak', label: '10 Win Streak', threshold: 10 },
  { id: 'lessons_1', category: 'lessons', label: 'First Lesson', threshold: 1 },
  { id: 'lessons_5', category: 'lessons', label: '5 Lessons', threshold: 5 },
  { id: 'lessons_25', category: 'lessons', label: '25 Lessons', threshold: 25 },
]

export type BadgeStats = { closedCount: number; level: number; maxQuestStreak: number; maxWinStreak: number; lessonsCompleted: number }
export type EvaluatedBadge = BadgeDef & { earned: boolean; current: number }

export function evaluateBadges(stats: BadgeStats): EvaluatedBadge[] {
  const value = (c: BadgeCategory): number =>
    c === 'trades' ? stats.closedCount
      : c === 'level' ? stats.level
      : c === 'questStreak' ? stats.maxQuestStreak
      : c === 'winStreak' ? stats.maxWinStreak
      : stats.lessonsCompleted
  return BADGES.map((b) => {
    const current = value(b.category)
    return { ...b, current, earned: current >= b.threshold }
  })
}
