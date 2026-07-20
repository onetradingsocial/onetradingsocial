import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { canFlag } from '@/lib/feature-flags'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import Link from 'next/link'
import { monthlyPnl, equityCurve, assetDistribution, groupBySetup, type JTrade } from '@/lib/journal-stats'
import { profileLevel, VERIFICATION_LABELS, type SourceCounts } from '@/lib/verification'
import { MonthlyPL } from '../_components/MonthlyPL'
import { EquityCurve } from '../_components/EquityCurve'
import { AssetDonut } from '../_components/AssetDonut'
import { PrintButton } from './PrintButton'
import './report.css'

export default async function JournalReportPage({ searchParams }: { searchParams: Promise<{ private?: string }> }) {
  // Privacy mode (row 23): hide currency, show R multiples / percentages only.
  const hideMoney = (await searchParams).private === '1'
  const money = (n: number | null, sign = false) => {
    if (n == null) return '—'
    if (hideMoney) return '•••'
    const abs = `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    return n < 0 ? `−${abs}` : sign ? `+${abs}` : abs
  }

  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const tier = await getTier(supabase, user.id)
  const canReport = canFlag(await getFeatureFlags(), tier, 'advanced_reporting')

  if (!canReport) {
    return (
      <main className="ts-page">
        <div className="ts-banner mt-5">
          Downloadable, advanced reports are a Pro perk.{' '}
          <a href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Upgrade</a>{' '}
          to generate one.
        </div>
      </main>
    )
  }

  const { data: all } = await supabase
    .from('trades')
    .select('id, instrument, market, direction, status, outcome, entry_price, exit_price, r_multiple, pnl_amount, planned_rr, setup_type, strategy_tags, mistake_tags, source, traded_at')
    .eq('user_id', user.id)
    .order('traded_at', { ascending: false })

  const trades = (all ?? []) as (JTrade & { mistake_tags: string[] | null; source: string | null })[]

  // Verification level for this account (row 23).
  const counts: SourceCounts = { manual: 0, statement: 0, broker: 0 }
  for (const t of trades) counts[(t.source ?? 'manual') as keyof SourceCounts]++
  const verification = VERIFICATION_LABELS[profileLevel(counts, null)]

  // Mistake summary (row 23).
  const mistakeCounts = new Map<string, number>()
  for (const t of trades) for (const m of t.mistake_tags ?? []) mistakeCounts.set(m, (mistakeCounts.get(m) ?? 0) + 1)
  const topMistakes = [...mistakeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const asMetric = (t: JTrade): TradeForMetrics => ({
    status: t.status as 'open' | 'closed', outcome: t.outcome as TradeForMetrics['outcome'], rMultiple: t.r_multiple,
    pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: [],
  })
  const metrics = computeMetrics(trades.map(asMetric))
  const closed = trades.filter((t) => t.status === 'closed')

  const year = new Date().getFullYear()
  const eq = equityCurve(closed)
  const dist = assetDistribution(trades)
  const strategyRows = Object.entries(groupBySetup(closed))
    .map(([setup, ts]) => ({ setup, m: computeMetrics(ts.map(asMetric)) }))
    .sort((a, b) => b.m.netPnl - a.m.netPnl)

  const { data: profile } = await supabase.from('profiles').select('username, display_name').eq('id', user.id).single()
  const generated = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <main>
      <div className="jr-toolbar" style={{ display: 'flex', gap: 10 }}>
        <PrintButton />
        <Link className="btn btn-sm" href={hideMoney ? '/journal/report' : '/journal/report?private=1'}>
          {hideMoney ? 'Show currency' : 'Hide currency ($)'}
        </Link>
      </div>
      <div className="jr-report">
        <div className="jr-head">
          <h1>Trading journal report</h1>
          <span>{profile?.display_name ?? profile?.username} · {verification} · Generated {generated}</span>
        </div>

        <div className="jr-stats">
          <div className="jr-stat"><div className="k">Total trades</div><div className="v">{metrics.total}</div></div>
          <div className="jr-stat"><div className="k">Win rate</div><div className="v">{Math.round(metrics.winRate * 100)}%</div></div>
          <div className="jr-stat"><div className="k">Net P/L</div><div className={'v ' + (metrics.netPnl >= 0 ? 'jr-up' : 'jr-down')}>{money(metrics.netPnl, true)}</div></div>
          <div className="jr-stat"><div className="k">Avg R:R</div><div className="v">{metrics.avgRr.toFixed(1)}</div></div>
          <div className="jr-stat"><div className="k">Profit factor</div><div className="v">{metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}</div></div>
        </div>

        <div className="jr-charts">
          <div>
            <h2 className="jr-h2">Monthly P/L · {year}</h2>
            <MonthlyPL data={monthlyPnl(closed, year)} />
          </div>
          <div>
            <h2 className="jr-h2">Equity curve</h2>
            <EquityCurve points={eq.points} final={eq.final} />
          </div>
          <div>
            <h2 className="jr-h2">Asset distribution</h2>
            <AssetDonut data={dist} total={trades.length} />
          </div>
        </div>

        <h2 className="jr-h2">Strategy breakdown</h2>
        {strategyRows.length === 0 ? (
          <p className="faint mb-4">No closed trades with a setup type yet.</p>
        ) : (
          <table className="jr-table" style={{ marginBottom: 24 }}>
            <thead>
              <tr><th>Setup</th><th>Trades</th><th>Win rate</th><th>Net P/L</th><th>Avg R</th><th>Profit factor</th></tr>
            </thead>
            <tbody>
              {strategyRows.map(({ setup, m }) => (
                <tr key={setup}>
                  <td>{setup}</td>
                  <td>{m.total}</td>
                  <td>{Math.round(m.winRate * 100)}%</td>
                  <td className={m.netPnl >= 0 ? 'jr-up' : 'jr-down'}>{money(m.netPnl, true)}</td>
                  <td>{m.avgRr.toFixed(2)}</td>
                  <td>{m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 className="jr-h2">Mistakes</h2>
        {topMistakes.length === 0 ? (
          <p className="faint mb-4">No mistakes tagged — or none logged yet.</p>
        ) : (
          <table className="jr-table" style={{ marginBottom: 24 }}>
            <thead><tr><th>Mistake</th><th>Times tagged</th></tr></thead>
            <tbody>
              {topMistakes.map(([tag, n]) => <tr key={tag}><td>{tag}</td><td>{n}</td></tr>)}
            </tbody>
          </table>
        )}

        <h2 className="jr-h2">Trade log</h2>
        <table className="jr-table">
          <thead>
            <tr>
              <th>Date</th><th>Instrument</th><th>Dir</th><th>Status</th>
              <th>Entry</th><th>Exit</th><th>R</th><th>P/L</th><th>Setup</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id}>
                <td>{t.traded_at.slice(0, 10)}</td>
                <td>{t.instrument}</td>
                <td>{t.direction}</td>
                <td>{t.status}</td>
                <td>{t.entry_price}</td>
                <td>{t.exit_price ?? '—'}</td>
                <td>{t.r_multiple != null ? `${t.r_multiple.toFixed(1)}R` : '—'}</td>
                <td className={t.pnl_amount == null ? '' : t.pnl_amount >= 0 ? 'jr-up' : 'jr-down'}>{money(t.pnl_amount, true)}</td>
                <td>{t.setup_type ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {trades.length === 0 && <p className="faint mt-4">No trades logged yet.</p>}
      </div>
    </main>
  )
}
