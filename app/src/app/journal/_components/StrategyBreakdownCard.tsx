import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { groupBySetup, type JTrade } from '@/lib/journal-stats'

function money(n: number, sign = false) {
  const abs = `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return n < 0 ? `−${abs}` : sign ? `+${abs}` : abs
}

const asMetric = (t: JTrade): TradeForMetrics => ({
  status: t.status as 'open' | 'closed', outcome: t.outcome as TradeForMetrics['outcome'], rMultiple: t.r_multiple,
  pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: [],
})

export function StrategyBreakdownCard({ closed, locked }: { closed: JTrade[]; locked: boolean }) {
  if (locked) {
    return (
      <div className="ts-card">
        <h2 className="ts-h2">Strategy performance breakdown</h2>
        <p className="ts-sub mt-2">
          Pro perk: win rate, net P/L, and profit factor broken down by setup/strategy tag.{' '}
          <a href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Upgrade</a> to unlock it.
        </p>
      </div>
    )
  }

  const rows = Object.entries(groupBySetup(closed))
    .map(([setup, trades]) => ({ setup, m: computeMetrics(trades.map(asMetric)) }))
    .sort((a, b) => b.m.netPnl - a.m.netPnl)

  return (
    <div className="ts-card">
      <h2 className="ts-h2">Strategy performance breakdown</h2>
      {rows.length === 0 ? (
        <p className="faint mt-3">Log closed trades with a setup type to see this breakdown.</p>
      ) : (
        <table className="ts-table mt-3">
          <thead>
            <tr><th>Setup</th><th>Trades</th><th>Win rate</th><th>Net P/L</th><th>Avg R</th><th>Profit factor</th></tr>
          </thead>
          <tbody>
            {rows.map(({ setup, m }) => (
              <tr key={setup}>
                <td>{setup}</td>
                <td>{m.total}</td>
                <td>{Math.round(m.winRate * 100)}%</td>
                <td className={m.netPnl >= 0 ? 'ts-pos' : 'ts-neg'}>{money(m.netPnl, true)}</td>
                <td>{m.avgRr.toFixed(2)}</td>
                <td>{m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
