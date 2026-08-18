import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Guards for the two-tier limiter (audit item 10, findings 3 and 8).
 *
 * The tests that matter are the honest ones: that the shared limiter FAILS OPEN
 * to the in-process one, and that the in-process bucket is still consumed on
 * the fail-open path. If that second property ever regresses, a database
 * outage would hand every caller a fresh empty bucket at exactly the moment
 * protection is weakest — which is worse than having no shared tier at all.
 */

const rpc = vi.fn()

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ rpc }),
}))

// `server-only` throws when imported outside an RSC bundle.
vi.mock('server-only', () => ({}))

type Mod = typeof import('@/lib/server/rate-limit')

async function fresh(): Promise<Mod> {
  vi.resetModules()
  return import('@/lib/server/rate-limit')
}

beforeEach(() => {
  rpc.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rateLimit — tier 1, in process', () => {
  it('allows up to the limit and refuses past it', async () => {
    const { rateLimit } = await fresh()
    expect(rateLimit('k', 2, 60_000)).toEqual({ ok: true })
    expect(rateLimit('k', 2, 60_000)).toEqual({ ok: true })
    const third = rateLimit('k', 2, 60_000)
    expect(third.ok).toBe(false)
    if (!third.ok) expect(third.retryAfter).toBeGreaterThan(0)
  })

  it('resets after the window', async () => {
    const { rateLimit } = await fresh()
    vi.useFakeTimers()
    try {
      rateLimit('w', 1, 1_000)
      expect(rateLimit('w', 1, 1_000).ok).toBe(false)
      vi.advanceTimersByTime(1_500)
      expect(rateLimit('w', 1, 1_000).ok).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps separate buckets per key', async () => {
    const { rateLimit } = await fresh()
    rateLimit('a', 1, 60_000)
    expect(rateLimit('b', 1, 60_000).ok).toBe(true)
  })
})

describe('clientKey', () => {
  it('prefers the authenticated user id', async () => {
    const { clientKey } = await fresh()
    expect(clientKey(new Request('https://x/'), 'uid-1')).toBe('u:uid-1')
  })

  it('falls back to the leftmost forwarded IP', async () => {
    const { clientKey } = await fresh()
    const req = new Request('https://x/', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } })
    expect(clientKey(req)).toBe('ip:203.0.113.7')
  })

  it('is never empty', async () => {
    const { clientKey } = await fresh()
    expect(clientKey(new Request('https://x/'))).toBe('ip:unknown')
  })
})

