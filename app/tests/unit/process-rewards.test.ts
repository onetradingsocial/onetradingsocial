import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DAILY_QUESTS, WEEKLY_QUESTS, BADGES, XP,
  dailyQuestProgress, weeklyQuestProgress, questStreak, maxQuestStreak,
  totalProcessXp, evaluateBadges, type QuestDef, type BadgeDef,
} from '@/lib/xp'
import {
  PROCESS_KINDS, REFLECTION_OUTCOMES, validateEntry, processDays, daysWithKind,
  flatDays, reviewCount, entriesForDay, isProcessKind, isReflectionOutcome,
  type ProcessLog,
} from '@/lib/process'
import { getProcessLogs } from '@/lib/server/process'
import { getGoalsWithProgress } from '@/lib/server/goals'
import { computeStreaks, weekChain } from '@/lib/streaks'

/**
 * ── Audit 2026-09-05, P0: the reward system paid people to trade ─────────────
 *
 * Daily quests were "log a trade" and "close a trade". Weekly quests were "log
 * 10" and "close 5". Badges counted closed trades (1/10/50/100/500) and win
 * streaks (5/10). In a product sold on trading discipline, every one of those
 * is a paid incentive to take the next marginal trade, and a week whose correct
 * answer was "stand aside" scored zero on every axis and broke every streak.
 *
 * This file pins the replacement. The load-bearing claim is the first describe
 * block: NO quest and NO badge can be moved by placing or closing a trade.
 */

const p = (day: string, kind: ProcessLog['kind'] = 'no_trade', outcome: ProcessLog['outcome'] = null): ProcessLog =>
  ({ kind, day, outcome })

type Row = Record<string, unknown>

/**
 * Minimal PostgREST-shaped fake, same idiom as funnel-internal-filter.test.ts:
 * records `.eq()`/`.gte()` filters and applies them to the table's fixture rows.
 */
function fakeSupabase(tables: Record<string, Row[]>): SupabaseClient {
  const make = (table: string) => {
    const eqs: [string, unknown][] = []
    const gtes: [string, unknown][] = []
    const builder: Record<string, unknown> = {}
    const self = () => builder
    for (const m of ['select', 'neq', 'not', 'in', 'order', 'limit']) builder[m] = self
    builder.eq = (col: string, val: unknown) => { eqs.push([col, val]); return builder }
    builder.gte = (col: string, val: unknown) => { gtes.push([col, val]); return builder }
    builder.then = (resolve: (v: unknown) => unknown) => {
      const rows = (tables[table] ?? [])
        .filter((r) => eqs.every(([c, v]) => r[c] === v))
        .filter((r) => gtes.every(([c, v]) => String(r[c]) >= String(v)))
      return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve)
    }
    return builder
  }
  return { from: (t: string) => make(t) } as unknown as SupabaseClient
}

/* ───────────────────────────────────────────────────────────────────────────
 * 1. The invariant: nothing in the reward system requires a trade
 * ────────────────────────────────────────────────────────────────────────── */

