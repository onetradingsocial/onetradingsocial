import type { Metrics } from '@/lib/trade'
import { MiniSpark } from './MiniSpark'

function money(n: number) {
  const s = n >= 0 ? '+' : '−'
  return `${s}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function PerformanceRow({ metrics, spark }: { metrics: Metrics; spark: number[] }) {
  const pnlColor = metrics.netPnl >= 0 ? 'var(--up)' : 'var(--down)'
  const cards = [
    { label: 'Rank', value: '#—', tone: 'gold', spark: [] as number[], color: 'var(--xp)' },
    { label: 'Net P/L', value: money(metrics.netPnl), tone: 'green', spark, color: pnlColor },
    { label: 'Win rate', value: `${(metrics.winRate * 100).toFixed(0)}%`, tone: 'violet', spark: [] as number[], color: 'var(--violet)' },
    { label: 'Avg R', value: `${metrics.avgRr.toFixed(2)}R`, tone: 'sky', spark: [] as number[], color: 'var(--c-cyan)' },
    { label: 'Total trades', value: String(metrics.total), tone: 'blue', spark: [] as number[], color: 'var(--violet-deep)' },
  ]
  return (
    <div className="ts-card">
      <div className="flex items-center justify-between">
        <h2 className="ts-h2">Your performance</h2>
        <a href="/app/journal" className="ts-link-sm">Open journal →</a>
      </div>
      <div className="ts-perfrow mt-3">
        {cards.map((c) => (
          <div key={c.label} className="ts-perfcard" data-tone={c.tone}>
            <div className="l">{c.label}</div>
            <div className="v">{c.value}</div>
            <div className="sp">{c.spark.length > 1 ? <MiniSpark points={c.spark} color={c.color} /> : <div className="ts-mspark-empty" />}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
