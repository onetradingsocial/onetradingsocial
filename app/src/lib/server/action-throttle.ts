import 'server-only'

import { headers } from 'next/headers'
import { rateLimitShared } from '@/lib/server/rate-limit'

/**
 * Throttling for server actions (WS11; audit item 10 finding 8, the half WS8
 * deferred).
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 *
 * WS8 built the durable limiter and wired it into two API routes. Every server
 * action except the three credential ones WS2 covered had zero rate limiting:
 * posting, commenting, following, messaging, trade logging, profile edits,
 * uploads, reports, imports and account export were all unmetered POST
 * endpoints that any signed-in account could drive in a loop.
 *
 * ── THE IDIOM ────────────────────────────────────────────────────────────────
 *
 * Deliberately the same shape as `allowAuthAttempt` in `auth-throttle.ts`, so
 * there is ONE way of throttling a server action in this codebase rather than
 * two. A call site is two lines, placed immediately after the auth check:
 *
 *     const gate = await allowAction(POST_BUDGET, user.id)
 *     if (!gate.ok) return { error: gate.message }
 *
 * The action keeps its own return shape — `{ error }`, `{ ok: false, error }`,
 * `{ passed, xpAwarded, error }`, or `void` — so a throttled call is
 * indistinguishable in shape from any other refusal the action already makes,
 * and every existing caller renders it without a change.
 *
 * ── THE KEY ──────────────────────────────────────────────────────────────────
 *
 * `api/track` (item 10 finding 3) keyed its bucket on a CLIENT-SUPPLIED value,
 * so rotating that value bought a fresh bucket and the limit never fired. That
 * mistake is not repeated here:
 *
 *   - the key is the authenticated user id, which every call site reads from
 *     `supabase.auth.getUser()` (or `getSessionUser()` on read paths) — never
 *     from an action argument;
 *   - a `userId` that is not a UUID is treated as ABSENT, not as a key, so a
 *     call site that ever passed a client string would degrade to the IP bucket
 *     rather than silently minting a per-string bucket;
 *   - the IP fallback exists only for the one action reachable without a
 *     session (`search`).
 *
 * `tests/unit/action-throttle.test.ts` walks `src/app/actions/` and fails if any
 * `allowAction(...)` call passes anything other than a session-derived id. That
 * guard, not this comment, is what stops the key drifting back.
 *
 * ── FAIL OPEN, DELIBERATELY, AND WITH A FLOOR ────────────────────────────────
 *
 * `rateLimitShared` fails OPEN: if `consume_rate_limit()` errors, it degrades to
 * the in-process tier-1 verdict and the request proceeds on that. Every call
 * site here inherits that, consistently, with no exceptions. The reasoning:
 *
 * 1. **Shared failure domain.** The limiter is a Postgres round trip to the
 *    same database the action is about to write to. If `consume_rate_limit()`
 *    is failing, the action's own INSERT is almost certainly failing too.
 *    Failing closed would not protect anything — it would swap one error for a
 *    worse-targeted one, while adding a new way for the app to break that the
 *    unthrottled code did not have.
 * 2. **Blast radius.** These are every write path in the product. Failing
 *    closed turns a pool timeout into "nobody can post, comment, message, log a
 *    trade or edit their profile" — a total product outage caused by the
 *    protection rather than by the threat.
 * 3. **It is not "no limit".** `rateLimitShared` consumes the in-process bucket
 *    unconditionally, so during an outage the limit still binds per warm
 *    instance. The ceiling rises from `max` to `max x (warm instances)`; it
 *    does not disappear. That property has its own test in
 *    `tests/unit/rate-limit.test.ts` and must not regress.
 * 4. **Consistency.** `api/track` and `api/market/*` already depend on fail-open
 *    behaviour. Two policies inside one limiter would be worse than one honest
 *    one.
 *
 * The cost is stated plainly: a full database outage removes cross-instance
 * throttling. That is accepted because rate limiting is not what protects data
 * integrity here — RLS and the ownership checks are, and they are enforced by
 * the same database that just went down, so the attacker gains no write they
 * could not already be refused.
 *
 * ── LIMITS ARE PER CLASS, NOT ONE GLOBAL NUMBER ──────────────────────────────
 *
 * Each budget below carries the natural rate it was chosen against. They are
 * NOT round numbers picked for tidiness: a limit that is comfortable for
 * journaling is far too loose for direct messages, and one that is right for
 * moderation reports would break an infinite-scroll feed on the first swipe.
 */

