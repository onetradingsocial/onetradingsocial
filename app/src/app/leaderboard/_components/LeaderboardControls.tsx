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
  { key: 'trades', label: 'Sort: Trades' },
] as const

export function LeaderboardControls({ period, sort }: { period: string; sort: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const push = (next: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(next)) p.set(k, v)
    router.push(`/leaderboard?${p.toString()}`)
  }
  return (
    <div className="lb-filters">
      <div className="lb-segs">
        {PERIODS.map((p) => (
          <button key={p.key} className={'lb-seg' + (period === p.key ? ' on' : '')} onClick={() => push({ period: p.key })}>{p.label}</button>
        ))}
      </div>
      <div className="lb-metric">
        <select value={sort} onChange={(e) => push({ sort: e.target.value })}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <span className="chev" aria-hidden>▾</span>
      </div>
    </div>
  )
}