describe('rateLimitShared — tier 2, Postgres backed', () => {
  it('reports the durable verdict when the function answers', async () => {
    const { rateLimitShared } = await fresh()
    rpc.mockResolvedValue({ data: [{ allowed: true, retry_after: 0 }], error: null })
    await expect(rateLimitShared('s1', 10, 60_000)).resolves.toEqual({ ok: true, durable: true })
  })

  it('refuses with the retry_after the database returned', async () => {
    const { rateLimitShared } = await fresh()
    rpc.mockResolvedValue({ data: [{ allowed: false, retry_after: 42 }], error: null })
    await expect(rateLimitShared('s2', 1, 60_000))
      .resolves.toEqual({ ok: false, retryAfter: 42, durable: true })
  })

  it('calls the RPC with the parameter names the migration declares', async () => {
    const { rateLimitShared } = await fresh()
    rpc.mockResolvedValue({ data: [{ allowed: true, retry_after: 0 }], error: null })
    await rateLimitShared('s3', 7, 5_000)
    expect(rpc).toHaveBeenCalledWith('consume_rate_limit', {
      p_key: 's3', p_max: 7, p_window_ms: 5_000,
    })
  })

  it('FAILS OPEN to the in-process limiter when the function is missing', async () => {
    const { rateLimitShared } = await fresh()
    // What PostgREST returns when 0056 has not been applied.
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } })
    const r = await rateLimitShared('s4', 5, 60_000)
    expect(r).toEqual({ ok: true, durable: false })
  })

  it('fails open when the client throws outright', async () => {
    const { rateLimitShared } = await fresh()
    rpc.mockRejectedValue(new Error('connection reset'))
    await expect(rateLimitShared('s5', 5, 60_000)).resolves.toEqual({ ok: true, durable: false })
  })

  it('still consumes the local bucket while degraded, so the fallback bites', async () => {
    const { rateLimitShared } = await fresh()
    rpc.mockRejectedValue(new Error('down'))
    expect((await rateLimitShared('s6', 2, 60_000)).ok).toBe(true)
    expect((await rateLimitShared('s6', 2, 60_000)).ok).toBe(true)
    const third = await rateLimitShared('s6', 2, 60_000)
    expect(third).toMatchObject({ ok: false, durable: false })
  })

  it('consumes the local bucket even on the durable path, so a mid-window outage does not reset it', async () => {
    const { rateLimitShared } = await fresh()
    rpc.mockResolvedValue({ data: [{ allowed: true, retry_after: 0 }], error: null })
    await rateLimitShared('s7', 1, 60_000)
    rpc.mockRejectedValue(new Error('down'))
    expect((await rateLimitShared('s7', 1, 60_000)).ok).toBe(false)
  })

  it('tolerates a malformed row rather than trusting it', async () => {
    const { rateLimitShared } = await fresh()
    rpc.mockResolvedValue({ data: [{ nonsense: true }], error: null })
    await expect(rateLimitShared('s8', 5, 60_000)).resolves.toEqual({ ok: true, durable: false })
  })

  it('accepts a single-object result as well as a row array', async () => {
    const { rateLimitShared } = await fresh()
    rpc.mockResolvedValue({ data: { allowed: false, retry_after: 9 }, error: null })
    await expect(rateLimitShared('s9', 1, 60_000))
      .resolves.toEqual({ ok: false, retryAfter: 9, durable: true })
  })
})

describe('market quota — item 10 finding 2', () => {
  it('charges the platform bucket before the per-user bucket', async () => {
    vi.resetModules()
    rpc.mockResolvedValue({ data: [{ allowed: true, retry_after: 0 }], error: null })
    const { spendMarketCredit, MARKET_DAILY_BUDGET, MARKET_PER_USER_MAX } =
      await import('@/lib/server/market-quota')

    await spendMarketCredit('uid-1')

    expect(rpc).toHaveBeenCalledTimes(2)
    const [first, second] = rpc.mock.calls
    expect(first[1].p_key).toMatch(/^market:day:\d{4}-\d{2}-\d{2}$/)
    expect(first[1].p_max).toBe(MARKET_DAILY_BUDGET)
    expect(second[1].p_key).toBe('market:u:uid-1')
    expect(second[1].p_max).toBe(MARKET_PER_USER_MAX)
  })

  it('keeps the platform budget under the provider free tier of 800/day', async () => {
    vi.resetModules()
    const { MARKET_DAILY_BUDGET } = await import('@/lib/server/market-quota')
    expect(MARKET_DAILY_BUDGET).toBeLessThan(800)
  })

  it('reports which budget refused, so the caller can degrade differently', async () => {
    vi.resetModules()
    rpc.mockResolvedValue({ data: [{ allowed: false, retry_after: 30 }], error: null })
    const { spendMarketCredit } = await import('@/lib/server/market-quota')
    await expect(spendMarketCredit('uid-2'))
      .resolves.toEqual({ ok: false, scope: 'platform', retryAfter: 30 })
  })

  it('does not charge the per-user bucket once the platform budget is gone', async () => {
    vi.resetModules()
    rpc.mockResolvedValue({ data: [{ allowed: false, retry_after: 30 }], error: null })
    const { spendMarketCredit } = await import('@/lib/server/market-quota')
    await spendMarketCredit('uid-3')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