export type ActionBudget = {
  /** Bucket namespace. Distinct per class so budgets never share a bucket. */
  scope: string
  /** Attempts permitted per window, per caller. */
  max: number
  windowMs: number
}

const MIN = 60_000
const HOUR = 60 * MIN

// ---------------------------------------------------------------------------
// Budgets. Each one records the natural rate it was sized against.
// ---------------------------------------------------------------------------

/** Public posts. A prolific human posts a handful an hour; 10 per 10 minutes is
 *  six times that and still stops a scripted feed flood, which is the abuse
 *  every other user sees. */
export const POST_BUDGET: ActionBudget = { scope: 'act:post', max: 10, windowMs: 10 * MIN }

/** Comments run faster than posts — a live thread is a conversation — but each
 *  one notifies the post author and every @mention, so the fan-out is real. */
export const COMMENT_BUDGET: ActionBudget = { scope: 'act:comment', max: 30, windowMs: 10 * MIN }

/** Direct messages. Six a minute sustained covers the fastest real chat; the
 *  thing being stopped is one account opening 30 conversations with strangers
 *  in five minutes, which is the harassment/spam shape, not the chat shape.
 *  Tighter per minute than comments precisely because the recipient cannot
 *  scroll past it. */
export const MESSAGE_BUDGET: ActionBudget = { scope: 'act:message', max: 30, windowMs: 5 * MIN }

/** Likes and poll votes. Deliberately the loosest budget in the file: a user
 *  scrolling a feed taps these continuously, and throttling that would break
 *  ordinary use to prevent an abuse whose payload is a single boolean row. */
export const REACTION_BUDGET: ActionBudget = { scope: 'act:reaction', max: 120, windowMs: 5 * MIN }

/** Follow / unfollow / favourite. Follow-churn is a real growth-spam pattern
 *  (mass-follow, wait, mass-unfollow) and each follow notifies the target.
 *  Someone working through a suggestions list can still add 60 people. */
export const GRAPH_BUDGET: ActionBudget = { scope: 'act:graph', max: 60, windowMs: 10 * MIN }

/** Journal writes: trades, goals, rules, templates. A heavy session for a real
 *  day-trader is tens of entries; 60 per 10 minutes clears that with room, and
 *  these rows feed the public leaderboard so unbounded writes are not neutral. */
export const JOURNAL_BUDGET: ActionBudget = { scope: 'act:journal', max: 60, windowMs: 10 * MIN }

/** Profile and settings. Nobody edits their bio 20 times in 10 minutes. Kept
 *  low because `saveAccount` runs a backfill loop over the caller's whole trade
 *  history, so it is the most expensive "settings" write in the product. */
export const PROFILE_BUDGET: ActionBudget = { scope: 'act:profile', max: 20, windowMs: 10 * MIN }

/** Signed upload URLs. Each one is a write capability into a storage bucket, so
 *  the budget is on handing them out, not on the bytes (the bucket's own size
 *  and MIME limits are the control on those). */
export const UPLOAD_BUDGET: ActionBudget = { scope: 'act:upload', max: 20, windowMs: 10 * MIN }

/** Reports, feedback and feature requests — anything that queues work for a
 *  human. Five an hour is generous for a person with a genuine complaint and
 *  useless for burying the moderation queue. */
export const REPORT_BUDGET: ActionBudget = { scope: 'act:report', max: 5, windowMs: HOUR }

/** Broker/exchange connect, disconnect and manual sync. These call MetaApi and
 *  Binance and MetaApi bills per provisioned account, so this is the one budget
 *  where the abuse costs real money. Connecting a broker is a once-ever action
 *  for almost every user. */
export const EXTERNAL_BUDGET: ActionBudget = { scope: 'act:external', max: 10, windowMs: HOUR }

/** MT5 statement parse and commit. Each parse inflates an uploaded archive and
 *  each commit upserts up to 500 rows. A user correcting a bad export retries a
 *  few times; 20 an hour covers that. */
export const IMPORT_BUDGET: ActionBudget = { scope: 'act:import', max: 20, windowMs: HOUR }

/** GDPR export: eleven unbounded table scans of the caller's own data, returned
 *  as one JSON blob. Legitimately used once, occasionally twice. */
export const EXPORT_BUDGET: ActionBudget = { scope: 'act:export', max: 3, windowMs: HOUR }

