import { describe, it, expect } from 'vitest'
import { validateFeedback, FEEDBACK_MAX } from '@/lib/feedback'

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
