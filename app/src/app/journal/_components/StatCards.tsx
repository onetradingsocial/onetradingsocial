import type { ReactNode } from 'react'
import type { Metrics } from '@/lib/trade'
import { profitFactorTone } from '@/lib/journal-stats'
import Link from 'next/link'

function money(n: number) {
  const s = n >= 0 ? '+' : '−'
  return `${s}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function Card({ tone, label, icon, value, sub, subTone, foot }: {
  tone: string; label: string; icon: string; value: ReactNode; sub: string
  subTone?: 'pos' | 'neg' | 'muted'
  /** Date range, denominator and exclusions for the value above. Not optional
   *  in spirit — every figure on this row states the population it came from. */
  foot?: string
}) {
  return (
    <div className="ts-bigcard" data-tone={tone}>
      <div className="ts-bigcard-top"><span>{label}</span><span className="ts-bigcard-icon">{icon}</span></div>
      <div className="ts-bigcard-val">{value}</div>
      <div className={`ts-bigcard-sub ${subTone ?? ''}`}>{sub}</div>
      {foot && <div className="ts-bigcard-foot">{foot}</div>}
    </div>
  )
}

const lockedTile = <Link href="/settings/billing" className="ts-stat-locked">🔒 Trader</Link>

/**
 * Two of these tiles carry a count of "trades" and they count different things:
 * `metrics.total` is closed-only, while the asset donut beside them counts all
 * trades including open. The tile is therefore labelled "Closed Trades" and the
 * donut is labelled "ALL TRADES" — neither says the bare word on its own.
 */
export function StatCards({ metrics, allTime, monthNet, monthLabel, weekTrades, advanced = true }: {
  metrics: Metrics; allTime: number; monthNet: number; monthLabel: string; weekTrades: number; advanced?: boolean
}) {
  const pf = metrics.profitFactor
  const pfText = Number.isFinite(pf) ? pf.toFixed(2) : '∞'
  return (
    <div className="ts-cards5">
      <Card tone="gold" label="Overall Ranking" icon="🏆" value="#—" sub="Leaderboard soon" subTone="muted" />
      <Card
        tone="green" label={`Total P/L · ${monthLabel.split(' ')[0]}`} icon="💳"
        value={money(monthNet)} sub={`All-time ${money(allTime)}`}
        subTone={allTime >= 0 ? 'pos' : 'neg'}
        foot={`${monthLabel} to date · closed trades · realised money`}
      />
      <Card
        tone="violet" label="Win Rate" icon="✓"
        value={advanced ? `${(metrics.winRate * 100).toFixed(0)}%` : lockedTile}
        sub={`${metrics.wins}W · ${metrics.losses}L of ${metrics.total} closed`}
        foot={`All time · closed trades only · by outcome, n=${metrics.total}`}
      />
      <Card
        tone="sky" label="Avg R" icon="⚖"
        value={advanced ? `${metrics.avgRr.toFixed(2)}R` : lockedTile}
        sub={advanced ? `Profit factor ${pfText} (R)` : 'Trader only'}
        subTone={advanced ? profitFactorTone(pf, metrics.rCount) : 'muted'}
        // The R figures are R-weighted, so on an account whose risk per trade
        // varies they can disagree in sign with the money net above. That is
        // arithmetic, not a bug, and saying so here is cheaper than a support
        // thread about it.
        foot={`All time · ${metrics.rCount} R-scored closed trades · R-weighted, not money-weighted`}
      />
      <Card
        tone="blue" label="Closed Trades" icon="▤"
        value={String(metrics.total)}
        // `periodSums` windows the CLOSED list on `traded_at`, the only date a
        // trade carries — there is no closed-at column. So this is not "closed
        // in the last 7 days": a position opened three weeks ago and closed
        // yesterday is not in it. It is closed trades whose trade date falls in
        // the window, and the caption says exactly that rather than implying a
        // close-date filter the schema cannot support.
        sub={`${weekTrades} closed · trade date in last 7 days`}
        subTone="muted"
        foot={`All time · closed only · ${metrics.open} open not counted`}
      />
    </div>
  )
}
