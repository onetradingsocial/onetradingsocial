import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export type FunnelDashboard = {
  // Core funnel counts, last 30 days, internal traffic excluded.
  funnel: { step: string; count: number }[]
  // Onboarding step reach (props.step -> count), for abandonment analysis.
  onboardingSteps: { step: number; count: number }[]
  // Lifecycle snapshot from DB truth (independent of event volume).
  lifecycle: { status: string; count: number }[]
  // Signups per campaign/ref code (row 40).
  sources: { source: string; count: number }[]
  // Feature adoption: % of activated users touching each feature (row 48).
  adoption: { feature: string; users: number; pct: number }[]
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
    .select('id, created_at, onboarding_completed, acquisition_source')
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

  // Signups by campaign / ref code.
  const srcCounts = new Map<string, number>()
  for (const p of profiles) {
    const s = (p as { acquisition_source?: string | null }).acquisition_source || '(direct/unknown)'
    srcCounts.set(s, (srcCounts.get(s) ?? 0) + 1)
  }

  // Feature adoption among activated users (≥1 trade). Table presence beats
  // event volume for features that predate event tracking.
  const activatedIds = profiles.filter((p) => (tradesByUser.get(p.id) ?? []).length > 0).map((p) => p.id)
  const activatedSet = new Set(activatedIds)
  const denom = Math.max(1, activatedIds.length)
  const countUsers = async (table: string, col: string) => {
    const { data } = await svc.from(table).select(col).limit(20000)
    const rows = (data ?? []) as unknown as Record<string, string>[]
    return new Set(rows.map((r) => r[col]).filter((id) => activatedSet.has(id))).size
  }
  const [brokerUsers, learnUsers, postUsers, msgUsers, noteRows, mistakeRows, reviewRows] = await Promise.all([
    countUsers('broker_accounts', 'user_id'),
    countUsers('lesson_completions', 'user_id'),
    countUsers('posts', 'author_id'),
    countUsers('messages', 'sender_id'),
    svc.from('trades').select('user_id').not('note', 'is', null).limit(20000),
    svc.from('trades').select('user_id').neq('mistake_tags', '{}').limit(20000),
    svc.from('analytics_events').select('user_id').eq('event', 'weekly_review_viewed').limit(20000),
  ])
  const distinctIn = (rows: { user_id: string | null }[] | null) =>
    new Set((rows ?? []).map((r) => r.user_id).filter((id): id is string => !!id && activatedSet.has(id))).size
  const adoption = [
    { feature: 'Journal (≥1 trade)', users: activatedIds.length, pct: 100 },
    { feature: 'Broker connection', users: brokerUsers, pct: Math.round((brokerUsers / denom) * 100) },
    { feature: 'Weekly review', users: distinctIn(reviewRows.data), pct: Math.round((distinctIn(reviewRows.data) / denom) * 100) },
    { feature: 'Learning', users: learnUsers, pct: Math.round((learnUsers / denom) * 100) },
    { feature: 'Feed posts', users: postUsers, pct: Math.round((postUsers / denom) * 100) },
    { feature: 'Messages', users: msgUsers, pct: Math.round((msgUsers / denom) * 100) },
    { feature: 'Trade notes', users: distinctIn(noteRows.data), pct: Math.round((distinctIn(noteRows.data) / denom) * 100) },
    { feature: 'Mistake tags', users: distinctIn(mistakeRows.data), pct: Math.round((distinctIn(mistakeRows.data) / denom) * 100) },
  ]

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
    sources: [...srcCounts.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count })),
    adoption,
    notFound30d: nf,
    clientErrors30d: ce,
    topBrokenPaths: [...pathCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([path, count]) => ({ path, count })),
  }
}
