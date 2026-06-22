export type Period = 'week' | 'month' | 'all'

export type XpTrade = {
  traded_at: string
  closed_at: string | null
  status: 'open' | 'closed'
  outcome: string
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

function metricTime(t: XpTrade, metric: QuestMetric): number | null {
  if (metric === 'created') return Date.parse(t.traded_at)
  if (t.status === 'closed' && t.closed_at) return Date.parse(t.closed_at)
  return null
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
  let base = 0
  for (const t of trades)
    if (t.status === 'closed' && t.closed_at && Date.parse(t.closed_at) >= cutoff) base += XP.BASE_PER_TRADE
  return base
    + windowBonus(trades, DAILY_QUESTS, dayKey, XP.DAILY_QUEST_BONUS, cutoff)
    + windowBonus(trades, WEEKLY_QUESTS, weekKey, XP.WEEKLY_QUEST_BONUS, cutoff)
}
