import 'server-only'

/**
 * Shared in-process rate limiter (row 52).
 *
 * LIMITATION, by design: state lives in the serverless instance's memory, so it
 * resets on cold start and is not shared across instances. That makes it a
 * blunt guard against runaway clients and casual abuse — NOT a defence against
 * a distributed attacker. Move to Upstash/Redis if that threat becomes real.
 */

type Bucket = { count: number; start: number }
const buckets = new Map<string, Bucket>()
const MAX_KEYS = 10_000

export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number }

export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const b = buckets.get(key)

  if (!b || now - b.start > windowMs) {
    // Cheap eviction: the map is a cache, not a source of truth.
    if (buckets.size > MAX_KEYS) buckets.clear()
    buckets.set(key, { count: 1, start: now })
    return { ok: true }
  }

  b.count += 1
  if (b.count > max) {
    return { ok: false, retryAfter: Math.ceil((b.start + windowMs - now) / 1000) }
  }
  return { ok: true }
}

/** Best-effort client identity: authenticated user id, else forwarded IP. */
export function clientKey(req: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return `ip:${fwd || req.headers.get('x-real-ip') || 'unknown'}`
}

/** 429 with a Retry-After header. */
export function tooMany(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: 'rate limited' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
  })
}
