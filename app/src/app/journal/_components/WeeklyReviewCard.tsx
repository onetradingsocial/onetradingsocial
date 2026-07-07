import type { Metrics } from '@/lib/trade'

function money(n: number, sign = false) {
  const abs = `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return n < 0 ? `−${abs}` : sign ? `+${abs}` : abs
}

function Delta({ value, suffix = '', good = true }: { value: number; suffix?: string; good?: boolean }) {
  if (Math.abs(value) < 0.005) return <span className="faint" style={{ fontSize: 12 }}>flat vs last week</span>
  const up = value > 0
  const positive = good ? up : !up
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: positive ? 'var(--up-ink)' : 'var(--down-ink)' }}>
      {up ? '▲' : '▼'} {Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}{suffix} vs last week
    </span>
  )
}

export function WeeklyReviewCard({ thisWeek, lastWeek, best, worst, locked }: {
  thisWeek: Metrics; lastWeek: Metrics; best: number | null; worst: number | null; locked: boolean
}) {
  if (locked) {
    return (
      <div className="ts-card">
        <h2 className="ts-h2">Weekly performance review</h2>
        <p className="ts-sub mt-2">
          Trader+ perk: a week-over-week recap of your trades, P/L, win rate, and best/worst trade.{' '}
          <a href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Upgrade</a> to unlock it.
        </p>
      </div>
    )
  }

  const dPnl = thisWeek.netPnl - lastWeek.netPnl
  const dTrades = thisWeek.total - lastWeek.total
  const dWinRate = (thisWeek.winRate - lastWeek.winRate) * 100

  return (
    <div className="ts-card">
      <div className="flex items-center justify-between">
        <h2 className="ts-h2">Weekly performance review</h2>
        <span className="faint" style={{ fontSize: 12 }}>Last 7 days vs the 7 before</span>
      </div>
      <div className="ts-cards5 mt-3">
        <div className="ts-bigcard" data-tone="blue">
          <div className="ts-bigcard-top"><span>Trades</span><span className="ts-bigcard-icon">▤</span></div>
          <div className="ts-bigcard-val">{thisWeek.total}</div>
          <div className="ts-bigcard-sub"><Delta value={dTrades} /></div>
        </div>
        <div className="ts-bigcard" data-tone="green">
          <div className="ts-bigcard-top"><span>Net P/L</span><span className="ts-bigcard-icon">💳</span></div>
          <div className="ts-bigcard-val">{money(thisWeek.netPnl, true)}</div>
          <div className="ts-bigcard-sub"><Delta value={dPnl} /></div>
        </div>
        <div className="ts-bigcard" data-tone="violet">
          <div className="ts-bigcard-top"><span>Win Rate</span><span className="ts-bigcard-icon">✓</span></div>
          <div className="ts-bigcard-val">{Math.round(thisWeek.winRate * 100)}%</div>
          <div className="ts-bigcard-sub"><Delta value={dWinRate} suffix="pts" /></div>
        </div>
        <div className="ts-bigcard" data-tone="gold">
          <div className="ts-bigcard-top"><span>Best trade</span><span className="ts-bigcard-icon">🏆</span></div>
          <div className="ts-bigcard-val">{best != null ? money(best, true) : '—'}</div>
          <div className="ts-bigcard-sub faint">this week</div>
        </div>
        <div className="ts-bigcard" data-tone="sky">
          <div className="ts-bigcard-top"><span>Worst trade</span><span className="ts-bigcard-icon">⚠</span></div>
          <div className="ts-bigcard-val">{worst != null ? money(worst, true) : '—'}</div>
          <div className="ts-bigcard-sub faint">this week</div>
        </div>
      </div>
    </div>
  )
}
