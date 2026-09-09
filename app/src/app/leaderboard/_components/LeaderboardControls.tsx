'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { PERF_SORTS, PERF_SORT_LABEL, MIN_RANKED_TRADES, DEFAULT_PERF_SORT } from '@/lib/leaderboard'

const PERIODS = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
] as const

// Both lists come from lib/leaderboard so the labels the page uses to say
// "ranked by X" and "you asked for Y" are literally the same strings as the
// options in this select. Importing the other way round — a Server Component
// reading a value out of this 'use client' module — is the crash described in
// CLAUDE.md, so the shared constants live in the plain module.
const SORTS = PERF_SORTS.map((key) => ({ key, label: `Sort: ${PERF_SORT_LABEL[key]}` }))

// "Any sample" is gone: it let one lucky trade hold rank 1. MIN_RANKED_TRADES
// is the floor, not an option, so the loosest choice offered IS the floor.
const MIN_TRADES = [
  { key: String(MIN_RANKED_TRADES), label: `Min ${MIN_RANKED_TRADES} trades` },
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

export function LeaderboardControls({ period, sort, cat, verify = 'all', minTrades = String(MIN_RANKED_TRADES), canAdvFilters = true }: { period: string; sort: string; cat: string; verify?: string; minTrades?: string; canAdvFilters?: boolean }) {
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
        // The locked control names the sort that IS in force rather than only
        // the perk that is missing, so a viewer who cannot change it can still
        // read what the board in front of them was ordered by.
        <Link href="/settings/billing" className="lb-metric"
          title={`Sorting by anything other than ${PERF_SORT_LABEL[DEFAULT_PERF_SORT]} is a Trader feature`}
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--dim)' }}>
          🔒 Sort: {PERF_SORT_LABEL[DEFAULT_PERF_SORT]} <span style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Trader</span>
        </Link>
      ))}
    </div>
  )
}
