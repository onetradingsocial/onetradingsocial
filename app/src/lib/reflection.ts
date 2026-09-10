/**
 * Per-trade rule reflection — "did THIS trade follow your rules?"
 *
 * ── Audit 2026-09-05, Wave D4 ────────────────────────────────────────────────
 *
 * The third step of the basic improvement cycle: after a trade is saved or
 * imported, ask whether it followed the chosen rule — yes, no, or unsure — with
 * an optional short sentence. Ungated at every tier, because a Free user who
 * cannot record a reflection cannot complete a cycle, and the cycle is what the
 * audit says the product is for.
 *
 * ── How this differs from `lib/process.ts` ───────────────────────────────────
 *
 * `process_logs` (migration 0070) records ONE rule reflection PER DAY — a habit
 * marker, capped at one row per kind per day by a unique index that exists to
 * stop the reward surface being farmed. That cap is deliberate and is not
 * weakened anywhere.
 *
 * This module is the other half: the answer about the trade in front of you,
 * stored on the trade (migration 0071). It is many-per-day by nature, bounded
 * by the trades that exist rather than by a quota, and it is what lets a weekly
 * review say "you reviewed four sessions; three followed your checklist" — a
 * sentence a daily row cannot produce.
 *
 * The vocabulary is shared with `process.ts` on purpose. One question, one set
 * of words, so a per-trade answer can also stand as the day's `rule_reflection`
 * entry with no translation layer.
 *
 * ── Pure module ──────────────────────────────────────────────────────────────
 *
 * No DB, no React, no `server-only`. Safe to import from a Server Component, a
 * client component, a server action and a unit test alike — which is the point:
 * the weekly review (C3) and its tests reduce trades to counts through
 * `countReflections` here, not through anything that needs a database.
 *
 * Values imported into a Server Component must come from a module like this
 * one, never from a `'use client'` file — that import resolves to a
 * client-reference proxy and throws when touched, which is how /admin/feedback
 * went down on 2026-09-04.
 */

import { type ReflectionOutcome, isReflectionOutcome } from '@/lib/process'

export type { ReflectionOutcome }
export { isReflectionOutcome }

/**
 * Mirrors `trades_reflection_note_len` in migration 0071. The prompt asks for
 * one sentence; the cap is what keeps this from drifting into a second,
 * ungated copy of `trades.note` (which is `private_notes`, a Trader perk, and
 * stays one — they are two fields on purpose).
 */
export const REFLECTION_NOTE_MAX = 280

/**
 * The row shape this module reads. Deliberately loose and all-optional so the
 * same helper works over the journal page's wide select, the weekly review's
 * narrow one, and a plain fixture in a unit test. Anything not recognised reads
 * as unreflected rather than throwing.
 */
export type ReflectableTrade = {
  reflection_outcome?: string | null
  reflection_note?: string | null
}

export type TradeReflection = {
  outcome: ReflectionOutcome
  note: string | null
}

/** Per-trade prompt copy. The question is about one trade, so the wording is
 *  not `process.ts`'s REFLECTION_META, which asks about a whole day. */
export const TRADE_REFLECTION_META: Record<ReflectionOutcome, {
  label: string
  short: string
  hint: string
  icon: string
}> = {
  followed: {
    label: 'Yes — followed my rules', short: 'Followed', icon: '✓',
    hint: 'The plan held on this one.',
  },
  broke: {
    label: 'No — broke a rule', short: 'Broke a rule', icon: '✕',
    hint: 'Naming it is the point. It costs you nothing here.',
  },
  unknown: {
    label: 'Not sure', short: 'Not sure', icon: '?',
    hint: 'Counts the same as the other two. An honest “unsure” beats a guessed “yes”.',
  },
}

/** The order the three choices are offered in, everywhere they are offered. */
export const TRADE_REFLECTION_CHOICES: ReflectionOutcome[] = ['followed', 'broke', 'unknown']

export const REFLECTION_QUESTION = 'Did this trade follow your rules?'

