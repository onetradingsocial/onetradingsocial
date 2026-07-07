import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import type { JTrade } from '@/lib/journal-stats'
import { PrintButton } from './PrintButton'
import './report.css'

function money(n: number | null, sign = false) {
  if (n == null) return '—'
  const abs = `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return n < 0 ? `−${abs}` : sign ? `+${abs}` : abs
}

export default async function JournalReportPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const tier = await getTier(supabase, user.id)

  if (tier !== 'pro') {
    return (
      <main className="ts-page">
        <div className="ts-banner mt-5">
          Downloadable reports are a Pro perk.{' '}
          <a href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Upgrade</a>{' '}
          to generate one.
        </div>
      </main>
    )
  }

  const { data: all } = await supabase
    .from('trades')
    .select('id, instrument, market, direction, status, outcome, entry_price, exit_price, r_multiple, pnl_amount, planned_rr, setup_type, strategy_tags, traded_at')
    .eq('user_id', user.id)
    .order('traded_at', { ascending: false })

  const trades = (all ?? []) as JTrade[]
  const metrics = computeMetrics(trades.map((t): TradeForMetrics => ({
    status: t.status as 'open' | 'closed', outcome: t.outcome as TradeForMetrics['outcome'], rMultiple: t.r_multiple,
    pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: [],
  })))

  const { data: profile } = await supabase.from('profiles').select('username, display_name').eq('id', user.id).single()
  const generated = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <main>
      <div className="jr-toolbar"><PrintButton /></div>
      <div className="jr-report">
        <div className="jr-head">
          <h1>Trading journal report</h1>
          <span>{profile?.display_name ?? profile?.username} · Generated {generated}</span>
        </div>

        <div className="jr-stats">
          <div className="jr-stat"><div className="k">Total trades</div><div className="v">{metrics.total}</div></div>
          <div className="jr-stat"><div className="k">Win rate</div><div className="v">{Math.round(metrics.winRate * 100)}%</div></div>
          <div className="jr-stat"><div className="k">Net P/L</div><div className={'v ' + (metrics.netPnl >= 0 ? 'jr-up' : 'jr-down')}>{money(metrics.netPnl, true)}</div></div>
          <div className="jr-stat"><div className="k">Avg R:R</div><div className="v">{metrics.avgRr.toFixed(1)}</div></div>
          <div className="jr-stat"><div className="k">Profit factor</div><div className="v">{metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}</div></div>
        </div>

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