/** Account deletion. Already password-throttled on the email-identity path via
 *  LOGIN_BUDGET; this covers the Google-only path, which has no password to
 *  check and so had no limit at all, and bounds the Stripe/MetaApi/storage
 *  calls each attempt makes. */
export const ACCOUNT_DELETE_BUDGET: ActionBudget = { scope: 'act:account-delete', max: 5, windowMs: HOUR }

/** Global search: an ILIKE over profiles plus a full-text query over posts,
 *  fired from a typeahead. One a second is far above what a debounced input
 *  produces and well below what a scraper wants. The only budget that can be
 *  keyed on IP, because `search` is the only action reachable without a
 *  session. */
export const SEARCH_BUDGET: ActionBudget = { scope: 'act:search', max: 60, windowMs: MIN }

/** Feed pagination. Each page hydrates 20 posts with their images, polls, likes
 *  and authors. Infinite scroll means a fast reader fires these back to back. */
export const FEED_BUDGET: ActionBudget = { scope: 'act:feed', max: 60, windowMs: 5 * MIN }

/** Ambient UI state: read receipts, notification marks, thread opens, message
 *  deletes, accepting or declining a request. Cheap, idempotent, and driven by
 *  navigation rather than intent — so the budget exists to bound a runaway
 *  client (a render loop calling markThreadRead forever), not to police a user. */
export const AMBIENT_BUDGET: ActionBudget = { scope: 'act:ambient', max: 120, windowMs: 5 * MIN }

// ---------------------------------------------------------------------------

export type ActionThrottleVerdict =
  | { ok: true }
  | { ok: false; retryAfter: number; message: string }

/**
 * A wait a person can act on. "Try again later" tells the user nothing and
 * invites them to retry immediately, which spends another attempt.
 */
export function throttleMessage(retryAfter: number): string {
  const s = Math.max(1, Math.ceil(retryAfter))
  if (s < 60) return `You're doing that too quickly. Try again in ${s} second${s === 1 ? '' : 's'}.`
  const m = Math.ceil(s / 60)
  if (m < 60) return `You're doing that too quickly. Try again in ${m} minute${m === 1 ? '' : 's'}.`
  const h = Math.ceil(m / 60)
  return `You're doing that too quickly. Try again in ${h} hour${h === 1 ? '' : 's'}.`
}

/** Supabase user ids are UUIDs. Anything else did not come from a session. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The bucket key. Exported so it can be asserted directly in tests without
 * standing up a request context.
 *
 * A non-UUID `userId` is discarded rather than used: if a call site ever passed
 * an action argument by mistake, the failure mode must be "this caller shares
 * the IP bucket" (annoying) and not "this caller gets a private bucket per
 * string they choose" (the `api/track` bypass, reintroduced).
 */
export function actionKey(budget: ActionBudget, userId: string | null | undefined, ip: string): string {
  if (userId && UUID_RE.test(userId)) return `${budget.scope}:u:${userId}`
  return `${budget.scope}:ip:${ip || 'unknown'}`
}

/**
 * Best-effort caller IP from the proxy headers Vercel sets. Same reasoning as
 * `auth-throttle.ts`: `x-forwarded-for` is client-controlled in general, but
 * Vercel overwrites the leftmost entry, so the first hop is trustworthy in
 * production.
 */
async function callerIp(): Promise<string> {
  try {
    const h = await headers()
    const fwd = h.get('x-forwarded-for')?.split(',')[0]?.trim()
    return fwd || h.get('x-real-ip') || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Consume one attempt against `budget` for the signed-in caller.
 *
 * `userId` MUST come from `supabase.auth.getUser()` (mutations) or
 * `getSessionUser()` (reads) — never from an argument the client supplied. Pass
 * `null` only where the action is genuinely reachable without a session, in
 * which case the caller falls back to their IP bucket.
 *
 * Fails OPEN — see the header. A refusal carries both the raw `retryAfter` (for
 * a caller that wants to build its own copy) and a ready-made `message`, so no
 * call site has to invent wording and the copy cannot drift across 50 sites.
 */
export async function allowAction(
  budget: ActionBudget,
  userId: string | null,
): Promise<ActionThrottleVerdict> {
  const authenticated = !!userId && UUID_RE.test(userId)
  const key = actionKey(budget, userId, authenticated ? '' : await callerIp())

  const verdict = await rateLimitShared(key, budget.max, budget.windowMs)
  if (verdict.ok) return { ok: true }
  return { ok: false, retryAfter: verdict.retryAfter, message: throttleMessage(verdict.retryAfter) }
}
