import { describe, it, expect } from 'vitest'
import {
  XP, xpForLevel, levelFromXp,
  DAILY_QUESTS, WEEKLY_QUESTS, utcDayStart, utcWeekStart, dayKey, weekKey,
  dailyQuestProgress, weeklyQuestProgress, type XpTrade,
  closedCount, totalXpFromTrades, windowXp, windowCutoff,
  historicalDailyBonus, historicalWeeklyBonus,
} from '@/lib/xp'

describe('xpForLevel', () => {
  it('cumulative rising cost: reach(L) = 100*(L-1)*L/2', () => {
    expect(xpForLevel(1)).toBe(0)
    expect(xpForLevel(2)).toBe(100)
    expect(xpForLevel(3)).toBe(300)
    expect(xpForLevel(5)).toBe(1000)
    expect(xpForLevel(10)).toBe(4500)
    expect(xpForLevel(25)).toBe(30000)
  })
})

describe('levelFromXp', () => {
  it('returns level 1 at 0 XP with progress toward L2', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpToNext: 100, progress: 0 })
  })
  it('crosses to next level exactly at the threshold', () => {
    expect(levelFromXp(100).level).toBe(2)
    expect(levelFromXp(99).level).toBe(1)
    expect(levelFromXp(1000).level).toBe(5)
  })
  it('reports progress fraction within the current level', () => {
    const r = levelFromXp(150)
    expect(r).toEqual({ level: 2, xpIntoLevel: 50, xpToNext: 200, progress: 0.25 })
  })
  it('clamps negatives to level 1', () => {
    expect(levelFromXp(-10).level).toBe(1)
  })
  it('exposes tunable constants', () => {
    expect(XP.BASE_PER_TRADE).toBe(50)
  })
})

const mk = (t: string, c: string | null = null, o = 'win'): XpTrade =>
  ({ traded_at: t, closed_at: c, status: c ? 'closed' : 'open', outcome: o })

describe('UTC boundaries', () => {
  it('utcDayStart floors to 00:00:00Z', () => {
    expect(new Date(utcDayStart(Date.parse('2026-06-22T15:30:00Z'))).toISOString())
      .toBe('2026-06-22T00:00:00.000Z')
  })
  it('utcWeekStart floors to Monday 00:00Z (ISO week)', () => {
    expect(new Date(utcWeekStart(Date.parse('2026-06-24T10:00:00Z'))).toISOString())
      .toBe('2026-06-22T00:00:00.000Z')
    expect(new Date(utcWeekStart(Date.parse('2026-06-21T10:00:00Z'))).toISOString())
      .toBe('2026-06-15T00:00:00.000Z')
  })
  it('dayKey/weekKey are stable UTC bucket labels', () => {
    expect(dayKey(Date.parse('2026-06-22T23:59:00Z'))).toBe('2026-06-22')
    expect(weekKey(Date.parse('2026-06-24T10:00:00Z'))).toBe('2026-06-22')
  })
})

describe('quest progress (current window)', () => {
  const now = Date.parse('2026-06-22T12:00:00Z')
  it('daily: counts today created vs closed per quest', () => {
    const trades = [
      mk('2026-06-22T01:00:00Z', '2026-06-22T02:00:00Z'),
      mk('2026-06-21T23:00:00Z'),
    ]
    const d = dailyQuestProgress(trades, now)
    expect(d.find((q) => q.id === 'log_trade')).toMatchObject({ current: 1, target: 1, done: true })
    expect(d.find((q) => q.id === 'close_trade')).toMatchObject({ current: 1, target: 1, done: true })
  })
  it('weekly: 10 created this week meets log_10', () => {
    const trades = Array.from({ length: 10 }, (_, i) => mk(`2026-06-22T0${i % 8}:0${i % 6}:00Z`, null))
    const w = weeklyQuestProgress(trades, now)
    expect(w.find((q) => q.id === 'log_10')).toMatchObject({ current: 10, target: 10, done: true })
  })
  it('exposes quest definitions as data', () => {
    expect(DAILY_QUESTS.map((q) => q.id)).toEqual(['log_trade', 'close_trade'])
    expect(WEEKLY_QUESTS.map((q) => q.id)).toEqual(['log_10', 'close_5'])
  })
})

describe('totals & bonuses', () => {
  it('totalXpFromTrades = trades*BASE + daily + weekly bonuses', () => {
    const trades = [mk('2026-06-22T01:00:00Z', '2026-06-22T02:00:00Z')]
    expect(closedCount(trades)).toBe(1)
    expect(historicalDailyBonus(trades)).toBe(60)
    expect(historicalWeeklyBonus(trades)).toBe(0)
    expect(totalXpFromTrades(trades)).toBe(110)
  })
  it('weekly bonus triggers once 10 created in a week', () => {
    const trades = Array.from({ length: 10 }, (_, i) => mk(`2026-06-22T0${i % 8}:0${i % 6}:00Z`, null))
    expect(historicalWeeklyBonus(trades)).toBe(150)
  })
})

describe('windowXp', () => {
  const now = Date.parse('2026-06-22T12:00:00Z')
  it('all-period equals total', () => {
    const trades = [mk('2026-06-22T01:00:00Z', '2026-06-22T02:00:00Z')]
    expect(windowXp(trades, 'all', now)).toBe(totalXpFromTrades(trades))
  })
  it('week window excludes trades closed before the cutoff', () => {
    const trades = [
      mk('2026-06-21T00:00:00Z', '2026-06-21T01:00:00Z'),
      mk('2026-05-01T00:00:00Z', '2026-05-01T01:00:00Z'),
    ]
    expect(windowXp(trades, 'week', now)).toBe(110)
  })
  it('windowCutoff: week=now-7d, month=now-30d, all=null', () => {
    expect(windowCutoff('all', now)).toBeNull()
    expect(windowCutoff('week', now)).toBe(now - 7 * 864e5)
    expect(windowCutoff('month', now)).toBe(now - 30 * 864e5)
  })
})
