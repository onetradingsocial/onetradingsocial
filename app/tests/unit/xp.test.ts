import { describe, it, expect } from 'vitest'
import {
  XP, xpForLevel, levelFromXp,
  DAILY_QUESTS, WEEKLY_QUESTS, utcDayStart, utcWeekStart, dayKey, weekKey,
  dailyQuestProgress, weeklyQuestProgress, type XpTrade,
  closedCount, baseTradeXp, windowTradeXp, windowCutoff,
  historicalDailyBonus, historicalWeeklyBonus, totalProcessXp, processWindowXp,
  questStreak, maxQuestStreak, evaluateBadges, BADGES,
} from '@/lib/xp'
import type { ProcessLog } from '@/lib/process'

/**
 * ── Audit 2026-09-05, P0 ─────────────────────────────────────────────────────
 *
 * Quests, streaks and badges used to be computed from `trades`. They are now
 * computed from `process_logs`, and the trades table contributes exactly one
 * thing: a flat `BASE_PER_TRADE` per closed trade, with no threshold, streak or
 * quota resting on it. The tests below are split along that line — anything
 * taking `XpTrade[]` is testing the flat part; everything else takes
 * `ProcessLog[]`.
 *
 * The "no reward requires a trade" invariant itself is asserted structurally in
 * `process-rewards.test.ts`, not here.
 */

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

/** A process entry on `day`. Defaults to the cheapest kind to record. */
const p = (day: string, kind: ProcessLog['kind'] = 'no_trade', outcome: ProcessLog['outcome'] = null): ProcessLog =>
  ({ kind, day, outcome })

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

describe('quest definitions', () => {
  it('there is exactly one daily quest, and it accepts any process entry', () => {
    // Load-bearing: `questStreak` requires EVERY daily quest to be met, so a
    // second daily quest would be a second thing a resting trader must do to
    // keep the chain alive.
    expect(DAILY_QUESTS.map((q) => q.id)).toEqual(['daily_process'])
    expect(DAILY_QUESTS[0]).toMatchObject({ target: 1, source: 'any_process' })
  })
  it('weekly quests are a review and three reflection days', () => {
    expect(WEEKLY_QUESTS.map((q) => q.id)).toEqual(['weekly_review', 'weekly_reflect'])
    expect(WEEKLY_QUESTS.find((q) => q.id === 'weekly_review')).toMatchObject({ target: 1, source: 'review' })
    expect(WEEKLY_QUESTS.find((q) => q.id === 'weekly_reflect')).toMatchObject({ target: 3, source: 'reflection_days' })
  })
})

describe('quest progress (current window)', () => {
  const now = Date.parse('2026-06-22T12:00:00Z')

  it('daily: any single process entry today completes the day', () => {
    const d = dailyQuestProgress([p('2026-06-22', 'review')], now)
    expect(d.find((q) => q.id === 'daily_process')).toMatchObject({ current: 1, target: 1, done: true })
  })

  it('daily: yesterday does not count toward today', () => {
    const d = dailyQuestProgress([p('2026-06-21', 'review')], now)
    expect(d.find((q) => q.id === 'daily_process')).toMatchObject({ current: 0, done: false })
  })

  it('daily: four entries on one day are still one day of credit', () => {
    // The unique index caps this in the DB; the counter agrees with it.
    const logs = [
      p('2026-06-22', 'review'), p('2026-06-22', 'rule_reflection', 'unknown'),
      p('2026-06-22', 'no_trade'), p('2026-06-22', 'rest'),
    ]
    expect(dailyQuestProgress(logs, now).find((q) => q.id === 'daily_process')?.current).toBe(1)
  })

  it('weekly: one review this week meets weekly_review', () => {
    const w = weeklyQuestProgress([p('2026-06-23', 'review')], now)
    expect(w.find((q) => q.id === 'weekly_review')).toMatchObject({ current: 1, target: 1, done: true })
  })

  it('weekly: reflection quest counts DISTINCT days, any outcome', () => {
    const logs = [
      p('2026-06-22', 'rule_reflection', 'followed'),
      p('2026-06-23', 'rule_reflection', 'broke'),
      p('2026-06-24', 'rule_reflection', 'unknown'),
    ]
    const w = weeklyQuestProgress(logs, now)
    expect(w.find((q) => q.id === 'weekly_reflect')).toMatchObject({ current: 3, target: 3, done: true })
  })

  it('weekly: entries in the previous ISO week do not leak in', () => {
    // 2026-06-21 is a Sunday — the tail of the PREVIOUS week.
    const w = weeklyQuestProgress([p('2026-06-21', 'review')], now)
    expect(w.find((q) => q.id === 'weekly_review')).toMatchObject({ current: 0, done: false })
  })
})

