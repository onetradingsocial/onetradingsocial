export type RiskTrade = {
  risk_percent: number | null
  risk_amount: number | null
  planned_rr: number | null
  r_multiple: number | null
  status: string
}

function money(n: number) {
  return `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

/** Risk discipline threshold — flagging trades that risked more than 2% of account. */
const RISK_LIMIT_PCT = 2

export function RiskTrackingCard({ trades, locked }: { trades: RiskTrade[]; locked: boolean }) {
  // Locked cards render nothing — LockedFeatures lists them once at the page foot.
  if (locked) return null

  const withPct = trades.filter((t) => t.risk_percent != null)
  const withAmt = trades.filter((t) => t.risk_amount != null && t.risk_amount > 0)
  const avgPct = withPct.length ? withPct.reduce((a, t) => a + (t.risk_percent as number), 0) / withPct.length : null
  const maxPct = withPct.length ? Math.max(...withPct.map((t) => t.risk_percent as number)) : null
  const avgAmt = withAmt.length ? withAmt.reduce((a, t) => a + (t.risk_amount as number), 0) / withAmt.length : null
  const overRisk = withPct.filter((t) => (t.risk_percent as number) > RISK_LIMIT_PCT).length
  const withRr = trades.filter((t) => t.planned_rr != null)
  const avgPlannedRr = withRr.length ? withRr.reduce((a, t) => a + (t.planned_rr as number), 0) / withRr.length : null

  const stats = [
    { k: 'Avg risk / trade', v: avgPct != null ? `${avgPct.toFixed(1)}%` : '—' },
    { k: 'Largest risk', v: maxPct != null ? `${maxPct.toFixed(1)}%` : '—' },
    { k: 'Avg risk in money', v: avgAmt != null ? money(avgAmt) : '—' },
    { k: 'Avg planned R:R', v: avgPlannedRr != null ? `1:${avgPlannedRr.toFixed(1)}` : '—' },
    { k: `Over ${RISK_LIMIT_PCT}% risk`, v: String(overRisk), warn: overRisk > 0 },
  ]

  return (
    <div className="ts-card">
      <div className="flex items-center justify-between">
        <h2 className="ts-h2">Risk management</h2>
        <span className="faint" style={{ fontSize: 12 }}>{withPct.length} sized by risk %</span>
      </div>
      {trades.length === 0 ? (
        <p className="faint mt-3">Log trades to see your risk profile.</p>
      ) : (
        <dl className="ts-statbar mt-3">
          {stats.map((s) => (
            <div key={s.k} className="ts-statcard">
              <dt>{s.k}</dt>
              <dd className={s.warn ? 'ts-neg' : undefined}>{s.v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
