// app/tests/unit/basic-weekly-review.test.ts
//
// The basic weekly review — audit 2026-09-05, Wave D6 / follow-up C3.
//
// `WeeklyReviewCard` returns null below Trader, so a Free user saw nothing
// where the review should be and could not close a single improvement cycle.
// This file guards the replacement. Six things are worth a guard:
//
//   1. THE LINE. Free gets the inputs to reflection; paid gets the analysis of
//      performance. The card must show counts and no P/L figure, ever. That is
//      a property of the source text and of the module's import list, so it is
//      asserted against both.
//
//   2. THE POPULATION. The review says "this week". Counting the page's
//      Free-capped visible list instead of the window would silently omit this
//      week's trades on any account holding more than 30 — the trap C2 flagged.
//
//   3. THE EMPTY STATE. A week with no trades is NOT automatically empty:
//      reflections and deliberate stand-aside days still happened, and a week
//      of planned rest is a COMPLETE week. Only a week with none of the three
//      is genuinely empty.
//
//   4. THE NEXT ACTION. A completed review records the evidence considered and
//      a chosen next action. Rendering a summary must not by itself write one.
//
//   5. NO DOUBLE COUNT. The Free card now emits `weekly_review_viewed`, which
//      is what un-pins a Free streak. Exactly one emitter may mount per page
//      view, and the goal's union must stay by-day and two-sourced.
//
//   6. THE WRITE-ONLY TAG. C1 moved mistake tagging to Free; until C3 a free
//      user could write a tag and never see it again.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  summarizeBasicWeek, standAsideDays, reviewWindow, utcWeekStart,
  normalizeReviewNote, isReviewDecision,
  REVIEW_DECISIONS, REVIEW_DECISION_META, REVIEW_NOTE_MAX,
} from '@/lib/basic-review'
import { countReflections, type ReflectableTrade } from '@/lib/reflection'
import type { ProcessLog } from '@/lib/process'

const UID = '11111111-2222-4333-8444-555555555555'

const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8')
const sql = (f: string) => readFileSync(join(process.cwd(), 'supabase', 'migrations', f), 'utf8')

const CARD = src('app', 'journal', '_components', 'BasicWeeklyReviewCard.tsx')
const PROMPT = src('app', 'journal', '_components', 'NextActionPrompt.tsx')
const LIB = src('lib', 'basic-review.ts')
const JOURNAL = src('app', 'journal', 'page.tsx')
const RECENT = src('app', 'journal', '_components', 'RecentTrades.tsx')
const GOALS = src('lib', 'server', 'goals.ts')
const ACTION = src('app', 'actions', 'weekly-review.ts')
const M0073 = sql('0073_weekly_reviews.sql')

/** A fixed instant so every window assertion is deterministic. */
const NOW = Date.parse('2026-09-10T12:00:00.000Z')
const DAY = 864e5
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const trade = (outcome?: string | null): ReflectableTrade =>
  outcome == null ? {} : { reflection_outcome: outcome }
const log = (kind: ProcessLog['kind'], day: string): ProcessLog => ({ kind, day })

