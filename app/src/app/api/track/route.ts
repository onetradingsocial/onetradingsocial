import { NextRequest, NextResponse } from 'next/server'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isAdmin } from '@/lib/server/admin'

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

// Naive per-instance rate limit (security hardening, row 52): 60 events/min
// per client. Serverless instances reset this map on cold start — good enough
// to blunt runaway loops and casual abuse without external infra.
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 60
const hits = new Map<string, { count: number; start: number }>()

function rateLimited(key: string): boolean {
  const now = Date.now()
  const h = hits.get(key)
  if (!h || now - h.start > RATE_WINDOW_MS) {
    hits.set(key, { count: 1, start: now })
    if (hits.size > 5000) hits.clear() // cap memory on long-lived instances
    return false
  }
  h.count += 1
  return h.count > RATE_MAX
}

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

  const rlKey = (typeof body.anonId === 'string' && body.anonId) ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (rateLimited(rlKey)) return NextResponse.json({ error: 'rate limited' }, { status: 429 })

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
