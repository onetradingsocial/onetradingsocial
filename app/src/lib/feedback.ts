export const FEEDBACK_TYPES = ['bug', 'feedback', 'feature', 'verification', 'account', 'other'] as const
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  bug: 'Bug',
  feedback: 'Feedback',
  feature: 'Feature request',
  verification: 'Verification issue',
  account: 'Account issue',
  other: 'Other',
}

/**
 * Triage themes, as [value, label] pairs.
 *
 * Lives here, and NOT in the FeedbackCategory component, because
 * /admin/feedback renders this list from a Server Component while the <select>
 * that writes it is a client one. FeedbackCategory carries 'use client', so a
 * server import of a plain value from that module reaches a client-reference
 * proxy rather than the array, and touching it throws during the server
 * render. The page only renders the list once at least one row is categorised,
 * so the crash stayed hidden until the first admin picked a theme.
 *
 * The action's validation set is derived from this list below, so the values
 * an admin can pick and the values the server will accept cannot drift.
 */
export const FEEDBACK_CATEGORIES = [
  ['bug', 'Bug'],
  ['confusing_ux', 'Confusing UX'],
  ['missing_feature', 'Missing feature'],
  ['performance', 'Performance'],
  ['verification', 'Verification'],
  ['pricing', 'Pricing'],
  ['trust', 'Trust'],
  ['education', 'Education'],
] as const

export type FeedbackCategoryValue = (typeof FEEDBACK_CATEGORIES)[number][0]

/** The values `setFeedbackCategory` accepts, derived so it cannot drift. */
export const FEEDBACK_CATEGORY_VALUES: ReadonlySet<string> =
  new Set(FEEDBACK_CATEGORIES.map(([v]) => v))

export const FEEDBACK_MAX = 2000

export type FeedbackInput = { type: string; message: string }

// 'survey' is submitted programmatically by MicroSurvey, never listed in the
// widget dropdown — hence valid for storage but absent from FEEDBACK_TYPES.
const STORABLE_TYPES = [...FEEDBACK_TYPES, 'survey'] as const

/** Validate + normalize a submission. Pure, so it can be unit-tested and shared by the server action. */
export function validateFeedback(input: FeedbackInput):
  | { ok: true; type: FeedbackType | 'survey'; message: string }
  | { ok: false; error: string } {
  const type = input.type as FeedbackType
  if (!(STORABLE_TYPES as readonly string[]).includes(type)) return { ok: false, error: 'Pick a valid type.' }

  const message = (input.message ?? '').trim()
  if (!message) return { ok: false, error: 'Write a message first.' }
  if (message.length > FEEDBACK_MAX) return { ok: false, error: `Message is too long (${FEEDBACK_MAX} max).` }

  return { ok: true, type, message }
}

/**
 * Validate + normalize an admin's reply to a feedback item.
 *
 * Same 1..2000 bound as the submission, and as the `admin_reply` check in
 * migration 0066 — an admin cannot answer at greater length than a user can
 * ask. Separate from validateFeedback because a reply has no `type` to pick
 * and its wording is addressed at an admin, not at the person filing a bug.
 *
 * Pure, so the bound is unit-testable without a database or a session; the
 * server action is then only responsible for authorisation and persistence.
 */
export function validateReplyBody(body: string):
  | { ok: true; body: string }
  | { ok: false; error: string } {
  const trimmed = (body ?? '').trim()
  if (!trimmed) return { ok: false, error: 'Write a reply first.' }
  if (trimmed.length > FEEDBACK_MAX) return { ok: false, error: `Reply is too long (${FEEDBACK_MAX} max).` }
  return { ok: true, body: trimmed }
}
