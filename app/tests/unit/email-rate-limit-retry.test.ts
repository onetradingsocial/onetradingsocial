import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendEmail } from '@/lib/server/email'

/**
 * sendEmail waits out Resend's short per-second 429 once, and returns a long
 * (daily-quota) 429 straight away for the caller to retry on a later run —
 * no wait inside a 60s cron can outlast a daily quota.
 */
const res = (status: number, retryAfter?: string) =>
  new Response('{}', { status, headers: retryAfter ? { 'retry-after': retryAfter } : {} })

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  process.env.RESEND_API_KEY = 'test'
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete process.env.RESEND_API_KEY
})

const send = () => sendEmail({ to: 'a@example.com', subject: 's', html: '<p>h</p>' })

describe('sendEmail and Resend rate limits', () => {
  it('retries once after a short Retry-After and succeeds', async () => {
    fetchMock.mockResolvedValueOnce(res(429, '1')).mockResolvedValueOnce(res(200))
    const p = send()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await p).toEqual({ sent: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not wait out a long Retry-After (daily quota)', async () => {
    fetchMock.mockResolvedValueOnce(res(429, '3600'))
    expect(await send()).toEqual({ sent: false, error: 'resend_429' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries only once', async () => {
    fetchMock.mockResolvedValue(res(429, '1'))
    const p = send()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await p).toEqual({ sent: false, error: 'resend_429' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry other failures', async () => {
    fetchMock.mockResolvedValueOnce(res(500))
    expect(await send()).toEqual({ sent: false, error: 'resend_500' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
