import type { PerfSort } from '@/lib/leaderboard'

// Money formatting for the leaderboard surfaces (e.g. +$1,972 / −$40 / $0).
export const fmtPL = (n: number) =>
  (n > 0 ? '+$' : n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString()

// Plain USD magnitude, no sign (e.g. $1,302).
export const fmtUSD = (n: number) => '$' + Math.round(Math.abs(n)).toLocaleString()

// One ranked metric in its own units, for the surfaces that have to show the
// number the board was actually ordered by. Only the money branch formats a
// locale-dependent string (and only by reusing fmtPL, which the table and
// podium already render); the rest are toFixed so they are identical on the
// server and in the browser.
export function fmtMetric(sort: PerfSort, v: number): string {
  switch (sort) {
    case 'pnl': return fmtPL(v)
    case 'winRate': return Math.round(v * 100) + '%'
    case 'consistency': return Math.round(v * 100) + '%'
    case 'avgR':
    case 'expectancy': return v.toFixed(2) + 'R'
    case 'profitFactor': return v === Infinity ? '∞' : v.toFixed(2)
    case 'riskAdjusted': return v.toFixed(2)
    case 'trades': return String(Math.round(v))
  }
}
