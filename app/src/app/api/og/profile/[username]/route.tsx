import { ImageResponse } from 'next/og'
import { createServiceClient } from '@/lib/supabase/service'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { profileLevel, VERIFICATION_LABELS, type SourceCounts } from '@/lib/verification'

export const runtime = 'nodejs'
const size = { width: 1200, height: 630 }

/**
 * Cache headers. Audit item 10 finding 4 -- this route was uncached and
 * unthrottled, and it is the expensive one: two queries plus a Satori layout
 * and a PNG encode on every hit, with no session to rate-limit against.
 *
 * Caching is the right control here rather than a limiter. The callers are
 * social scrapers (Slack, Discord, X, Facebook, LinkedIn) which refetch the
 * same handful of URLs repeatedly, so a shared cache absorbs almost all of it
 * -- whereas a limiter would add a database round trip to the very route we
 * are trying to make cheap, and would throttle a genuinely viral profile.
 *
 * s-maxage is what matters: it is the CDN, not the browser, that sits in front
 * of the scrapers. stale-while-revalidate means a popular card is never
 * rendered on the critical path once it is warm -- the stale copy is served and
 * the refresh happens behind it.
 *
 * The miss case is cached too, and deliberately for a much shorter window: a
 * profile that is private, unfinished or simply does not exist returns the
 * generic card, and that answer stops being true the moment somebody finishes
 * onboarding or flips to public. Five minutes bounds how long a new profile
 * shows the fallback, while still absorbing a flood of requests for names that
 * do not exist -- which is the actual abuse shape for an unauthenticated route
 * keyed by an arbitrary string.
 */
const CACHE_HIT = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
const CACHE_MISS = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'

/**
 * Branded share/OG card for a public profile (Sprint 4, rows 37 + 38).
 * Verified performance, TradingSocial branding, no raw currency — R and % only.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const svc = createServiceClient()

  const { data: profile } = await svc
    .from('profiles')
    .select('id, username, display_name, is_public, onboarding_completed')
    .eq('username', username).maybeSingle()

  const bg = '#0b0e14'
  if (!profile || !profile.is_public || !profile.onboarding_completed) {
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, color: '#fff', fontSize: 48 }}>
          TradingSocial
        </div>
      ), { ...size, headers: { 'Cache-Control': CACHE_MISS } },
    )
  }

  const { data: trades } = await svc
    .from('trades').select('r_multiple, pnl_amount, outcome, status, traded_at, source')
    .eq('user_id', profile.id).eq('is_public', true).eq('status', 'closed')
  const rows = trades ?? []

  const metrics = computeMetrics(rows.map((t): TradeForMetrics => ({
    status: 'closed', outcome: t.outcome as TradeForMetrics['outcome'], rMultiple: t.r_multiple,
    pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: [],
  })))
  const counts: SourceCounts = { manual: 0, statement: 0, broker: 0 }
  for (const t of rows) counts[(t.source ?? 'manual') as keyof SourceCounts]++
  const level = profileLevel(counts, null)
  const name = profile.display_name || profile.username

  const stat = (label: string, value: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 52, fontWeight: 700, color: '#fff' }}>{value}</div>
      <div style={{ fontSize: 24, color: '#8b8799' }}>{label}</div>
    </div>
  )

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: bg, padding: 64, color: '#fff', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 44, fontWeight: 700 }}>{name}</div>
            <div style={{ fontSize: 26, color: '#8b8799' }}>{`@${profile.username}`}</div>
          </div>
          <div style={{ fontSize: 24, padding: '10px 20px', borderRadius: 999, background: 'rgba(124,92,230,0.2)', border: '2px solid #7C5CE6', color: '#c9b8ff' }}>
            {VERIFICATION_LABELS[level]}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 72 }}>
          {stat('Avg R', `${metrics.avgRr >= 0 ? '+' : ''}${metrics.avgRr.toFixed(2)}R`)}
          {stat('Win rate', `${Math.round(metrics.winRate * 100)}%`)}
          {stat('Profit factor', metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2))}
          {stat('Trades', String(metrics.total))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 30, fontWeight: 700, background: 'linear-gradient(90deg,#3FB6E8,#7C5CE6,#C840BC,#FF7A4D)', backgroundClip: 'text', color: 'transparent' }}>
            TradingSocial
          </div>
          <div style={{ fontSize: 24, color: '#8b8799' }}>Track. Prove. Improve.</div>
        </div>
      </div>
    ), { ...size, headers: { 'Cache-Control': CACHE_HIT } },
  )
}
