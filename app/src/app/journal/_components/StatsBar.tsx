import type { Metrics } from '@/lib/trade'

function money(n: number) {
  const s = n >= 0 ? '+' : '−'
  return `${s}$${Math.abs(n).toFixed(2)}`
}

export function StatsBar({ m, currency }: { m: Metrics; currency: string }) {
  return (
    <dl className="ts-statbar">
      <div className="ts-statcard"><dt>Total trades</dt><dd>{m.total}</dd></div>
      <div className="ts-statcard"><dt>Win rate</dt><dd>{(m.winRate * 100).toFixed(0)}%</dd></div>
      <div className="ts-statcard"><dt>Net P/L ({currency})</dt><dd className={m.netPnl >= 0 ? 'ts-pos' : 'ts-neg'}>{money(m.netPnl)}</dd></div>
      <div className="ts-statcard"><dt>Avg R</dt><dd>{m.avgRr.toFixed(2)}R</dd></div>
      <div className="ts-statcard"><dt>Profit factor</dt><dd>{m.profitFactor.toFixed(2)}</dd></div>
      <div className="ts-statcard"><dt>Best trade</dt><dd className="ts-pos">{m.best.toFixed(2)}R</dd></div>
    </dl>
  )
}