/* ───────────────────────────────────────────────────────────────────────────
 * 1. The line: counts, never performance
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the basic card shows inputs, never analysis', () => {
  // The identifiers below are exactly the figures the brief lists as Trader+
  // and they all live in `lib/weekly.ts` or on `Metrics`. Matched as
  // identifiers, not as prose, so the doc comment may keep naming what it
  // deliberately excludes.
  const PAID = [
    'netPnl', 'winRate', 'avgRr', 'rCount', 'profitFactor',
    'avgWinner', 'avgLoser', 'maxDrawdownR',
    'bestStrategy', 'worstStrategy', 'bestSession', 'worstMistake',
    'continueMsg', 'changeMsg',
    'pnl_amount', 'r_multiple', 'pnlAmount', 'rMultiple',
  ]

  it('renders none of the paid figures', () => {
    for (const id of PAID) {
      expect(CARD, `BasicWeeklyReviewCard must not reference ${id}`)
        .not.toMatch(new RegExp(`\\b${id}\\b`))
    }
  })

  it('cannot compute one either — the pure module never sees money', () => {
    for (const id of PAID) {
      expect(LIB, `lib/basic-review.ts must not reference ${id}`)
        .not.toMatch(new RegExp(`\\b${id}\\b`))
    }
  })

  it('does not reach past its own module for data', () => {
    // The strongest form of the guard. `lib/weekly.ts` and `lib/trade.ts` are
    // where every excluded figure is computed; importing either is the move
    // that would quietly cross the line, and it is a type error away from
    // working, so it has to be structural.
    for (const forbidden of ['@/lib/weekly', '@/lib/trade', '@/lib/insights', '@/lib/journal-stats']) {
      expect(CARD).not.toContain(forbidden)
      expect(LIB).not.toContain(forbidden)
    }
  })

  it('is ungated — no canFlag, no tier, anywhere in the free path', () => {
    // Matched as calls, not as words: the doc comments are allowed to say what
    // they deliberately do not do.
    for (const f of [CARD, PROMPT, LIB, ACTION]) {
      expect(f).not.toMatch(/canFlag\(/)
      expect(f).not.toMatch(/getTier\(/)
      expect(f).not.toMatch(/'weekly_review'/)   // the Trader+ flag key
      expect(f).not.toContain('@/lib/entitlements')
      expect(f).not.toContain('@/lib/feature-flags')
    }
  })

  it('shows the four reflection buckets and the stand-aside count', () => {
    expect(CARD).toContain('counts.followed')
    expect(CARD).toContain('counts.broke')
    expect(CARD).toContain('counts.unsure')
    expect(CARD).toContain('counts.unreflected')
    expect(CARD).toContain('summary.standAsideDays')
    expect(CARD).toContain('summary.tradesClosed')
  })

  it('names the focus and offers keep / revise / retire', () => {
    expect(CARD).toMatch(/focus\.label/)
    expect(CARD).toContain('<NextActionPrompt')
    expect(REVIEW_DECISIONS).toEqual(['keep', 'revise', 'retire'])
    for (const d of REVIEW_DECISIONS) expect(REVIEW_DECISION_META[d].label).toBeTruthy()
  })

  it('leaves the paid card and its gate exactly where they were', () => {
    // C3 adds a card; it does not move a price. `weekly_review` still gates
    // WeeklyReviewCard, and that card still returns null when locked.
    expect(JOURNAL).toContain("canFlag(flags, tier, 'weekly_review')")
    expect(JOURNAL).toMatch(/\{canWeeklyReview && \([\s\S]{0,200}<WeeklyReviewCard/)
    expect(src('app', 'journal', '_components', 'WeeklyReviewCard.tsx'))
      .toContain('if (locked) return null')
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 2. The population is the WINDOW, not the visible list
 * ─────────────────────────────────────────────────────────────────────────── */

