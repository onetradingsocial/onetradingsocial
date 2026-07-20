import { NextRequest, NextResponse } from 'next/server'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isAdmin } from '@/lib/server/admin'
import { rateLimit, clientKey, tooMany } from '@/lib/server/rate-limit'

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
const RATE_MAX = 60

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

  // Prefer the client's anon id so one shared NAT'd IP can't throttle everyone.
  const rlKey = typeof body.anonId === 'string' && body.anonId ? `a:${body.anonId}` : clientKey(req)
  const rl = rateLimit(rlKey, RATE_MAX, RATE_WINDOW_MS)
  if (!rl.ok) return tooMany(rl.retryAfter)

  const props = body.props && typeof body.props === 'object' ? body.props : {}
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
      const { data } = await supabase.from('profiles').select('is_internal').eq('id', user.id).single()
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
