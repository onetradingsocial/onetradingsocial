/**
 * Process entries — the unit the reward system pays for.
 *
 * ── Audit 2026-09-05, P0 ─────────────────────────────────────────────────────
 *
 * The quests and badges this replaces required transacting: log a trade, close a
 * trade, log 10, close 5, 50 trades, a 10-win streak. In a journalling product
 * sold on trading discipline, that is a paid incentive to overtrade — the exact
 * behaviour the product exists to reduce, and one of the audit's own guardrails
 * ("whether users feel encouraged to take unnecessary trades").
 *
 * A process entry is something a trader can do with the market closed. The four
 * kinds are deliberately few: they are the ones the audit named, and adding more
 * would grow the reward surface before the adoption gap it is meant to close.
 *
 * ── The invariant that makes this work ───────────────────────────────────────
 *
 * `no_trade` and `rest` count for exactly as much as `review` and
 * `rule_reflection` toward the daily quest and every streak. A week in which the
 * right decision was to trade nothing has to be able to be a *successful* week,
 * or the reward system is still, quietly, paying for volume.
 *
 * `unknown` is a first-class reflection outcome for the same reason. Paying only
 * for 'followed' pays for the answer rather than the reflection, and a trader who
 * genuinely cannot tell whether they followed their plan has learned the most
 * useful thing available that day.
 *
 * Pure module: no DB, no React, no `server-only`. Safe to import from a client
 * component, a server component, and a unit test alike.
 */

export type ProcessKind = 'review' | 'rule_reflection' | 'no_trade' | 'rest'

export type ReflectionOutcome = 'followed' | 'broke' | 'unknown'

/** Mirrors the `kind` check constraint in migration 0070. */
export const PROCESS_KINDS: ProcessKind[] = ['review', 'rule_reflection', 'no_trade', 'rest']

/** Mirrors the `outcome` values in `process_logs_outcome_shape` (0070). */
export const REFLECTION_OUTCOMES: ReflectionOutcome[] = ['followed', 'broke', 'unknown']

export const PROCESS_META: Record<ProcessKind, { label: string; verb: string; hint: string; icon: string }> = {
  review: {
    label: 'Review', verb: 'Reviewed', icon: '📊',
    hint: 'You sat down and went back over your trading.',
  },
  rule_reflection: {
    label: 'Rule reflection', verb: 'Reflected', icon: '🧭',
    hint: 'Did you follow your rules today? "Not sure" is a real answer.',
  },
  no_trade: {
    label: 'Planned no-trade', verb: 'Stood aside', icon: '🛑',
    hint: 'You were at the desk and deliberately took nothing.',
  },
  rest: {
    label: 'Scheduled rest', verb: 'Rested', icon: '🌙',
    hint: 'A planned day away from the screens.',
  },
}

export const REFLECTION_META: Record<ReflectionOutcome, { label: string; hint: string }> = {
  followed: { label: 'Followed my rules', hint: 'The plan held.' },
  broke: { label: 'Broke a rule', hint: 'Naming it is the point — it costs you nothing here.' },
  unknown: { label: 'Not sure', hint: 'Counts the same. An honest "unsure" beats a guessed "yes".' },
}

/**
 * One recorded entry. `day` is the UTC calendar day (`YYYY-MM-DD`) the server
 * stamped at insert; it is not client-settable (0070 withholds the column grant),
 * so it is the honest bucket for every reward below.
 */
export type ProcessLog = {
  kind: ProcessKind
  day: string
  outcome?: ReflectionOutcome | null
}

export function isProcessKind(v: unknown): v is ProcessKind {
  return typeof v === 'string' && (PROCESS_KINDS as string[]).includes(v)
}

export function isReflectionOutcome(v: unknown): v is ReflectionOutcome {
  return typeof v === 'string' && (REFLECTION_OUTCOMES as string[]).includes(v)
}

/**
 * The shape the DB enforces, checked in the action before it gets there so the
 * user sees a message rather than a constraint violation.
 */
export function validateEntry(kind: unknown, outcome: unknown): { kind: ProcessKind; outcome: ReflectionOutcome | null } | null {
  if (!isProcessKind(kind)) return null
  if (kind === 'rule_reflection') return isReflectionOutcome(outcome) ? { kind, outcome } : null
  return outcome == null ? { kind, outcome: null } : null
}

/** Distinct UTC day keys carrying any process entry at all. */
export function processDays(logs: ProcessLog[]): string[] {
  return [...new Set(logs.map((l) => l.day))]
}

/** Distinct UTC day keys carrying an entry of one kind. */
export function daysWithKind(logs: ProcessLog[], kind: ProcessKind): string[] {
  return [...new Set(logs.filter((l) => l.kind === kind).map((l) => l.day))]
}

/**
 * Days on which no trade could have broken a rule, because no trade was taken by
 * choice. Folded into the rule-compliance streak at the call site: a deliberate
 * flat day is perfect compliance, and treating it as a gap made the compliance
 * streak a trading streak in disguise.
 */
export function flatDays(logs: ProcessLog[]): string[] {
  return [...new Set(logs.filter((l) => l.kind === 'no_trade' || l.kind === 'rest').map((l) => l.day))]
}

/** Completed reviews, all time. Feeds the review badge ladder. */
export function reviewCount(logs: ProcessLog[]): number {
  return logs.filter((l) => l.kind === 'review').length
}

/**
 * What the user has already recorded for `dayKey` — drives the card's toggles.
 *
 * Lives here rather than beside the component so a Server Component can build it
 * without importing a value from a `'use client'` module: that import resolves to
 * a client-reference proxy and throws when touched, which is how /admin/feedback
 * went down on 2026-09-04. Types are erased and safe; values are not.
 */
export type TodayEntry = { kind: ProcessKind; outcome: ReflectionOutcome | null }

export function entriesForDay(logs: ProcessLog[], dayKey: string): TodayEntry[] {
  const m = new Map<ProcessKind, ReflectionOutcome | null>()
  for (const l of logs) if (l.day === dayKey) m.set(l.kind, l.outcome ?? null)
  return [...m].map(([kind, outcome]) => ({ kind, outcome }))
}
