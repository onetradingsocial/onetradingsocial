import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export type FunnelDashboard = {
  // Core funnel counts, last 30 days, internal traffic excluded.
  funnel: { step: string; count: number }[]
  // Onboarding step reach (props.step -> count), for abandonment analysis.
  onboardingSteps: { step: number; count: number }[]
  // Lifecycle snapshot from DB truth (independent of event volume).
  lifecycle: { status: string; count: number }[]
  // Ops signals from events.
  notFound30d: number
  clientErrors30d: number
  topBrokenPaths: { path: string; count: number }[]
}

const DAY = 864e5

export async function getFunnelDashboard(svc: SupabaseClient, now = new Date()): Promise<FunnelDashboard> {
  const since = new Date(now.getTime() - 30 * DAY).toISOString()
  const d7 = new Date(now.getTime() - 7 * DAY).toISOString()
  const d30 = since

  const eventCount = async (event: string) => {
    const { count } = await svc
      .from('analytics_events')
      .select('id', { count: 'exact', head: true })
      .eq('event', event)
      .eq('is_internal', false)
      .gte('created_at', since)
    return count ?? 0
  }

  const [signups, onboarded, firstTrades, imports, reviews, checkouts, subscribed] = await Promise.all([
    eventCount('signup_completed'),
    eventCount('onboarding_completed'),
    eventCount('first_trade_logged'),
    eventCount('trade_imported'),
    eventCount('weekly_review_viewed'),
    eventCount('checkout_started'),
    eventCount('subscribed'),
  ])

  // Distinct visitors (anon ids + users) from app page views in the window.
  const { data: pv } = await svc
    .from('analytics_events')
    .select('anon_id, user_id')
    .eq('event', 'page_view')
    .eq('is_internal', false)
    .gte('created_at', since)
    .limit(20000)
  const visitors = new Set((pv ?? []).map((r) => r.user_id ?? r.anon_id).filter(Boolean)).size

  const { data: stepRows } = await svc
    .from('analytics_events')
    .select('props')
    .eq('event', 'onboarding_step')
    .eq('is_internal', false)
    .gte('created_at', since)
    .limit(20000)
  const stepCounts = new Map<number, number>()
  for (const r of stepRows ?? []) {
    const s = Number((r.props as { step?: number })?.step)
    if (Number.isFinite(s)) stepCounts.set(s, (stepCounts.get(s) ?? 0) + 1)
  }

  // Lifecycle snapshot from source-of-truth tables (excludes internal profiles).
  const { data: profs } = await svc
    .from('profiles')
    .select('id, created_at, onboarding_completed')
    .eq('is_internal', false)
  const profiles = profs ?? []
  const ids = profiles.map((p) => p.id)

  const { data: tradeRows } = await svc
    .from('trades')
    .select('user_id, created_at')
    .in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const tradesByUser = new Map<string, string[]>()
  for (const t of tradeRows ?? []) {
    const arr = tradesByUser.get(t.user_id) ?? []
    arr.push(t.created_at)
    tradesByUser.set(t.user_id, arr)
  }

  const { data: subs } = await svc
    .from('subscriptions')
    .select('user_id, status')
    .in('status', ['active', 'trialing'])
  const paidIds = new Set((subs ?? []).map((s) => s.user_id))

  let registered = 0, onboarding = 0, activated = 0, engaged = 0, retained = 0, atRisk = 0, churned = 0
  for (const p of profiles) {
    registered++
    if (!p.onboarding_completed) { onboarding++; continue }
    const trades = tradesByUser.get(p.id) ?? []
    if (trades.length === 0) continue
    activated++
    const latest = trades.reduce((m, t) => (t > m ? t : m), trades[0])
    if (latest >= d7) {
      engaged++
      if (p.created_at < d7) retained++
    } else if (latest >= d30) {
      atRisk++
    } else {
      churned++
    }
  }

  const [nf, ce] = await Promise.all([eventCount('not_found'), eventCount('client_error')])
  const { data: nfRows } = await svc
    .from('analytics_events')
    .select('props')
    .eq('event', 'not_found')
    .gte('created_at', since)
    .limit(5000)
  const pathCounts = new Map<string, number>()
  for (const r of nfRows ?? []) {
    const p = String((r.props as { broken_path?: string })?.broken_path ?? '')
    if (p) pathCounts.set(p, (pathCounts.get(p) ?? 0) + 1)
  }

  return {
    funnel: [
      { step: 'App visitors', count: visitors },
      { step: 'Signups completed', count: signups },
      { step: 'Onboarding completed', count: onboarded },
      { step: 'First trade logged', count: firstTrades },
      { step: 'Statement imports', count: imports },
      { step: 'Weekly review viewed', count: reviews },
      { step: 'Checkout started', count: checkouts },
      { step: 'Subscribed', count: subscribed },
    ],
    onboardingSteps: [...stepCounts.entries()].sort((a, b) => a[0] - b[0]).map(([step, count]) => ({ step, count })),
    lifecycle: [
      { status: 'Registered', count: registered },
      { status: 'Onboarding', count: onboarding },
      { status: 'Activated (≥1 trade)', count: activated },
      { status: 'Engaged (7d)', count: engaged },
      { status: 'Retained (7d, older accts)', count: retained },
      { status: 'At risk (8–30d idle)', count: atRisk },
      { status: 'Churned (30d+ idle)', count: churned },
      { status: 'Paid', count: paidIds.size },
    ],
    notFound30d: nf,
    clientErrors30d: ce,
    topBrokenPaths: [...pathCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([path, count]) => ({ path, count })),
  }
}