describe('counting over the week window', () => {
  it('counts every trade in the window, not the first 30', () => {
    // The trap C2 flagged. `visibleTrades` is `trades.slice(0, 30)` on Free; a
    // week holding 40 closed trades would report 30 if the review counted the
    // page's visible list.
    const forty = Array.from({ length: 40 }, (_, i) => trade(i < 35 ? 'followed' : null))
    const s = summarizeBasicWeek({ closedThisWeek: forty, logs: [], now: NOW })

    expect(s.tradesClosed).toBe(40)
    expect(s.counts.followed).toBe(35)
    expect(s.counts.unreflected).toBe(5)
    // And the capped version really does differ, so this is a live guard.
    expect(countReflections(forty.slice(0, 30)).total).toBe(30)
  })

  it('the journal page hands in the window slice, never the capped list', () => {
    expect(JOURNAL).toMatch(/summarizeBasicWeek\(\{[\s\S]{0,160}?closedThisWeek: thisWeekTrades/)
    expect(JOURNAL).not.toMatch(/closedThisWeek: (reflectRows|visibleTrades)/)
    // `thisWeekTrades` is sliced out of `closed`, which comes from the full
    // list — not from `visibleTrades`. If that ever changes, the guard above
    // still passes and this one does not.
    expect(JOURNAL).toContain('const closed = trades.filter((t) => t.status === \'closed\')')
    expect(JOURNAL).toContain('const thisWeekTrades = weekSlice(closed, 0)')
  })

  it('the four buckets still partition the window', () => {
    const mixed = [
      trade('followed'), trade('followed'), trade('broke'),
      trade('unknown'), trade(null), trade('bogus'),
    ]
    const s = summarizeBasicWeek({ closedThisWeek: mixed, logs: [], now: NOW })
    const { followed, broke, unsure, unreflected, reflected, total } = s.counts
    expect(followed + broke + unsure + unreflected).toBe(total)
    expect(followed + broke + unsure).toBe(reflected)
    // An unrecognised stored value reads as unreflected, never as a guess.
    expect(unreflected).toBe(2)
  })

  it('reports no followed rate at all when nothing has been answered', () => {
    // Null, not 0. "0% of your trades followed your rules" and "you have not
    // told us yet" are different sentences and only one of them is true.
    const s = summarizeBasicWeek({ closedThisWeek: [trade(null), trade(null)], logs: [], now: NOW })
    expect(s.followedRate).toBeNull()
    expect(s.counts.reflected).toBe(0)
    expect(CARD).toContain('summary.followedRate == null')
    // The denominator is `reflected`, never `total`.
    expect(CARD).toContain('counts.reflected')
  })

  it('divides by the answered trades, not by every trade', () => {
    const s = summarizeBasicWeek({
      closedThisWeek: [trade('followed'), trade('broke'), trade(null), trade(null)],
      logs: [], now: NOW,
    })
    expect(s.followedRate).toBe(0.5)   // 1 of 2 answered, not 1 of 4
  })

  it('counts stand-aside days in the window only, and each day once', () => {
    const inside = dayKey(NOW - 2 * DAY)
    const alsoInside = dayKey(NOW - 5 * DAY)
    const outside = dayKey(NOW - 30 * DAY)
    const logs = [
      log('no_trade', inside), log('rest', inside),      // same day, two kinds
      log('rest', alsoInside),
      log('no_trade', outside),                          // out of window
      log('review', inside), log('rule_reflection', inside), // not stand-aside
    ]
    expect(standAsideDays(logs, reviewWindow(NOW))).toEqual([alsoInside, inside].sort())
    expect(summarizeBasicWeek({ closedThisWeek: [], logs, now: NOW }).standAsideDays).toBe(2)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 3. What "empty" actually means here
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the genuinely-empty week', () => {
  it('is empty only when nothing at all was recorded', () => {
    const s = summarizeBasicWeek({ closedThisWeek: [], logs: [], now: NOW })
    expect(s.isEmpty).toBe(true)
    expect(s.restOnly).toBe(false)
  })

  it('a week of deliberate rest is COMPLETE, not empty', () => {
    // The premise migration 0070 was built on: a week whose right answer was to
    // trade nothing has to be able to be a successful week, or the product is
    // still quietly paying for volume.
    const logs = [log('rest', dayKey(NOW - DAY)), log('no_trade', dayKey(NOW - 2 * DAY))]
    const s = summarizeBasicWeek({ closedThisWeek: [], logs, now: NOW })
    expect(s.isEmpty).toBe(false)
    expect(s.restOnly).toBe(true)
    expect(s.standAsideDays).toBe(2)
    expect(CARD).toContain('summary.restOnly')
    expect(CARD).toMatch(/complete week, not a gap/)
  })

  it('a week with no trades but an answered reflection is not empty either', () => {
    const s = summarizeBasicWeek({ closedThisWeek: [trade('broke')], logs: [], now: NOW })
    expect(s.isEmpty).toBe(false)
  })

  it('the empty branch offers a way out and claims nothing about the week', () => {
    const empty = CARD.slice(CARD.indexOf('if (summary.isEmpty)'))
      .slice(0, CARD.slice(CARD.indexOf('if (summary.isEmpty)')).indexOf('\n  return ('))
    expect(empty).toMatch(/not a bad week, an unrecorded one/)
    expect(empty).toContain('#reflect')
    // It must not offer a next action: keeping or retiring a focus against no
    // evidence is a decision about nothing.
    expect(empty).not.toContain('<NextActionPrompt')
  })

  it('the paid card keeps its own honest empty state, untouched', () => {
    const weekly = src('app', 'journal', '_components', 'WeeklyReviewCard.tsx')
    expect(weekly).toContain('cmp.emptyReason')
    expect(weekly).toContain('Not enough data')
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 4. The next action — and where it is stored
 * ─────────────────────────────────────────────────────────────────────────── */

describe('storage for the next action', () => {
  it('does not weaken the process_logs anti-farm cap', () => {
    // 0070's unique index is (user_id, day, kind) and caps the whole reward
    // surface at four entries a day. C2 declined to weaken it and so does C3.
    expect(M0073).not.toMatch(/alter table[\s\S]{0,80}process_logs/i)
    expect(M0073).not.toMatch(/drop index[\s\S]{0,80}process_logs/i)
    expect(M0073).not.toMatch(/create (unique )?index[\s\S]{0,120}on public\.process_logs/i)
    expect(sql('0070_process_logs.sql')).toContain('process_logs_user_day_kind_uidx')
  })

  it('records the evidence AND the decision, in one row per ISO week', () => {
    for (const col of [
      'decision', 'focus_kind', 'trades_closed', 'reflected', 'followed',
      'broke', 'unsure', 'unreflected', 'stood_aside_days', 'note',
      'week_start', 'window_start', 'window_end',
    ]) {
      expect(M0073, `0073 must define ${col}`).toMatch(new RegExp(`\\b${col}\\b`))
    }
    expect(M0073).toMatch(/create unique index[\s\S]{0,120}weekly_reviews \(user_id, week_start\)/)
    expect(M0073).toMatch(/check \(decision in \('keep', 'revise', 'retire'\)\)/)
  })

  it('the calendar bucket is server-set and not client-settable', () => {
    // Item 15 F7, the lesson 0070 states at length: a habit record whose bucket
    // comes from the client can be backdated, and a backdated review measures
    // nothing. Here it is stronger than 0070 — the client gets no write at all.
    expect(M0073).toMatch(/week_start date not null default/)
    expect(M0073).toMatch(/revoke insert, update, delete on public\.weekly_reviews from anon, authenticated/)
    expect(M0073).not.toMatch(/grant (insert|update)[^\n]*weekly_reviews[^\n]*authenticated/)
    // Read-your-own stays.
    expect(M0073).toMatch(/create policy weekly_reviews_select[\s\S]{0,200}auth\.uid\(\)\) = user_id/)
  })

  it('refuses a row whose counts describe two different populations', () => {
    expect(M0073).toMatch(/followed \+ broke \+ unsure = reflected/)
    expect(M0073).toMatch(/reflected \+ unreflected = trades_closed/)
  })

  it('caps the sentence the same way 0071 caps the reflection note', () => {
    expect(REVIEW_NOTE_MAX).toBe(280)
    expect(M0073).toMatch(/char_length\(note\) <= 280/)
    expect(normalizeReviewNote('  keep going  ')).toBe('keep going')
    expect(normalizeReviewNote('   ')).toBeNull()
    expect(normalizeReviewNote(null)).toBeNull()
    expect(normalizeReviewNote('x'.repeat(400))).toHaveLength(REVIEW_NOTE_MAX)
  })

  it('rejects a decision outside the three', () => {
    expect(isReviewDecision('keep')).toBe(true)
    expect(isReviewDecision('retire')).toBe(true)
    expect(isReviewDecision('delete')).toBe(false)
    expect(isReviewDecision(null)).toBe(false)
  })

  it('buckets to the Monday of the ISO week, in UTC', () => {
    expect(utcWeekStart(Date.parse('2026-09-10T12:00:00Z'))).toBe('2026-09-07') // Thu -> Mon
    expect(utcWeekStart(Date.parse('2026-09-07T00:00:00Z'))).toBe('2026-09-07') // Mon -> itself
    expect(utcWeekStart(Date.parse('2026-09-13T23:59:00Z'))).toBe('2026-09-07') // Sun -> same Mon
    expect(utcWeekStart(Date.parse('2026-09-14T00:01:00Z'))).toBe('2026-09-14') // next Mon
  })

  it('rendering the summary writes nothing', () => {
    // The audit's requirement, as a property of the read path: neither the card,
    // the page, nor the read helper may insert or update a review row.
    expect(CARD).not.toMatch(/\.insert\(|\.update\(|recordWeeklyReview/)
    expect(src('lib', 'server', 'weekly-review.ts')).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/)
    expect(JOURNAL).not.toContain('recordWeeklyReview')
    // Exactly one writer.
    expect(ACTION).toContain('export async function recordWeeklyReview')
  })

  it('the client awaits the action inside an async transition (CLAUDE.md)', () => {
    // A synchronous callback returns before the action settles, React closes the
    // transition, and the write can silently fail to land. That was the feedback
    // triage bug.
    expect(PROMPT).toMatch(/start\(async \(\) => \{[\s\S]{0,200}await recordWeeklyReview/)
    // And the returned error is read, with the control put back.
    expect(PROMPT).toMatch(/if \(res\?\.error\)/)
    expect(PROMPT).toMatch(/setChosen\(existing\?\.decision \?\? null\)/)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 5. The write path
 * ─────────────────────────────────────────────────────────────────────────── */

const getUser = vi.fn(async () => ({ data: { user: { id: UID } } }))
const allowAction = vi.fn(async () => ({ ok: true }))
const inserts: { table: string; payload: Record<string, unknown> }[] = []
const updates: { table: string; payload: Record<string, unknown> }[] = []
const insertResult = vi.fn<() => { error: unknown }>(() => ({ error: null }))
const updateResult = vi.fn<() => { error: unknown }>(() => ({ error: null }))
/** Closed trades the SERVICE client hands back for the window query. */
let WINDOW_ROWS: Record<string, unknown>[] = []
let LOGS: ProcessLog[] = []

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser }, from: () => ({}) }),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ eq: () => ({ gte: async () => ({ data: WINDOW_ROWS, error: null }) }) }),
      }),
      insert: async (payload: Record<string, unknown>) => {
        inserts.push({ table, payload })
        return insertResult()
      },
      update: (payload: Record<string, unknown>) => {
        updates.push({ table, payload })
        return { eq: () => ({ eq: async () => updateResult() }) }
      },
    }),
  }),
}))