describe('quest bonuses', () => {
  it('one process day = one daily bonus', () => {
    expect(historicalDailyBonus([p('2026-06-22')])).toBe(XP.DAILY_QUEST_BONUS)
  })

  it('daily bonus is per calendar day, not per entry', () => {
    const oneDay = [p('2026-06-22', 'review'), p('2026-06-22', 'rest'), p('2026-06-22', 'no_trade')]
    expect(historicalDailyBonus(oneDay)).toBe(XP.DAILY_QUEST_BONUS)
    const threeDays = [p('2026-06-20'), p('2026-06-21'), p('2026-06-22')]
    expect(historicalDailyBonus(threeDays)).toBe(3 * XP.DAILY_QUEST_BONUS)
  })

  it('weekly bonuses are per ISO week and per quest', () => {
    const logs = [
      p('2026-06-22', 'review'),
      p('2026-06-22', 'rule_reflection', 'followed'),
      p('2026-06-23', 'rule_reflection', 'unknown'),
      p('2026-06-24', 'rule_reflection', 'broke'),
    ]
    // Both weekly quests met inside the one week.
    expect(historicalWeeklyBonus(logs)).toBe(2 * XP.WEEKLY_QUEST_BONUS)
  })

  it('a week short of the reflection target pays only the review bonus', () => {
    const logs = [p('2026-06-22', 'review'), p('2026-06-23', 'rule_reflection', 'followed')]
    expect(historicalWeeklyBonus(logs)).toBe(XP.WEEKLY_QUEST_BONUS)
  })

  it('a week spanning a Monday boundary scores each week on its own', () => {
    // 2026-06-21 Sun (week of 06-15), 2026-06-22 Mon (week of 06-22).
    const logs = [p('2026-06-21', 'review'), p('2026-06-22', 'review')]
    expect(historicalWeeklyBonus(logs)).toBe(2 * XP.WEEKLY_QUEST_BONUS)
  })

  it('totalProcessXp is the sum of both ladders and needs no trade at all', () => {
    const logs = [p('2026-06-22', 'review')]
    expect(totalProcessXp(logs)).toBe(XP.DAILY_QUEST_BONUS + XP.WEEKLY_QUEST_BONUS)
  })

  it('no process entries -> no quest XP', () => {
    expect(totalProcessXp([])).toBe(0)
    expect(historicalDailyBonus([])).toBe(0)
    expect(historicalWeeklyBonus([])).toBe(0)
  })
})

describe('windowed XP', () => {
  const now = Date.parse('2026-06-22T12:00:00Z')

  it('windowCutoff: week=now-7d, month=now-30d, all=null', () => {
    expect(windowCutoff('all', now)).toBeNull()
    expect(windowCutoff('week', now)).toBe(now - 7 * 864e5)
    expect(windowCutoff('month', now)).toBe(now - 30 * 864e5)
  })

  it('trade XP: all-period equals the flat total', () => {
    const trades = [mk('2026-06-22T01:00:00Z', '2026-06-22T02:00:00Z')]
    expect(windowTradeXp(trades, 'all', now)).toBe(baseTradeXp(trades))
  })

  it('trade XP: the week window excludes trades closed before the cutoff', () => {
    const trades = [
      mk('2026-06-21T00:00:00Z', '2026-06-21T01:00:00Z'),
      mk('2026-05-01T00:00:00Z', '2026-05-01T01:00:00Z'),
    ]
    // Flat only — no quest bonus rides on a trade any more.
    expect(windowTradeXp(trades, 'week', now)).toBe(XP.BASE_PER_TRADE)
  })

  it('process XP: all-period equals the historical total', () => {
    const logs = [p('2026-06-22', 'review')]
    expect(processWindowXp(logs, 'all', now)).toBe(totalProcessXp(logs))
  })

  it('process XP: buckets starting before the cutoff drop out of the window', () => {
    const logs = [p('2026-06-22'), p('2026-03-02')]
    // Only the recent day survives a 7-day window; its week does too.
    expect(processWindowXp(logs, 'week', now)).toBe(XP.DAILY_QUEST_BONUS)
    expect(processWindowXp(logs, 'all', now)).toBe(2 * XP.DAILY_QUEST_BONUS)
  })
})

