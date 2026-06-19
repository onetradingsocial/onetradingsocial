// Money formatting for the leaderboard surfaces (e.g. +$1,972 / −$40 / $0).
export const fmtPL = (n: number) =>
  (n > 0 ? '+$' : n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString()

// Plain USD magnitude, no sign (e.g. $1,302).
export const fmtUSD = (n: number) => '$' + Math.round(Math.abs(n)).toLocaleString()
