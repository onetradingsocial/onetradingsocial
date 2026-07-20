'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const PERIODS = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
] as const

const SORTS = [
  { key: 'pnl', label: 'Sort: Total P/L' },
  { key: 'winRate', label: 'Sort: Win rate' },
  { key: 'avgR', label: 'Sort: Avg R:R' },
  { key: 'expectancy', label: 'Sort: Expectancy' },
  { key: 'profitFactor', label: 'Sort: Profit factor' },
  { key: 'riskAdjusted', label: 'Sort: Risk-adjusted' },
  { key: 'consistency', label: 'Sort: Consistency' },
  { key: 'trades', label: 'Sort: Trades' },
] as const

const MIN_TRADES = [
  { key: '0', label: 'Any sample' },
  { key: '10', label: 'Min 10 trades' },
  { key: '30', label: 'Min 30 trades' },
  { key: '50', label: 'Min 50 trades' },
] as const

// Verification filters: rank by evidence quality, not just results.
const VERIFY = [
  { key: 'all', label: 'Verify: All' },
  { key: 'broker', label: 'Broker-connected' },
  { key: 'statement', label: 'Statement-imported' },
  { key: 'self', label: 'Self-reported' },
  { key: 'live', label: 'Live accounts' },
  { key: 'demo', label: 'Demo accounts' },
  { key: 'prop', label: 'Prop-firm' },
] as const

export function LeaderboardControls({ period, sort, cat, verify = 'all', minTrades = '0', canAdvFilters = true }: { period: string; sort: string; cat: string; verify?: string; minTrades?: string; canAdvFilters?: boolean }) {
  const router = useRouter()
  const sp = useSearchParams()
  const push = (next: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(next)) p.set(k, v)
    router.push(`/leaderboard?${p.toString()}`)
  }
  const periods = cat === 'xp' ? PERIODS.filter((p) => p.key !== 'day') : PERIODS
  return (
    <div className="lb-filters">
      <div className="lb-segs">
        {periods.map((p) => (
          <button key={p.key} className={'lb-seg' + (period === p.key ? ' on' : '')} onClick={() => push({ period: p.key })}>{p.label}</button>
        ))}
      </div>
      {cat !== 'xp' && (
        <div className="lb-metric">
          <select value={verify} onChange={(e) => push({ verify: e.target.value })} aria-label="Verification filter">
            {VERIFY.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
          <span className="chev" aria-hidden>▾</span>
        </div>
      )}
      {cat !== 'xp' && canAdvFilters && (
        <div className="lb-metric">
          <select value={minTrades} onChange={(e) => push({ minTrades: e.target.value })} aria-label="Minimum sample size">
            {MIN_TRADES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <span className="chev" aria-hidden>▾</span>
        </div>
      )}
      {cat !== 'xp' && (canAdvFilters ? (
        <div className="lb-metric">
          <select value={sort} onChange={(e) => push({ sort: e.target.value })}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span className="chev" aria-hidden>▾</span>
        </div>
      ) : (
        <a href="/settings/billing" className="lb-metric" title="Advanced leaderboard filters are a Trader perk"
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--dim)' }}>
          🔒 Sort filters <span style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Trader</span>
        </a>
      ))}
    </div>
  )
}
