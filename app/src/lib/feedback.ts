export const FEEDBACK_TYPES = ['bug', 'feedback', 'feature', 'other'] as const
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  bug: 'Bug',
  feedback: 'Feedback',
  feature: 'Feature request',
  other: 'Other',
}

export const FEEDBACK_MAX = 2000

export type FeedbackInput = { type: string; message: string }

/** Validate + normalize a submission. Pure, so it can be unit-tested and shared by the server action. */
export function validateFeedback(input: FeedbackInput):
  | { ok: true; type: FeedbackType; message: string }
  | { ok: false; error: string } {
  const type = input.type as FeedbackType
  if (!FEEDBACK_TYPES.includes(type)) return { ok: false, error: 'Pick a valid type.' }

  const message = (input.message ?? '').trim()
  if (!message) return { ok: false, error: 'Write a message first.' }
  if (message.length > FEEDBACK_MAX) return { ok: false, error: `Message is too long (${FEEDBACK_MAX} max).` }

  return { ok: true, type, message }
}
