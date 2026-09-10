/**
 * The basic weekly review — what a Free user did this week, against the focus
 * they chose.
 *
 * ── Audit 2026-09-05, Wave D6 / follow-up C3 ─────────────────────────────────
 *
 * `WeeklyReviewCard` returns `null` below Trader, so until now a Free user saw
 * nothing at all where the review should be — the last missing step of the
 * basic improvement cycle. This module is the pure half of the replacement.
 *
 * ── The line this module is on the free side of ──────────────────────────────
 *
 * Free gets the INPUTS to reflection. Paid gets the ANALYSIS of performance.
 *
 * So everything here is a count of something the user did, or a decision they
 * made about their own focus. There is no money in this file, no win rate, no
 * R-multiple, no best/worst trade, no drawdown, no strategy or session ranking,
 * and no generated "continue this / change that" advice. Those live in
 * `lib/weekly.ts` and stay behind the `weekly_review` flag, untouched.
 *
 * A useful test when adding a field: could the number change if the same trades
 * had made money instead of losing it? If yes, it belongs in `weekly.ts`.
 *
 * ── Pure module ──────────────────────────────────────────────────────────────
 *
 * No DB, no React, no `server-only`. Safe to import from a Server Component, a
 * client component, a server action and a unit test alike. A value imported
 * into a Server Component must come from a module like this one and never from
 * a `'use client'` file — that import resolves to a client-reference proxy and
 * throws when touched, which is how /admin/feedback went down on 2026-09-04.
 */

import { countReflections, followedRate, type ReflectableTrade, type ReflectionCounts } from '@/lib/reflection'
import type { ProcessLog } from '@/lib/process'

/**
 * What a completed review decides about the focus it just looked at.
 *
 * Three, not two. "Keep" and "revise" alone would make abandoning a focus feel
 * like failure, and a focus a trader has outgrown is supposed to be retired —
 * that is the cycle closing, not the user quitting.
 *
 * Mirrors the `weekly_reviews_decision_check` constraint in migration 0073.
 */
export type ReviewDecision = 'keep' | 'revise' | 'retire'

export const REVIEW_DECISIONS: readonly ReviewDecision[] = ['keep', 'revise', 'retire']

export const REVIEW_DECISION_META: Record<ReviewDecision, { label: string; short: string; hint: string }> = {
  keep: {
    label: 'Keep this focus', short: 'Keep',
    hint: 'It is still the right thing to be working on. Another week on it.',
  },
  revise: {
    label: 'Revise this focus', short: 'Revise',
    hint: 'Right idea, wrong shape — change the target or the window.',
  },
  retire: {
    label: 'Retire this focus', short: 'Retire',
    hint: 'Done with it, or it was the wrong thing. Retiring is a result.',
  },
}

export function isReviewDecision(v: unknown): v is ReviewDecision {
  return typeof v === 'string' && (REVIEW_DECISIONS as readonly string[]).includes(v)
}

/** Mirrors `weekly_reviews_note_len` in migration 0073. Same cap and the same
 *  reason as `REFLECTION_NOTE_MAX`: one sentence, not a second journal field. */
export const REVIEW_NOTE_MAX = 280

/** The kinds that mean "I deliberately did not trade". Named here rather than
 *  reached for inline so the review and `flatDays` cannot drift apart. */
const STAND_ASIDE: readonly ProcessLog['kind'][] = ['no_trade', 'rest']

const DAY_MS = 864e5
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * The review's window, as UTC day keys.
 *
 * `weekSlice` (journal-stats) slices trades on a rolling millisecond window
 * ending now. `process_logs` rows are dated to a UTC calendar day and nothing
 * finer — 0070 stamps `day` server-side and withholds the column from the
 * client grants, deliberately. So the two populations cannot share one boundary
 * expression, and this returns the day range that COVERS the millisecond
 * window rather than pretending to be it.
 *
 * The consequence is stated rather than hidden: a stand-aside recorded early on
 * the first day of the range counts, even though a trade at the same instant
 * would fall just outside. Erring inclusive is the right direction here — the
 * whole point of counting these days is that standing aside is a result, and
 * under-counting them would put the thumb back on the scale that favours having
 * traded.
 */
export function reviewWindow(now: number, days = 7): { from: string; to: string } {
  return { from: dayKey(now - days * DAY_MS), to: dayKey(now) }
}

/**
 * Distinct days in the window on which the user deliberately took nothing.
 *
 * `no_trade` and `rest` are unioned, and a day carrying both counts once: the
 * unit is the day the trader chose not to trade, not the number of ways they
 * recorded it.
 */