/**
 * Read one trade's reflection.
 *
 * Returns `null` for "not reflected", which is a THIRD state and not a failure:
 * skipping the prompt is allowed and carries no penalty anywhere. An
 * unrecognised stored value also reads as `null` rather than being coerced —
 * 0071's check constraint makes that impossible today, and if a later migration
 * widens the vocabulary this under-reports instead of mis-scoring.
 *
 * A note with no outcome is refused by `trades_reflection_note_needs_outcome`,
 * so the `outcome != null` test is the whole test.
 */
export function readTradeReflection(t: ReflectableTrade | null | undefined): TradeReflection | null {
  if (!t || !isReflectionOutcome(t.reflection_outcome)) return null
  const note = typeof t.reflection_note === 'string' ? t.reflection_note.trim() : ''
  return { outcome: t.reflection_outcome, note: note || null }
}

/** Has this trade been answered? Sugar over `readTradeReflection`, used often
 *  enough in list filters to be worth naming. */
export function isReflected(t: ReflectableTrade | null | undefined): boolean {
  return readTradeReflection(t) != null
}

/**
 * Trim, drop-if-empty, cap. Applied in the server action before the write so a
 * user sees a trimmed sentence rather than a 23514 from
 * `trades_reflection_note_len`, and exported so the prompt can show the same
 * remaining-characters count the server will enforce.
 */
export function normalizeReflectionNote(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.length > REFLECTION_NOTE_MAX ? s.slice(0, REFLECTION_NOTE_MAX).trimEnd() : s
}

/**
 * What the weekly review counts.
 *
 * `unsure` rather than `unknown`: the stored value is `unknown` (0070's
 * vocabulary, shared by 0071) but the thing being counted is a user who said
 * "not sure", and every surface that renders this says "unsure". The mapping is
 * here, once, so no caller has to remember it.
 *
 * `unreflected` is a first-class count for the same reason `unknown` is a
 * first-class answer: a review that silently dropped the trades nobody answered
 * would report a rule-compliance rate over a self-selected sample and call it
 * the week. `reflected` and `total` are carried so a caller can render the
 * denominator without recomputing it — the audit is explicit that a rate shown
 * without its denominator is the defect, not the fix.
 */
export type ReflectionCounts = {
  followed: number
  broke: number
  unsure: number
  unreflected: number
  /** followed + broke + unsure */
  reflected: number
  /** reflected + unreflected — every trade handed in */
  total: number
}

export const EMPTY_REFLECTION_COUNTS: ReflectionCounts = {
  followed: 0, broke: 0, unsure: 0, unreflected: 0, reflected: 0, total: 0,
}

/**
 * Reduce a set of trades to followed / broke / unsure / unreflected counts.
 *
 * Pure, total, and order-independent. Every trade handed in lands in exactly
 * one of the four buckets, so `followed + broke + unsure + unreflected` always
 * equals `total` — the invariant the weekly review's denominator rests on, and
 * the one `tests/unit/trade-reflection.test.ts` pins.
 *
 * Caller decides the population (this week's closed trades, an instrument, a
 * whole account); this does not filter.
 */
export function countReflections(trades: readonly ReflectableTrade[]): ReflectionCounts {
  const out: ReflectionCounts = { ...EMPTY_REFLECTION_COUNTS }
  for (const t of trades) {
    out.total++
    const r = readTradeReflection(t)
    if (!r) { out.unreflected++; continue }
    out.reflected++
    if (r.outcome === 'followed') out.followed++
    else if (r.outcome === 'broke') out.broke++
    else out.unsure++
  }
  return out
}

/**
 * The share of ANSWERED trades that followed the rules, or `null` when nothing
 * has been answered.
 *
 * Null rather than 0: "0% compliance" and "you have not told us yet" are
 * different sentences, and printing the first when the second is true is the
 * kind of claim the audit's copy pass exists to remove. The denominator is
 * `reflected`, never `total`, so an unanswered trade cannot drag the figure
 * down — it is reported separately as `unreflected`.
 */
export function followedRate(counts: ReflectionCounts): number | null {
  if (counts.reflected === 0) return null
  return counts.followed / counts.reflected
}
