import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { emailSuppression, isTransientEmailError, sendEmail } from '@/lib/server/email'

/**
 * 2026-09-15: an e2e run on a local server used the real Resend key and mailed
 * ~90 test accounts. Every one bounced, and the day's quota was gone before the
 * production cron ran. Only production may send; reserved addresses never.
 */
const prod = { VERCEL_ENV: 'production' }

describe('emailSuppression', () => {
  it('lets production send to a real address', () => {
    expect(emailSuppression('trader@gmail.com', prod)).toBeNull()
  })

  it('blocks every non-production environment, including a local `next start`', () => {
    expect(emailSuppression('trader@gmail.com', {})).toBe('not_production')
    expect(emailSuppression('trader@gmail.com', { VERCEL_ENV: 'preview' })).toBe('not_production')
    expect(emailSuppression('trader@gmail.com', { VERCEL_ENV: 'development', NODE_ENV: 'production' })).toBe('not_production')
  })

  it('keeps production sending if Vercel ever stops exposing VERCEL_ENV', () => {
    // Without this fallback a hidden system variable would silently stop every
    // production email, trial notices included.
    expect(emailSuppression('trader@gmail.com', { NEXT_PUBLIC_SITE_URL: 'https://app.tradingsocial.io' })).toBeNull()
    // ...while a local server, whose site URL is localhost, stays blocked.
    expect(emailSuppression('trader@gmail.com', { NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })).toBe('not_production')
    expect(emailSuppression('trader@gmail.com', { NEXT_PUBLIC_SITE_URL: 'https://localhost:3000' })).toBe('not_production')
    // An explicit non-production VERCEL_ENV wins over a production-looking URL.
    expect(emailSuppression('trader@gmail.com', { VERCEL_ENV: 'preview', NEXT_PUBLIC_SITE_URL: 'https://app.tradingsocial.io' })).toBe('not_production')
  })

  it('allows a deliberate opt-in outside production', () => {
    expect(emailSuppression('me@gmail.com', { EMAIL_SEND_OUTSIDE_PRODUCTION: '1' })).toBeNull()
  })

  it('never mails reserved domains, even in production or with the opt-in', () => {
    for (const to of ['seek_x@search.tradingsocial.test', 'a@b.example', 'x@y.invalid', 'u@example.com', 'U@Example.ORG']) {
      expect(emailSuppression(to, prod)).toBe('reserved_address')
      expect(emailSuppression(to, { EMAIL_SEND_OUTSIDE_PRODUCTION: '1' })).toBe('reserved_address')
    }
  })

  it('is a permanent failure, so callers stamp instead of retrying nightly', () => {
    expect(isTransientEmailError('not_production')).toBe(false)
    expect(isTransientEmailError('reserved_address')).toBe(false)
  })
})

describe('sendEmail checks it before touching the network', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    process.env.RESEND_API_KEY = 'real-key-in-env-local'
    delete process.env.VERCEL_ENV
    delete process.env.EMAIL_SEND_OUTSIDE_PRODUCTION
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.RESEND_API_KEY
    delete process.env.VERCEL_ENV
  })

  it('does not call Resend from a local server, even with a real key', async () => {
    expect(await sendEmail({ to: 'e2e_123@tradingsocial.io', subject: 's', html: 'h' }))
      .toEqual({ sent: false, error: 'not_production' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does call Resend in production', async () => {
    process.env.VERCEL_ENV = 'production'
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    expect(await sendEmail({ to: 'trader@gmail.com', subject: 's', html: 'h' })).toEqual({ sent: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
