import 'server-only'
import { rateLimitShared } from '@/lib/server/rate-limit'

/**
 * Spend control for the Twelve Data proxy routes (audit item 10, finding 2).
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────────────
 *
 * `api/market/quote` and `api/market/search` require authentication — that part
 * was already right — but neither had any rate limit at all. The per-symbol TTL
 * caches in those routes only help on REPEAT symbols; distinct symbols miss
 * every time and each miss spends a Twelve Data credit. The free tier is
 * **800 credits/day shared across the entire platform**, so a few hundred
 * requests (a scripted loop, or an accidental render loop in the trade modal)
 * takes live quotes and symbol search dark for EVERY user until the provider's
 * midnight-UTC reset. `quote` at least degrades to a stale cache entry when the
 * provider rate-limits; `search` has no fallback.
 *
 * ── THE TWO BUDGETS ──────────────────────────────────────────────────────────
 *
 * A per-user limit alone does not solve it: with enough accounts the platform
 * quota still goes. A platform-wide limit alone does not solve it either, since
 * one account can then eat the whole day's budget before anyone else wakes up.
 * So both, and both cross-instance — a per-instance count of a quota that is
 * shared with a third party is not a control, it is a guess.
 *
 * Both are consumed only on a cache MISS, i.e. only when a credit is actually
 * about to be spent. A cache hit costs the provider nothing and so costs the
 * caller nothing.
 *
 * ── THE NUMBERS, AND WHY ─────────────────────────────────────────────────────
 *
 * 600 of the 800 daily credits, leaving 200 of headroom. The reserve is the
 * point: when the platform budget is exhausted the app returns "unavailable"
 * from its OWN counter while the provider still has credits left, which means
 * the failure is ours to see in logs and the provider account never actually
 * hits its wall. Raise both numbers together the day the plan is upgraded.
 */

/** Platform-wide, per UTC day. Deliberately below the provider's 800. */
export const MARKET_DAILY_BUDGET = 600

/** Per user, per minute. Ample for a human; useless for a loop. */
export const MARKET_PER_USER_MAX = 30
export const MARKET_PER_USER_WINDOW_MS = 60_000

const DAY_MS = 24 * 60 * 60 * 1000

export type QuotaVerdict = { ok: true } | { ok: false; scope: 'user' | 'platform'; retryAfter: number }

/**
 * Consume one market-data credit. Call ONLY when the request is about to hit
 * the upstream provider.
 *
 * The global bucket is keyed on the UTC date so it rolls over at exactly the
 * moment Twelve Data resets, rather than 24 hours after whenever this bucket
 * happened to be created.
 */
export async function spendMarketCredit(userId: string): Promise<QuotaVerdict> {
  const day = new Date().toISOString().slice(0, 10)

  const platform = await rateLimitShared(`market:day:${day}`, MARKET_DAILY_BUDGET, DAY_MS)
  if (!platform.ok) return { ok: false, scope: 'platform', retryAfter: platform.retryAfter }

  const perUser = await rateLimitShared(
    `market:u:${userId}`,
    MARKET_PER_USER_MAX,
    MARKET_PER_USER_WINDOW_MS,
  )
  if (!perUser.ok) return { ok: false, scope: 'user', retryAfter: perUser.retryAfter }

  return { ok: true }
}