vi.mock('@/lib/server/process', () => ({ getProcessLogs: async () => LOGS }))

vi.mock('@/lib/server/action-throttle', () => ({
  allowAction: (...a: unknown[]) => allowAction(...(a as [])),
  JOURNAL_BUDGET: { scope: 'act:journal', max: 60, windowMs: 600_000 },
  UPLOAD_BUDGET: { scope: 'act:upload', max: 20, windowMs: 600_000 },
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const actions = () => import('@/app/actions/weekly-review')
const reviewInsert = () => inserts.find((i) => i.table === 'weekly_reviews')?.payload
const reviewUpdate = () => updates.find((u) => u.table === 'weekly_reviews')?.payload

beforeEach(() => {
  inserts.length = 0
  updates.length = 0
  insertResult.mockReturnValue({ error: null })
  updateResult.mockReturnValue({ error: null })
  allowAction.mockResolvedValue({ ok: true })
  getUser.mockResolvedValue({ data: { user: { id: UID } } })
  WINDOW_ROWS = []
  LOGS = []
})

describe('recordWeeklyReview — the write', () => {
  it('writes the decision alongside evidence it derived itself', async () => {
    const nowIso = (ms: number) => new Date(ms).toISOString()
    WINDOW_ROWS = [
      { traded_at: nowIso(Date.now() - DAY), status: 'closed', reflection_outcome: 'followed' },
      { traded_at: nowIso(Date.now() - 2 * DAY), status: 'closed', reflection_outcome: 'broke' },
      { traded_at: nowIso(Date.now() - 3 * DAY), status: 'closed', reflection_outcome: null },
    ]
    LOGS = [log('rest', dayKey(Date.now() - DAY))]

    const { recordWeeklyReview } = await actions()
    const res = await recordWeeklyReview({ decision: 'revise', note: '  tighter window  ', focusKind: 'rule_compliance' })

    expect(res).toEqual({ ok: true })
    const p = reviewInsert()!
    expect(p.user_id).toBe(UID)
    expect(p.decision).toBe('revise')
    expect(p.focus_kind).toBe('rule_compliance')
    expect(p.note).toBe('tighter window')
    expect(p.trades_closed).toBe(3)
    expect(p.reflected).toBe(2)
    expect(p.followed).toBe(1)
    expect(p.broke).toBe(1)
    expect(p.unsure).toBe(0)
    expect(p.unreflected).toBe(1)
    expect(p.stood_aside_days).toBe(1)
    // The bucket the unique index uses is NEVER in the payload — Postgres dates
    // the row, exactly as `logProcess` leaves `day` to the server.
    expect(p).not.toHaveProperty('week_start')
    expect(p).not.toHaveProperty('created_at')
  })

  it('takes no count from the caller', async () => {
    // The action's whole input surface is decision / note / focusKind. A caller
    // that sends counts anyway gets the server's — here, zero, because the
    // service client returned an empty window.
    const { recordWeeklyReview } = await actions()
    const hostile = { decision: 'keep', trades_closed: 99, followed: 99, stood_aside_days: 7 }
    await recordWeeklyReview(hostile as unknown as { decision: string })
    const p = reviewInsert()!
    expect(p.trades_closed).toBe(0)
    expect(p.followed).toBe(0)
    expect(p.stood_aside_days).toBe(0)
    // And the payload is exactly the derived set — nothing extra rode along.
    expect(Object.keys(p).sort()).toEqual([
      'broke', 'decision', 'focus_kind', 'followed', 'note', 'reflected',
      'stood_aside_days', 'trades_closed', 'unreflected', 'unsure',
      'user_id', 'window_end', 'window_start',
    ].sort())
  })

  it('bounds the focus label rather than letting it be a second text column', () => {
    // Free text with no FK, so a retired focus survives the goal row it
    // retired — but bounded, because the capped `note` beside it is capped for
    // a reason.
    expect(ACTION).toMatch(/input\.focusKind\.length <= 64/)
  })

  it('refuses a decision that is not one of the three', async () => {
    const { recordWeeklyReview } = await actions()
    expect(await recordWeeklyReview({ decision: 'delete' })).toEqual({ error: 'Pick keep, revise or retire.' })
    expect(inserts).toHaveLength(0)
  })

  it('amends rather than duplicating when the week already has a review', async () => {
    insertResult.mockReturnValue({ error: { code: '23505' } })
    const { recordWeeklyReview } = await actions()
    const res = await recordWeeklyReview({ decision: 'retire', focusKind: 'weekly_reviews' })

    expect(res).toEqual({ ok: true })
    const p = reviewUpdate()!
    expect(p.decision).toBe('retire')
    // `user_id` is the filter, not part of the amendment, and `week_start` is
    // still never written.
    expect(p).not.toHaveProperty('user_id')
    expect(p).not.toHaveProperty('week_start')
  })

  it('surfaces a real failure instead of reporting a phantom save', async () => {
    insertResult.mockReturnValue({ error: { code: '42501' } })
    const { recordWeeklyReview } = await actions()
    expect(await recordWeeklyReview({ decision: 'keep' })).toEqual({ error: 'Could not save that.' })
  })

  it('needs a session and respects the action budget', async () => {
    const { recordWeeklyReview } = await actions()
    getUser.mockResolvedValueOnce({ data: { user: null } } as never)
    expect((await recordWeeklyReview({ decision: 'keep' })).error).toBe('Not authenticated.')

    allowAction.mockResolvedValueOnce({ ok: false, message: 'Slow down.' } as never)
    expect((await recordWeeklyReview({ decision: 'keep' })).error).toBe('Slow down.')
    expect(inserts).toHaveLength(0)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 6. `weekly_review_viewed` — closed at source, counted once
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the review signal is emitted once', () => {
  it('the free card emits it, gated only on the prop the page passes', () => {
    expect(CARD).toMatch(/\{emitViewed && <TrackOnMount event="weekly_review_viewed" \/>\}/)
  })

  it('the page mounts exactly one emitter at any tier', () => {
    // The paid card emits unconditionally when it renders, so the free card
    // must stand down for Trader+ or a paid page view logs two events for one
    // review and every rate computed on that event is halved.
    expect(JOURNAL).toContain('emitViewed={!canWeeklyReview}')
    const emitters = [...JOURNAL.matchAll(/weekly_review_viewed/g)].length
    // Only in the streaks query and the comment — the page itself never emits.
    expect(JOURNAL).not.toContain('<TrackOnMount event="weekly_review_viewed"')
    expect(emitters).toBeGreaterThan(0)
  })

  it('the goal still reads two sources and still unions them by day', () => {
    expect(GOALS).toContain("eq('event', 'weekly_review_viewed')")
    expect(GOALS).toContain("eq('kind', 'review')")
    expect(GOALS).toMatch(/const reviewDays = new Set<string>\(\[/)
    // Slicing both to a day key is what makes the union a de-duplication.
    expect(GOALS).toMatch(/created_at as string\)\.slice\(0, 10\)/)
    expect(GOALS).toMatch(/String\(r\.day\)\.slice\(0, 10\)/)
  })

  it('the completed-review table is NOT wired in as a third source', () => {
    // It records the same event the card view already counted, in more detail.
    // Reading it here could only turn one review into two counted days. The
    // guard is the absence of a READ — the comment above it in goals.ts names
    // the table on purpose, so a bare substring match would be a comment test.
    expect(GOALS).not.toMatch(/from\(\s*'weekly_reviews'/)
    expect(GOALS).not.toContain('@/lib/server/weekly-review')
    expect(JOURNAL).not.toMatch(/reviewDays: \[[\s\S]{0,300}getRecentReviews/)
    // Two sources in the union, and only two.
    const union = GOALS.slice(GOALS.indexOf('const reviewDays'), GOALS.indexOf('return goals.map'))
    expect([...union.matchAll(/\.\.\./g)]).toHaveLength(2)
  })

  it('the streak union is by day on both sources too', () => {
    expect(JOURNAL).toMatch(/reviewDays: \[\.\.\.new Set\(\[/)
    expect(JOURNAL).toContain("daysWithKind(processLogs, 'review')")
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 7. A mistake tag stops being write-only (handed over from C1)
 * ─────────────────────────────────────────────────────────────────────────── */

describe('mistake tags are read back to their author', () => {
  it('the trade rows render them', () => {
    expect(RECENT).toContain('mistakeTags?.[t.id]')
    expect(RECENT).toMatch(/mistakes\.map\(\(m\) => \(/)
    expect(RECENT).toContain('ts-tag--mistake')
    expect(src('app', 'globals.css')).toContain('.ts-tag--mistake')
  })

  it('without widening JTrade, which also backs the public profile query', () => {
    // The constraint the type's own comment states. A `mistake_tags` field on
    // the shared type is a standing invitation to add the column to the public
    // select "to satisfy the type" — which would publish a stranger's record of
    // their own errors.
    const stats = src('lib', 'journal-stats.ts')
    const jtrade = stats.slice(stats.indexOf('export type JTrade'), stats.indexOf('export const MONTHS'))
    expect(jtrade).not.toMatch(/\bmistake_tags\b/)

    const profile = src('app', '[username]', 'page.tsx')
    expect(profile).not.toMatch(/select\('[^']*mistake_tags/)
    expect(profile).not.toMatch(/select\('[^']*reflection_/)
    expect(profile).not.toMatch(/select\('[^']*\bnote\b/)
  })

  it('the map is built from the page’s own-rows-only query', () => {
    expect(JOURNAL).toMatch(/const mistakeTagsById: Record<string, string\[\]> = \{\}/)
    expect(JOURNAL).toContain('mistakeTags={mistakeTagsById}')
    // /demo passes none: its sample rows belong to nobody.
    expect(src('app', 'demo', 'page.tsx')).not.toContain('mistakeTags=')
  })

  it('the AGGREGATE stays paid — the tag is the input, the analysis is not', () => {
    expect(JOURNAL).toContain("canFlag(flags, tier, 'mistake_analysis')")
    expect(JOURNAL).toMatch(/\{canMistakeAnalysis && \([\s\S]{0,200}<MistakeAnalysisCard/)
  })
})