export function standAsideDays(
  logs: readonly ProcessLog[], window: { from: string; to: string },
): string[] {
  const out = new Set<string>()
  for (const l of logs) {
    if (!STAND_ASIDE.includes(l.kind)) continue
    if (l.day < window.from || l.day > window.to) continue
    out.add(l.day)
  }
  return [...out].sort()
}

/** A focus, reduced to what the review names. Null when the user has none. */
export type ReviewFocus = {
  kind: string
  label: string
  current: number
  target: number
  unit: string
}

export type BasicWeekSummary = {
  window: { from: string; to: string }
  /** Closed trades dated in the window. A count is always real. */
  tradesClosed: number
  /** followed / broke / unsure / unreflected / reflected / total, over the
   *  window — NOT over the page's visible list. See `summarizeBasicWeek`. */
  counts: ReflectionCounts
  /** Share of ANSWERED trades that followed the rules, or null when nothing has
   *  been answered. Never 0 for "you have not told us yet". */
  followedRate: number | null
  /** Distinct days stood aside on purpose (`no_trade` + `rest`). */
  standAsideDays: number
  /** True when the week holds no trades, no answers and no stand-aside days —
   *  the only genuinely empty case. See the note on `restOnly`. */
  isEmpty: boolean
  /**
   * No trades, but at least one deliberate stand-aside day.
   *
   * This is a COMPLETE week, not an empty one. The reward system was rebuilt on
   * exactly this premise (migration 0070): a week whose right answer was to
   * trade nothing has to be able to be a successful week, or the product is
   * still quietly paying for volume. The card says so in words.
   */
  restOnly: boolean
}

/**
 * Reduce one week to the basic review's figures.
 *
 * ── The population is the WINDOW, never the visible list ─────────────────────
 *
 * `ReflectTradesCard` counts over `visibleTrades`, which Free caps at
 * `JOURNAL_FREE_LIMIT` (30) — correct there, because that card offers a list
 * the user can act on and must not describe rows it is not showing. The review
 * makes the opposite claim: it says "this week". Counting the capped list would
 * silently omit this week's trades on any account with more than 30 trades in
 * total, and a review of a week that quietly drops trades is worse than no
 * review. So the caller hands in the window's closed trades from the full set.
 *
 * Pure, total and order-independent. No filtering happens here beyond the
 * stand-aside day range — the caller decides the trade population, exactly as
 * `countReflections` requires.
 */
export function summarizeBasicWeek(input: {
  /** Closed trades dated in the window, from the FULL trade list. */
  closedThisWeek: readonly ReflectableTrade[]
  /** Every process log the user has; filtered to the window here. */
  logs: readonly ProcessLog[]
  now: number
  days?: number
}): BasicWeekSummary {
  const window = reviewWindow(input.now, input.days ?? 7)
  const counts = countReflections(input.closedThisWeek)
  const aside = standAsideDays(input.logs, window).length
  const tradesClosed = counts.total
  return {
    window,
    tradesClosed,
    counts,
    followedRate: followedRate(counts),
    standAsideDays: aside,
    isEmpty: tradesClosed === 0 && counts.reflected === 0 && aside === 0,
    restOnly: tradesClosed === 0 && aside > 0,
  }
}

/** One review already on file, as the card reads it back. */
export type RecordedReview = {
  decision: ReviewDecision
  note: string | null
  focusKind: string | null
  weekStart: string
  windowFrom: string
  windowTo: string
  tradesClosed: number
  reflected: number
  standAsideDays: number
}

/**
 * Trim, drop-if-empty, cap — the `normalizeReflectionNote` idiom, applied in
 * the action before the write so the user sees a trimmed sentence rather than a
 * 23514 from `weekly_reviews_note_len`.
 */
export function normalizeReviewNote(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.length > REVIEW_NOTE_MAX ? s.slice(0, REVIEW_NOTE_MAX).trimEnd() : s
}

/**
 * The Monday of the ISO week containing `now`, in UTC — the bucket migration
 * 0073's unique index uses, mirrored here so the server action can address a
 * row Postgres already dated without ever SETTING one. Same discipline as
 * `utcToday()` in actions/process.ts, and for the same item-15-F7 reason: the
 * calendar bucket a record lands in is never client-supplied.
 */
export function utcWeekStart(now: number): string {
  const d = new Date(now)
  // getUTCDay: 0 = Sunday. ISO weeks start Monday, so Sunday is day 7.
  const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  return dayKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - (iso - 1) * DAY_MS)
}
