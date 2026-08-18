import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Rate limiting, in two tiers (row 52; audit item 10 findings 3 and 8).
 *
 * ── TIER 1: `rateLimit()` — in-process, synchronous, free ────────────────────
 *
 * LIMITATION, by design and unchanged: state lives in one serverless instance's
 * memory, so it resets on cold start and is not shared across instances. On
 * Vercel the effective ceiling is (warm instances) x (configured limit). It is
 * a blunt guard against runaway clients and casual abuse — NOT a defence
 * against a distributed attacker, and nothing here should be read as claiming
 * otherwise.
 *
 * This tier is still the right tool for the per-user convenience limits on
 * `api/billing/checkout` and the three signed-upload routes: those callers are
 * authenticated, the failure mode is one signed-in account being noisy, and
 * paying a database round trip to count it is not worth it.
 *
 * ── TIER 2: `rateLimitShared()` — Postgres-backed, cross-instance ────────────
 *
 * WS2 deferred the durable store to WS8; this is it, and it is deliberately
 * NARROW. It is used on exactly the surfaces where per-instance counting is
 * genuinely useless:
 *
 *   - `POST /api/track` — unauthenticated, writes to `analytics_events` via the
 *     service client, and its bucket key used to be the client-supplied
 *     `anonId`, so rotating that value bypassed the limit completely (F3);
 *   - `GET /api/market/*` — burns a **shared** 800-credit/day Twelve Data
 *     quota, so one account's loop takes live quotes down for everyone (F2).
 *
 * It is backed by `public.consume_rate_limit()` from migration
 * **0056_rate_limit_store.sql**, which is written but NOT APPLIED. Read the
 * next paragraph before believing any claim about what is enforced today.
 *
 * ── THE HONEST LIMITATIONS ───────────────────────────────────────────────────
 *
 * 1. **It fails open to tier 1.** If the function does not exist (migration not
 *    applied) or the query errors, the call degrades to the in-process limiter
 *    and the request proceeds on that verdict. So before the migration is
 *    applied, behaviour is *exactly* what it is today — no better. Two reasons
 *    it is built this way: the app must be deployable ahead of the migration
 *    (the same pattern WS7 used for `purge_analytics_events`), and a database
 *    hiccup must degrade the throttle rather than 500 every request.
 * 2. **Fixed window, not sliding.** A caller can send up to 2x the limit across
 *    a window boundary. Acceptable: the threat is bulk abuse, not a precisely
 *    timed burst, and a sliding window costs a row per request in the table
 *    that exists to stop rows being written.
 * 3. **It is Postgres, not Redis.** One round trip per limited request, on the
 *    same database the app already depends on. If sustained traffic ever makes
 *    that cost visible, the replacement is Upstash behind this same function
 *    signature — no call site changes.
 * 4. **Neither tier is a DDoS defence.** Volumetric attacks are Vercel's edge
 *    to absorb, not this file's.
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

/**
 * Cross-instance rate limit. See the tier-2 notes at the top of this file —
 * in particular that it FAILS OPEN to `rateLimit()` when the backing function
 * is unavailable, so a caller must not describe this as a hard guarantee.
 *
 * `durable` reports which tier actually produced the verdict, so callers (and
 * tests) can tell an enforced limit from a degraded one.
 */
export type SharedRateLimitResult = RateLimitResult & { durable: boolean }

export async function rateLimitShared(
  key: string,
  max: number,
  windowMs: number,
): Promise<SharedRateLimitResult> {
  // Consume the local bucket first and keep its verdict as the fallback. Doing
  // it unconditionally (rather than only on the error path) means the in-memory
  // counter stays warm and correct, so a database outage does not hand the
  // caller a fresh, empty bucket at exactly the moment protection is weakest.
  const local = rateLimit(key, max, windowMs)

  try {
    const { data, error } = await createServiceClient().rpc('consume_rate_limit', {
      p_key: key,
      p_max: max,
      p_window_ms: windowMs,
    })
    if (error || !data) return { ...local, durable: false }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed?: boolean; retry_after?: number }
      | undefined
    if (!row || typeof row.allowed !== 'boolean') return { ...local, durable: false }

    if (row.allowed) return { ok: true, durable: true }
    return {
      ok: false,
      retryAfter: Math.max(1, Number(row.retry_after) || Math.ceil(windowMs / 1000)),
      durable: true,
    }
  } catch {
    return { ...local, durable: false }
  }
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
