import { NextRequest, NextResponse } from 'next/server'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isAdmin } from '@/lib/server/admin'
import { rateLimit, rateLimitShared, clientKey, tooMany } from '@/lib/server/rate-limit'

// Funnel + product events accepted from the client. Whitelist keeps the
// table from becoming a junk drawer (and blocks spam event names).
const ALLOWED = new Set([
  'page_view',
  'signup_started',
  'signup_completed',
  'onboarding_step',
  'onboarding_completed',
  'onboarding_abandoned',
  'first_trade_logged',
  'trade_logged',
  'trade_imported',
  'import_failed',
  'weekly_review_viewed',
  'checkout_started',
  'subscribed',
  'feedback_opened',
  'feedback_submitted',
  'not_found',
  'client_error',
])

const MAX_PROPS_BYTES = 2048
const RATE_WINDOW_MS = 60_000

/**
 * Two independent budgets (audit item 10, finding 3).
 *
 * The old code CHOSE between them: it keyed on `body.anonId` when present and
 * fell back to the IP only when it was absent. `anonId` is request-body input,
 * so a caller sending a fresh random value per request landed in a fresh bucket
 * every time and the limit never fired. This route is unauthenticated and
 * writes to `analytics_events` through the service client, so the consequences
 * were real: unbounded row growth, fabricated `signup_completed`/`subscribed`
 * events poisoning what `api/stats` and the admin funnel report, and
 * `api/cron/error-alert` — whose thresholds are 3 client errors and 50 404s in
 * 24 h — forceable into alert spam or usable to bury real alerts under noise.
 *
 * Both budgets are now consumed on every request:
 *
 *   - the anonId bucket keeps the original intent, which is sound: one NAT'd
 *     office IP should not throttle everyone behind it;
 *   - the IP bucket is the one that actually binds, because the client cannot
 *     reassign it. It is deliberately generous (5x) so a shared IP has room,
 *     and it is the SHARED (Postgres-backed) limiter, because a per-instance
 *     count of an unauthenticated write endpoint is close to meaningless.
 *
 * Either bucket tripping refuses the request.
 */
const RATE_MAX_PER_ANON = 60
const RATE_MAX_PER_IP = 300

export async function POST(req: NextRequest) {
  let body: {
    event?: string
    props?: Record<string, unknown>
    anonId?: string
    path?: string
    referrer?: string | null
    device?: string
    source?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  const event = typeof body.event === 'string' ? body.event : ''
  if (!ALLOWED.has(event)) return NextResponse.json({ error: 'unknown event' }, { status: 400 })

  // Per-IP first, and never short-circuited by the anon bucket: a caller that
  // trips the anon budget must still count against its IP budget, or rotating
  // anon ids would keep the IP bucket permanently empty — the very bypass this
  // is fixing.
  const byIp = await rateLimitShared(clientKey(req), RATE_MAX_PER_IP, RATE_WINDOW_MS)
  const anonId = typeof body.anonId === 'string' && body.anonId ? body.anonId.slice(0, 64) : null
  const byAnon = anonId
    ? rateLimit(`track:a:${anonId}`, RATE_MAX_PER_ANON, RATE_WINDOW_MS)
    : ({ ok: true } as const)
  if (!byIp.ok) return tooMany(byIp.retryAfter)
  if (!byAnon.ok) return tooMany(byAnon.retryAfter)

  const props = body.props && typeof body.props === 'object' ? { ...body.props } : {}
  // Audit item 19 F1, defence in depth. The error boundaries no longer send a
  // raw `message`, but a browser holding a cached bundle still will for as long
  // as its chunks live — and this route is the thing that makes the value
  // durable. Drop it here so the fix does not depend on every client updating.
  if (event === 'client_error' && 'message' in props) delete (props as Record<string, unknown>).message
  if (JSON.stringify(props).length > MAX_PROPS_BYTES) {
    return NextResponse.json({ error: 'props too large' }, { status: 400 })
  }

  const supabase = await createClient()
  const user = await getSessionUser(supabase)

  let isInternal = false
  if (user) {
    if (isAdmin(user)) {
      isInternal = true
    } else {
      // Service client: 0047 revokes SELECT on is_internal from both client
      // roles (it discloses which accounts are staff/seed). Scoped to user.id
      // from getSessionUser(), so this reads only the caller's own flag.
      const { data } = await createServiceClient()
        .from('profiles').select('is_internal').eq('id', user.id).single()
      isInternal = data?.is_internal ?? false
    }
  }

  const svc = createServiceClient()
  const { error } = await svc.from('analytics_events').insert({
    user_id: user?.id ?? null,
    anon_id: typeof body.anonId === 'string' ? body.anonId.slice(0, 64) : null,
    event,
    props,
    path: typeof body.path === 'string' ? body.path.slice(0, 300) : null,
    referrer: typeof body.referrer === 'string' ? body.referrer.slice(0, 300) : null,
    device: typeof body.device === 'string' ? body.device.slice(0, 16) : null,
    source: typeof body.source === 'string' ? body.source.slice(0, 64) : null,
    is_internal: isInternal,
  })
  if (error) return NextResponse.json({ error: 'write failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
