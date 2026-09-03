import { describe, it, expect } from 'vitest'
import { validateFeedback, validateReplyBody, FEEDBACK_MAX } from '@/lib/feedback'

describe('validateFeedback', () => {
  it('accepts a valid submission and trims the message', () => {
    const r = validateFeedback({ type: 'bug', message: '  app crashes on save  ' })
    expect(r).toEqual({ ok: true, type: 'bug', message: 'app crashes on save' })
  })

  it('rejects an unknown type', () => {
    const r = validateFeedback({ type: 'spam', message: 'hi' })
    expect(r).toEqual({ ok: false, error: 'Pick a valid type.' })
  })

  it('rejects an empty or whitespace-only message', () => {
    expect(validateFeedback({ type: 'feedback', message: '   ' }).ok).toBe(false)
    expect(validateFeedback({ type: 'feedback', message: '' }).ok).toBe(false)
  })

  it('rejects a message over the max length', () => {
    const r = validateFeedback({ type: 'other', message: 'x'.repeat(FEEDBACK_MAX + 1) })
    expect(r.ok).toBe(false)
  })

  it('accepts a message exactly at the max length', () => {
    expect(validateFeedback({ type: 'feature', message: 'x'.repeat(FEEDBACK_MAX) }).ok).toBe(true)
  })
})

describe('validateReplyBody', () => {
  it('accepts a reply and trims it', () => {
    expect(validateReplyBody("  fixed in today's release  ")).toEqual({
      ok: true,
      body: "fixed in today's release",
    })
  })

  it('rejects an empty or whitespace-only reply', () => {
    // The admin UI disables Send on an empty draft, but the action is a POST
    // endpoint like any other and cannot rely on the button.
    expect(validateReplyBody('')).toEqual({ ok: false, error: 'Write a reply first.' })
    expect(validateReplyBody('   \n  ').ok).toBe(false)
  })

  it('rejects a reply over the max length', () => {
    expect(validateReplyBody('x'.repeat(FEEDBACK_MAX + 1)).ok).toBe(false)
  })

  it('accepts a reply exactly at the max length', () => {
    // Same bound as the submission, and as the admin_reply check in 0066 — if
    // these ever drift, the database rejects a reply the app said was fine.
    expect(validateReplyBody('x'.repeat(FEEDBACK_MAX)).ok).toBe(true)
  })

  it('measures the trimmed length, not the raw one', () => {
    // A reply padded past the cap with whitespace is still a legal reply, and
    // the trimmed value is what the column stores.
    expect(validateReplyBody(' '.repeat(50) + 'x'.repeat(FEEDBACK_MAX) + ' '.repeat(50)).ok).toBe(true)
  })
})