describe('no quest or badge can be moved by placing or closing a trade', () => {
  /** Every source a quest is allowed to read. All live in `process_logs`. */
  const PROCESS_SOURCES = new Set(['any_process', 'review', 'reflection_days'])
  /** Every category a badge is allowed to score. None is trade-derived. */
  const PROCESS_CATEGORIES = new Set(['reviews', 'level', 'questStreak', 'lessons'])

  it('every daily and weekly quest reads a process source', () => {
    const all: QuestDef[] = [...DAILY_QUESTS, ...WEEKLY_QUESTS]
    expect(all.length).toBeGreaterThan(0)
    for (const q of all) {
      expect(PROCESS_SOURCES, `quest '${q.id}' reads a non-process source '${q.source}'`)
        .toContain(q.source)
    }
  })

  it('every badge scores a process category — no trade count, no win streak', () => {
    const all: BadgeDef[] = BADGES
    for (const b of all) {
      expect(PROCESS_CATEGORIES, `badge '${b.id}' scores a non-process category '${b.category}'`)
        .toContain(b.category)
    }
  })

  it('the removed quests and badges are gone by id, not merely relabelled', () => {
    const questIds = [...DAILY_QUESTS, ...WEEKLY_QUESTS].map((q) => q.id)
    for (const dead of ['log_trade', 'close_trade', 'log_10', 'close_5']) {
      expect(questIds).not.toContain(dead)
    }
    const badgeIds = BADGES.map((b) => b.id)
    for (const dead of ['trades_1', 'trades_10', 'trades_50', 'trades_100', 'trades_500', 'wins_5', 'wins_10']) {
      expect(badgeIds).not.toContain(dead)
    }
  })

  it('no quest label asks the user to place or close a trade', () => {
    // The wording is the promise the user reads; it has to match the mechanic.
    for (const q of [...DAILY_QUESTS, ...WEEKLY_QUESTS]) {
      expect(/\b(close|closing)\b.*\btrade/i.test(q.label), `quest '${q.id}': ${q.label}`).toBe(false)
      expect(/\blog\s+\d+\s+trades?\b/i.test(q.label), `quest '${q.id}': ${q.label}`).toBe(false)
    }
  })

  it('BadgeStats carries no trade-derived field', () => {
    // A compile-time guarantee too (BadgeStats has no closedCount/maxWinStreak),
    // asserted at runtime so a widened type cannot pass silently.
    const evaluated = evaluateBadges({ reviewsCompleted: 0, level: 1, maxQuestStreak: 0, lessonsCompleted: 0 })
    expect(evaluated.every((b) => b.current === 0 || b.category === 'level')).toBe(true)
    expect(evaluated.some((b) => b.earned && b.category !== 'level')).toBe(false)
  })

  it('a heavy trading history with no process entries earns no quest, streak or XP', () => {
    // The direction that matters: volume alone buys nothing any more.
    const now = Date.parse('2026-06-22T12:00:00Z')
    const noLogs: ProcessLog[] = []
    expect(dailyQuestProgress(noLogs, now).every((q) => !q.done)).toBe(true)
    expect(weeklyQuestProgress(noLogs, now).every((q) => !q.done)).toBe(true)
    expect(questStreak(noLogs, now)).toBe(0)
    expect(maxQuestStreak(noLogs)).toBe(0)
    expect(totalProcessXp(noLogs)).toBe(0)
    expect(reviewCount(noLogs)).toBe(0)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 2. A week that traded nothing can be a successful week
 * ────────────────────────────────────────────────────────────────────────── */

describe('a no-trade week completes rewards', () => {
  // Mon 2026-06-22 .. Sun 2026-06-28. `now` is the Sunday evening.
  const WEEK = ['2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28']
  const now = Date.parse('2026-06-28T20:00:00Z')

  it('a week of nothing but planned days out keeps the daily quest and streak alive', () => {
    const logs = WEEK.map((d) => p(d, 'no_trade'))
    expect(dailyQuestProgress(logs, now).find((q) => q.id === 'daily_process')?.done).toBe(true)
    expect(questStreak(logs, now)).toBe(7)
    expect(maxQuestStreak(logs)).toBe(7)
    // Seven daily bonuses, with not one trade placed.
    expect(totalProcessXp(logs)).toBe(7 * XP.DAILY_QUEST_BONUS)
  })

  it('scheduled rest counts exactly as much as a review', () => {
    const rested = WEEK.map((d) => p(d, 'rest'))
    const reviewed = WEEK.map((d) => p(d, 'review'))
    expect(questStreak(rested, now)).toBe(questStreak(reviewed, now))
    expect(dailyQuestProgress(rested, now)[0].done).toBe(dailyQuestProgress(reviewed, now)[0].done)
  })

  it('a flat week can complete BOTH weekly quests and score a perfect week', () => {
    // No trade was taken all week. The trader reviewed once, reflected on three
    // days, and stood aside or rested on the rest.
    const logs: ProcessLog[] = [
      p('2026-06-22', 'review'),
      p('2026-06-22', 'rule_reflection', 'followed'),
      p('2026-06-23', 'rule_reflection', 'unknown'),
      p('2026-06-24', 'rule_reflection', 'broke'),
      p('2026-06-25', 'no_trade'),
      p('2026-06-26', 'no_trade'),
      p('2026-06-27', 'rest'),
      p('2026-06-28', 'rest'),
    ]
    const weekly = weeklyQuestProgress(logs, now)
    expect(weekly.find((q) => q.id === 'weekly_review')?.done).toBe(true)
    expect(weekly.find((q) => q.id === 'weekly_reflect')?.done).toBe(true)
    expect(questStreak(logs, now)).toBe(7)
    expect(totalProcessXp(logs)).toBe(7 * XP.DAILY_QUEST_BONUS + 2 * XP.WEEKLY_QUEST_BONUS)
  })

  it('the week chain paints a flat week as shown-up, not as seven misses', () => {
    // weekChain takes the union the caller builds (trade days + process days).
    // With no trades, the process days alone must fill the chain.
    const logs = WEEK.map((d) => p(d, 'no_trade'))
    // Mon..Sun all recorded, viewed on the Sunday: every cell filled.
    expect(weekChain(processDays(logs), '2026-06-28')).toEqual(Array(7).fill('done'))
    // And the same week WITHOUT the process days is what it used to paint: the
    // days already past read as misses.
    const bare = weekChain([], '2026-06-28')
    expect(bare.filter((c) => c === 'missed')).toHaveLength(6)
    expect(bare[6]).toBe('today')
  })

  it('the journaling and compliance streaks survive a deliberate flat day', () => {
    // Journal: no trade rows at all, process days carry it.
    // Compliance: a day nothing was traded is folded in as perfect compliance —
    // without that, "rule compliance" only counts days you had a position.
    const logs = WEEK.map((d) => p(d, 'no_trade'))
    const streaks = computeStreaks({
      journalDays: [],
      processDays: processDays(logs),
      reviewDays: [],
      compliantDays: flatDays(logs),
      learningDays: [],
      todayKey: '2026-06-28',
    })
    expect(streaks.find((s) => s.id === 'journal')?.days).toBe(7)
    expect(streaks.find((s) => s.id === 'compliance')?.days).toBe(7)
  })

  it('flatDays covers both standing aside and scheduled rest, and nothing else', () => {
    const logs = [p('2026-06-22', 'no_trade'), p('2026-06-23', 'rest'), p('2026-06-24', 'review')]
    expect(new Set(flatDays(logs))).toEqual(new Set(['2026-06-22', '2026-06-23']))
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 3. Two review sources, deduplicated to one per day
 * ────────────────────────────────────────────────────────────────────────── */

describe('review goal counts both sources, one per day', () => {
  /**
   * `weekly_review_viewed` has one emitter — WeeklyReviewCard — which returns
   * null for Free users, so counting it alone pinned `weekly_reviews` at 0/N
   * for every Free account. `process_logs` is the ungated second source. The
   * plan gate on the card is untouched; a paid user's card view still counts.
   */
  const now = Date.parse('2026-06-22T12:00:00Z')
  const goalRow = { id: 1, kind: 'weekly_reviews', target: 4, window_days: 30, user_id: 'u1', active: true, created_at: '2026-01-01' }
  const rules = {} as never

  const run = (events: string[], logDays: string[]) => getGoalsWithProgress(
    fakeSupabase({
      process_goals: [goalRow],
      analytics_events: events.map((created_at) => ({ user_id: 'u1', event: 'weekly_review_viewed', created_at })),
      process_logs: logDays.map((day) => ({ user_id: 'u1', kind: 'review', day })),
    }),
    'u1', [], rules, now,
  )

  it('a Free user with only self-recorded reviews makes progress', async () => {
    // Before the second source this returned 0 for this user, always.
    const [goal] = await run([], ['2026-06-20', '2026-06-19', '2026-06-18'])
    expect(goal.progress.current).toBe(3)
  })

  it('a paid user with only card views is unchanged', async () => {
    const [goal] = await run(['2026-06-20T09:00:00Z', '2026-06-19T09:00:00Z'], [])
    expect(goal.progress.current).toBe(2)
  })

  it('both sources on the SAME day count once, not twice', async () => {
    // A paid user who viewed the card and also ticked the entry has done one
    // review that day. This is the dedupe the Set exists for.
    const [goal] = await run(['2026-06-20T09:00:00Z'], ['2026-06-20'])
    expect(goal.progress.current).toBe(1)
  })

  it('two card views on the same day also count once', async () => {
    const [goal] = await run(['2026-06-20T09:00:00Z', '2026-06-20T17:30:00Z'], [])
    expect(goal.progress.current).toBe(1)
  })

  it('sources on different days add up across both', async () => {
    const [goal] = await run(['2026-06-20T09:00:00Z'], ['2026-06-21', '2026-06-20'])
    // 06-20 is shared, 06-21 is only a log => two distinct review days.
    expect(goal.progress.current).toBe(2)
    expect(goal.progress.met).toBe(false) // target is 4
  })

  it('reaching the target from self-recorded reviews alone meets the goal', async () => {
    const [goal] = await run([], ['2026-06-21', '2026-06-20', '2026-06-19', '2026-06-18'])
    expect(goal.progress).toMatchObject({ current: 4, met: true })
  })

  it('the journal review streak unions the same two sources', async () => {
    const logs = [p('2026-06-22', 'review'), p('2026-06-21', 'review')]
    const streaks = computeStreaks({
      journalDays: [],
      processDays: processDays(logs),
      // Card view on 06-20 plus self-recorded reviews on 21 and 22.
      reviewDays: [...new Set(['2026-06-20', ...daysWithKind(logs, 'review')])],
      compliantDays: [],
      learningDays: [],
      todayKey: '2026-06-22',
    })
    expect(streaks.find((s) => s.id === 'review')?.days).toBe(3)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 4. "unknown" is a first-class reflection outcome
 * ────────────────────────────────────────────────────────────────────────── */

describe('the unknown reflection state', () => {
  /**
   * Paying only for 'followed' pays for the ANSWER rather than for the
   * reflection, and pushes a trader toward the flattering one. A trader who
   * genuinely cannot tell whether they followed their plan has learned the most
   * useful thing available that day.
   */
  const now = Date.parse('2026-06-24T12:00:00Z')

  it('is an accepted outcome at the validation boundary', () => {
    expect(REFLECTION_OUTCOMES).toContain('unknown')
    expect(isReflectionOutcome('unknown')).toBe(true)
    expect(validateEntry('rule_reflection', 'unknown')).toEqual({ kind: 'rule_reflection', outcome: 'unknown' })
  })

  it('scores identically to followed and broke on the daily quest', () => {
    const day = '2026-06-24'
    for (const o of REFLECTION_OUTCOMES) {
      const d = dailyQuestProgress([p(day, 'rule_reflection', o)], now)
      expect(d.find((q) => q.id === 'daily_process'), `outcome '${o}'`).toMatchObject({ done: true })
    }
  })

  it('counts toward the weekly reflection quest like any other outcome', () => {
    const allUnknown = [
      p('2026-06-22', 'rule_reflection', 'unknown'),
      p('2026-06-23', 'rule_reflection', 'unknown'),
      p('2026-06-24', 'rule_reflection', 'unknown'),
    ]
    expect(weeklyQuestProgress(allUnknown, now).find((q) => q.id === 'weekly_reflect')?.done).toBe(true)
  })

  it('earns the same XP as a week of clean "followed" answers', () => {
    const week = ['2026-06-22', '2026-06-23', '2026-06-24']
    const unknown = week.map((d) => p(d, 'rule_reflection', 'unknown'))
    const followed = week.map((d) => p(d, 'rule_reflection', 'followed'))
    expect(totalProcessXp(unknown)).toBe(totalProcessXp(followed))
  })

  it('survives the round trip out of the database', async () => {
    const svc = fakeSupabase({
      process_logs: [
        { user_id: 'u1', kind: 'rule_reflection', day: '2026-06-24', outcome: 'unknown' },
        { user_id: 'u1', kind: 'rule_reflection', day: '2026-06-23', outcome: 'broke' },
      ],
    })
    const logs = await getProcessLogs(svc, 'u1')
    expect(logs.find((l) => l.day === '2026-06-24')?.outcome).toBe('unknown')
    expect(logs.find((l) => l.day === '2026-06-23')?.outcome).toBe('broke')
  })

  it('an unrecognised outcome is dropped rather than mis-scored', async () => {
    const svc = fakeSupabase({
      process_logs: [
        { user_id: 'u1', kind: 'rule_reflection', day: '2026-06-24', outcome: 'maybe' },
        { user_id: 'u1', kind: 'not_a_kind', day: '2026-06-24', outcome: null },
      ],
    })
    const logs = await getProcessLogs(svc, 'u1')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ kind: 'rule_reflection', outcome: null })
  })

  it('the card shows the outcome the user last chose', () => {
    const logs = [p('2026-06-24', 'rule_reflection', 'unknown'), p('2026-06-24', 'review')]
    expect(entriesForDay(logs, '2026-06-24')).toEqual(expect.arrayContaining([
      { kind: 'rule_reflection', outcome: 'unknown' },
      { kind: 'review', outcome: null },
    ]))
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 5. The write boundary mirrors the DB constraints (migration 0070)
 * ────────────────────────────────────────────────────────────────────────── */

describe('validateEntry mirrors the 0070 check constraints', () => {
  it('accepts the four kinds', () => {
    expect(PROCESS_KINDS).toEqual(['review', 'rule_reflection', 'no_trade', 'rest'])
    for (const k of PROCESS_KINDS) expect(isProcessKind(k)).toBe(true)
  })
  it('a rule reflection MUST carry an outcome', () => {
    expect(validateEntry('rule_reflection', null)).toBeNull()
    expect(validateEntry('rule_reflection', 'nonsense')).toBeNull()
  })
  it('every other kind must NOT carry one', () => {
    expect(validateEntry('review', null)).toEqual({ kind: 'review', outcome: null })
    expect(validateEntry('rest', 'followed')).toBeNull()
    expect(validateEntry('no_trade', 'unknown')).toBeNull()
  })
  it('rejects an unknown kind outright', () => {
    expect(validateEntry('close_trade', null)).toBeNull()
    expect(validateEntry(42, null)).toBeNull()
  })
})
