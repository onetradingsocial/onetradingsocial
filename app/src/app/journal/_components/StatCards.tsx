import type { Metrics } from '@/lib/trade'

function money(n: number) {
  const s = n >= 0 ? '+' : '−'
  return `${s}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function Card({ tone, label, icon, value, sub, subTone }: {
  tone: string; label: string; icon: string; value: string; sub: string; subTone?: 'pos' | 'neg' | 'muted'
}) {
  return (
    <div className="ts-bigcard" data-tone={tone}>
      <div className="ts-bigcard-top"><span>{label}</span><span className="ts-bigcard-icon">{icon}</span></div>
      <div className="ts-bigcard-val">{value}</div>
      <div className={`ts-bigcard-sub ${subTone ?? ''}`}>{sub}</div>
    </div>
  )
}

export function StatCards({ metrics, allTime, monthNet, monthLabel, weekTrades }: {
  metrics: Metrics; allTime: number; monthNet: number; monthLabel: string; weekTrades: number
}) {
  const pf = metrics.profitFactor
  return (
    <div className="ts-cards5">
      <Card tone="gold" label="Overall Ranking" icon="🏆" value="#—" sub="Leaderboard soon" subTone="muted" />
      <Card tone="green" label={`Total P/L · ${monthLabel.split(' ')[0]}`} icon="💳" value={money(monthNet)} sub={`All-time ${money(allTime)}`} subTone={allTime >= 0 ? 'pos' : 'neg'} />
      <Card tone="violet" label="Win Rate" icon="✓" value={`${(metrics.winRate * 100).toFixed(0)}%`} sub={`${metrics.wins}W · ${metrics.losses}L`} />
      <Card tone="sky" label="Avg R" icon="⚖" value={`${metrics.avgRr.toFixed(2)}R`} sub={Number.isFinite(pf) ? `Profit factor ${pf.toFixed(2)}` : 'Profit factor ∞'} subTone="pos" />
      <Card tone="blue" label="Total Trades" icon="▤" value={String(metrics.total)} sub={`${weekTrades} logged this week`} subTone="pos" />
    </div>
  )
}
