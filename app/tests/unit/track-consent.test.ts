// app/tests/unit/track-consent.test.ts
//
// Audit item 17 (cookies & tracking), finding 6 — server-side half.
//
// The analytics tier used to be enforced ONLY in `lib/track.ts`, so
// `POST /api/track` happily wrote `analytics_events` rows for a visitor
// carrying `a:0`. A stale bundle, an in-flight beacon or a direct caller was
// enough to bypass the opt-out that `CookieNotice` promises this endpoint
// honours.
//
// The two failure modes this guards are opposites, and BOTH are silent:
//
//   1. under-enforcing — a declined visitor's events keep landing in the table;
//   2. over-enforcing — treating an ABSENT cookie as a decline, which would
//      drop analytics for every first-time visitor. The product is deliberately
//      opt-OUT (ANALYTICS_DEFAULT === true, justified under APP 1.4), so
//      "no cookie" MUST still be stored.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { serializeConsent } from '@/lib/consent'

const insert = vi.fn()
const serviceFrom = vi.fn(() => ({
  insert,
  select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
}))

const rateLimit = vi.fn(() => ({ ok: true }) as const)
const rateLimitShared = vi.fn(async () => ({ ok: true }) as const)

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: serviceFrom }) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({}),
  getSessionUser: async () => null,
}))
vi.mock('@/lib/server/admin', () => ({ isAdmin: () => false }))
vi.mock('@/lib/server/rate-limit', () => ({
  rateLimit: (...a: unknown[]) => rateLimit(...(a as [])),
  rateLimitShared: (...a: unknown[]) => rateLimitShared(...(a as [])),
  clientKey: () => 'track:ip:test',
  tooMany: () => new Response(null, { status: 429 }),
}))

type Route = typeof import('@/app/api/track/route')

async function post(cookie: string | null): Promise<Response> {
  vi.resetModules()
  const { POST }: Route = await import('@/app/api/track/route')
  const req = new NextRequest('http://localhost/api/track', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie === null ? {} : { cookie: `ts_consent=${cookie}` }),
    },
    body: JSON.stringify({ event: 'page_view', path: '/consent-probe', anonId: 'anon-test' }),
  })
  return POST(req)
}

beforeEach(() => {
  insert.mockReset()
  insert.mockResolvedValue({ error: null })
  serviceFrom.mockClear()
  rateLimit.mockClear()
  rateLimitShared.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/track — analytics consent is enforced server-side', () => {
  it('drops the event when analytics is explicitly declined', async () => {
    const res = await post(serializeConsent(false, false))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(insert).not.toHaveBeenCalled()
  })

  it('stores the event when analytics is explicitly accepted', async () => {
    const res = await post(serializeConsent(true, false))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert.mock.calls[0][0]).toMatchObject({ event: 'page_view', path: '/consent-probe' })
  })

  // The opt-out default. If this ever fails, analytics has silently been turned
  // off for every visitor who has not yet answered the notice.
  it('stores the event when NO consent cookie is present at all', async () => {
    const res = await post(null)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(insert).toHaveBeenCalledTimes(1)
  })

  // Same reasoning: a cookie we cannot read is not a decline. `parseConsent`
  // returns null for a version bump or a truncated value, and null must fall
  // back to the documented default rather than to "off".
  it('stores the event when the cookie is unparseable', async () => {
    for (const raw of ['garbage', 'v:99|a:0|d:0', 'v:1']) {
      insert.mockClear()
      const res = await post(raw)
      expect(res.status).toBe(200)
      expect(insert, `cookie ${raw} should fall back to the opt-out default`).toHaveBeenCalledTimes(1)
    }
  })

  // The gate has to sit ahead of the buckets, otherwise a declined visitor can
  // still exhaust the shared per-IP budget for everyone behind that address.
  it('declines cost nothing: neither rate-limit bucket is consumed', async () => {
    await post(serializeConsent(false, false))

    expect(rateLimitShared).not.toHaveBeenCalled()
    expect(rateLimit).not.toHaveBeenCalled()
    expect(serviceFrom).not.toHaveBeenCalled()
  })
})

describe('consentFromCookie is the single shared implementation', () => {
  // The client (`lib/track.ts` via `readConsent`) and the route must read the
  // cookie through ONE function. A second, hand-rolled parser in the route is
  // how the two ended up disagreeing in the first place.
  it('the route reuses lib/consent rather than parsing the cookie itself', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(
      join(__dirname, '..', '..', 'src', 'app', 'api', 'track', 'route.ts'),
      'utf8',
    )
    expect(src).toContain("from '@/lib/consent'")
    expect(src).toContain('consentFromCookie')
    // No second parser: the route must not crack the cookie header apart itself.
    expect(src).not.toMatch(/headers\s*\.\s*get\(\s*['"]cookie/i)
    expect(src).not.toContain('ts_consent=')
  })
})