describe('flat trade XP', () => {
  it('closedCount counts only closed trades', () => {
    expect(closedCount([mk('2026-06-22T01:00:00Z', '2026-06-22T02:00:00Z'), mk('2026-06-22T03:00:00Z')])).toBe(1)
  })
  it('baseTradeXp is linear — the 100th closed trade is worth the 1st', () => {
    const one = [mk('2026-06-22T01:00:00Z', '2026-06-22T02:00:00Z')]
    const many = Array.from({ length: 100 }, (_, i) =>
      mk(`2026-06-22T01:00:0${i % 10}Z`, `2026-06-22T02:00:0${i % 10}Z`))
    expect(baseTradeXp(one)).toBe(XP.BASE_PER_TRADE)
    expect(baseTradeXp(many)).toBe(100 * XP.BASE_PER_TRADE)
  })
  it('trades carry no quest bonus of their own any more', () => {
    // The regression this guards: re-attaching a bonus to trade volume.
    const trades = Array.from({ length: 30 }, (_, i) =>
      mk(`2026-06-${String(i % 28 + 1).padStart(2, '0')}T01:00:00Z`, `2026-06-${String(i % 28 + 1).padStart(2, '0')}T02:00:00Z`))
    expect(baseTradeXp(trades)).toBe(30 * XP.BASE_PER_TRADE)
    // Whatever the trades say, quest XP comes from an empty process log: zero.
    expect(totalProcessXp([])).toBe(0)
  })
})

describe('streaks', () => {
  const now = Date.parse('2026-06-22T12:00:00Z')

  it('questStreak counts consecutive process days up to today', () => {
    const logs = [p('2026-06-22'), p('2026-06-21'), p('2026-06-20')]
    expect(questStreak(logs, now)).toBe(3)
  })
  it('today incomplete -> the streak is the run ending yesterday', () => {
    expect(questStreak([p('2026-06-21'), p('2026-06-20')], now)).toBe(2)
  })
  it('a gap breaks the streak', () => {
    expect(questStreak([p('2026-06-22'), p('2026-06-20')], now)).toBe(1)
  })
  it('maxQuestStreak finds the longest historical run', () => {
    expect(maxQuestStreak([p('2026-06-01'), p('2026-06-02'), p('2026-06-22')])).toBe(2)
  })
  it('duplicate days do not inflate the longest run', () => {
    const logs = [p('2026-06-01', 'review'), p('2026-06-01', 'rest'), p('2026-06-01', 'no_trade')]
    expect(maxQuestStreak(logs)).toBe(1)
  })
  it('empty logs -> all streaks are 0', () => {
    expect(questStreak([], now)).toBe(0)
    expect(maxQuestStreak([])).toBe(0)
  })
  it('a malformed day key cannot be counted as a complete day', () => {
    expect(maxQuestStreak([{ kind: 'rest', day: 'not-a-date', outcome: null }])).toBe(0)
  })
})

describe('evaluateBadges', () => {
  it('marks earned vs locked with current progress', () => {
    const badges = evaluateBadges({ reviewsCompleted: 12, level: 3, maxQuestStreak: 7, lessonsCompleted: 0 })
    expect(badges.find((b) => b.id === 'reviews_10')).toMatchObject({ earned: true, current: 12 })
    expect(badges.find((b) => b.id === 'reviews_25')).toMatchObject({ earned: false, current: 12 })
    expect(badges.find((b) => b.id === 'level_5')).toMatchObject({ earned: false, current: 3 })
    expect(badges.find((b) => b.id === 'streak_7')).toMatchObject({ earned: true, current: 7 })
    expect(badges.find((b) => b.id === 'streak_30')).toMatchObject({ earned: false, current: 7 })
  })
  it('declares exactly the four surviving badge categories', () => {
    // 'trades' and 'winStreak' are gone — audit 2026-09-05 P0.
    expect(new Set(BADGES.map((b) => b.category)))
      .toEqual(new Set(['reviews', 'level', 'questStreak', 'lessons']))
  })
  it('earns lesson badges by lessonsCompleted', () => {
    const badges = evaluateBadges({ reviewsCompleted: 0, level: 1, maxQuestStreak: 0, lessonsCompleted: 6 })
    expect(badges.find((b) => b.id === 'lessons_1')).toMatchObject({ earned: true, current: 6 })
    expect(badges.find((b) => b.id === 'lessons_5')).toMatchObject({ earned: true, current: 6 })
    expect(badges.find((b) => b.id === 'lessons_25')).toMatchObject({ earned: false, current: 6 })
  })
  it('an account that has never traded can still earn every non-lesson badge', () => {
    const badges = evaluateBadges({ reviewsCompleted: 25, level: 25, maxQuestStreak: 30, lessonsCompleted: 0 })
    const earned = badges.filter((b) => b.earned).map((b) => b.id)
    expect(earned).toEqual(expect.arrayContaining([
      'reviews_1', 'reviews_10', 'reviews_25', 'level_5', 'level_10', 'level_25', 'streak_7', 'streak_30',
    ]))
  })
})
