'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const PERIODS = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All-time' },
] as const
const SORTS = [
  { key: 'pnl', label: 'Total P&L' },
  { key: 'winRate', label: 'Win rate' },
  { key: 'avgR', label: 'Avg R:R' },
  { key: 'trades', label: 'Trades' },
] as const

export function LeaderboardControls({ cat, period, sort }: { cat: string; period: string; sort: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const push = (next: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(next)) p.set(k, v)
    p.set('cat', cat)
    router.push(`/leaderboard?${p.toString()}`)
  }
  return (
    <div className="ts-lbcontrols">
      {cat !== 'followed' && (
        <div className="ts-seg">
          {PERIODS.map((p) => (
            <button key={p.key} className="ts-seg-btn" data-active={period === p.key} onClick={() => push({ period: p.key })}>{p.label}</button>
          ))}
        </div>
      )}
      {cat === 'performance' && (
        <label className="ts-lbsort">
          <span className="faint">Sort</span>
          <select className="ts-select" value={sort} onChange={(e) => push({ sort: e.target.value })}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}
