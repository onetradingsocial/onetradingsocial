import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import type { JTrade } from '@/lib/journal-stats'

function money(n: number, sign = false) {
  const abs = `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return n < 0 ? `−${abs}` : sign ? `+${abs}` : abs
}

const asMetric = (t: JTrade): TradeForMetrics => ({
  status: t.status as 'open' | 'closed', outcome: t.outcome as TradeForMetrics['outcome'], rMultiple: t.r_multiple,
  pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: [],
})

function Delta({ value, suffix = '', good = true }: { value: number; suffix?: string; good?: boolean }) {
  if (Math.abs(value) < 0.005) return <span className="faint" style={{ fontSize: 12 }}>flat vs last month</span>
  const up = value > 0
  const positive = good ? up : !up
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: positive ? 'var(--up-ink)' : 'var(--down-ink)' }}>
      {up ? '▲' : '▼'} {Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}{suffix} vs last month
    </span>
  )
}

export function MonthlyReportCard({ thisMonth, lastMonth, label, topInstrument, locked }: {
  thisMonth: JTrade[]; lastMonth: JTrade[]; label: string; topInstrument: string | null; locked: boolean
}) {
  // Locked cards render nothing — LockedFeatures lists them once at the page foot.
  if (locked) return null

  const tm = computeMetrics(thisMonth.map(asMetric))
  const lm = computeMetrics(lastMonth.map(asMetric))
  const dPnl = tm.netPnl - lm.netPnl
  const dTrades = tm.total - lm.total
  const dWinRate = (tm.winRate - lm.winRate) * 100

  return (
    <div className="ts-card">
      <div className="flex items-center justify-between">
        <h2 className="ts-h2">Monthly trader report</h2>
        <span className="faint" style={{ fontSize: 12 }}>{label}</span>
      </div>
      <div className="ts-cards5 mt-3">
        <div className="ts-bigcard" data-tone="blue">
          <div className="ts-bigcard-top"><span>Trades</span><span className="ts-bigcard-icon">▤</span></div>
          <div className="ts-bigcard-val">{tm.total}</div>
          <div className="ts-bigcard-sub"><Delta value={dTrades} /></div>
        </div>
        <div className="ts-bigcard" data-tone="green">
          <div className="ts-bigcard-top"><span>Net P/L</span><span className="ts-bigcard-icon">💳</span></div>
          <div className="ts-bigcard-val">{money(tm.netPnl, true)}</div>
          <div className="ts-bigcard-sub"><Delta value={dPnl} /></div>
        </div>
        <div className="ts-bigcard" data-tone="violet">
          <div className="ts-bigcard-top"><span>Win Rate</span><span className="ts-bigcard-icon">✓</span></div>
          <div className="ts-bigcard-val">{Math.round(tm.winRate * 100)}%</div>
          <div className="ts-bigcard-sub"><Delta value={dWinRate} suffix="pts" /></div>
        </div>
        <div className="ts-bigcard" data-tone="sky">
          <div className="ts-bigcard-top"><span>Avg R</span><span className="ts-bigcard-icon">⚖</span></div>
          <div className="ts-bigcard-val">{tm.avgRr.toFixed(2)}</div>
          <div className="ts-bigcard-sub faint">this month</div>
        </div>
        <div className="ts-bigcard" data-tone="gold">
          <div className="ts-bigcard-top"><span>Top instrument</span><span className="ts-bigcard-icon">★</span></div>
          <div className="ts-bigcard-val" style={{ fontSize: 20 }}>{topInstrument ?? '—'}</div>
          <div className="ts-bigcard-sub faint">most traded</div>
        </div>
      </div>
    </div>
  )
}
