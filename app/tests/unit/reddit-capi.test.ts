import { describe, it, expect } from 'vitest'
import { hashSha256, normalizeEmail, buildConversionBody } from '@/lib/reddit-capi'

describe('hashSha256', () => {
  it('produces the known SHA-256 hex for "abc"', () => {
    expect(hashSha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Test@Example.COM ')).toBe('test@example.com')
  })
})

describe('buildConversionBody', () => {
  it('builds a SignUp event with hashed email + external_id and a conversion_id', () => {
    const body = buildConversionBody({
      eventType: 'SignUp',
      conversionId: 'cid-123',
      email: 'Test@Example.com',
      externalId: 'user-abc',
      eventAt: 1730000000000,
    })
    const ev = body.data.events[0] as Record<string, any>
    expect(body.data.test_mode).toBe(false)
    expect(ev.type).toEqual({ tracking_type: 'SignUp' })
    expect(ev.action_source).toBe('website')
    expect(ev.event_at).toBe(1730000000000)
    expect(ev.user.email).toBe(hashSha256('test@example.com'))
    expect(ev.user.external_id).toBe(hashSha256('user-abc'))
    // conversion_id is SHA-256 hashed to match the browser pixel's hashed value.
    expect(ev.metadata.conversion_id).toBe(hashSha256('cid-123'))
    expect('click_id' in ev).toBe(false)
  })

  it('includes click_id only when provided', () => {
    const body = buildConversionBody({ eventType: 'SignUp', conversionId: 'c', clickId: 'clk_1' })
    expect((body.data.events[0] as any).click_id).toBe('clk_1')
  })

  it('maps Purchase value/currency into event_metadata', () => {
    const body = buildConversionBody({
      eventType: 'Purchase', conversionId: 'sess_1', value: 12.5, currency: 'USD', itemCount: 1,
    })
    const meta = (body.data.events[0] as any).metadata
    expect(meta.value).toBe(12.5)
    expect(meta.currency).toBe('USD')
    expect(meta.item_count).toBe(1)
  })

  it('respects testMode', () => {
    expect(buildConversionBody({ eventType: 'SignUp', conversionId: 'c', testMode: true }).data.test_mode).toBe(true)
  })
})
