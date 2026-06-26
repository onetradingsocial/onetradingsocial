import { describe, it, expect } from 'vitest'
import { orderPair, canMessage, validateAttachments, summarizePreview, type Attachment } from '@/lib/messaging'

describe('orderPair', () => {
  it('returns the same canonical order regardless of argument order', () => {
    const a = orderPair('aaa', 'bbb')
    const b = orderPair('bbb', 'aaa')
    expect(a).toEqual(b)
    expect(a.userA < a.userB).toBe(true)
  })
})

describe('canMessage', () => {
  it('allows when both follow each other', () => {
    expect(canMessage(true, true)).toBe(true)
  })
  it('blocks one-way follows', () => {
    expect(canMessage(true, false)).toBe(false)
    expect(canMessage(false, true)).toBe(false)
  })
  it('blocks strangers', () => {
    expect(canMessage(false, false)).toBe(false)
  })
})

describe('validateAttachments', () => {
  const img: Attachment = { type: 'image', url: 'https://x/1.png' }
  const trade: Attachment = { type: 'trade', tradeId: 't1' }
  it('accepts up to 4 images', () => {
    expect(validateAttachments([img, img, img, img]).ok).toBe(true)
  })
  it('rejects more than 4 images', () => {
    expect(validateAttachments([img, img, img, img, img]).ok).toBe(false)
  })
  it('accepts a single trade', () => {
    expect(validateAttachments([trade]).ok).toBe(true)
  })
  it('rejects more than one trade', () => {
    expect(validateAttachments([trade, trade]).ok).toBe(false)
  })
  it('accepts an empty attachment list', () => {
    expect(validateAttachments([]).ok).toBe(true)
  })
})

describe('summarizePreview', () => {
  it('shows body text when present', () => {
    expect(summarizePreview({ body: 'hello there', attachments: [], deletedAt: null })).toBe('hello there')
  })
  it('labels image-only messages', () => {
    expect(summarizePreview({ body: null, attachments: [{ type: 'image', url: 'x' }], deletedAt: null })).toBe('📷 Photo')
  })
  it('labels trade-only messages', () => {
    expect(summarizePreview({ body: null, attachments: [{ type: 'trade', tradeId: 't' }], deletedAt: null })).toBe('📈 Shared a trade')
  })
  it('shows a placeholder for deleted messages', () => {
    expect(summarizePreview({ body: 'hi', attachments: [], deletedAt: '2026-06-26T00:00:00Z' })).toBe('Message deleted')
  })
})
