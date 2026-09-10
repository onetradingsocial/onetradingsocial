export type JTrade = {
  id: string
  instrument: string
  market: string
  direction: string
  status: string
  outcome: string
  entry_price: number
  exit_price: number | null
  r_multiple: number | null
  pnl_amount: number | null
  planned_rr: number | null
  setup_type: string | null
  strategy_tags: string[]
  traded_at: string
  source?: 'manual' | 'statement' | 'broker' | null
  // Edit-modal fields. Optional because the same type backs the public profile
  // query (`/[username]/page.tsx`), which selects a narrower column list and
  // must not start shipping a stranger's journal fields to satisfy a type.
  stop_price?: number | null
  target_price?: number | null
  sizing_mode?: string | null
  risk_percent?: number | null
  lots?: number | null
  confidence?: string | null
  emotion?: string | null
  note?: string | null
  is_public?: boolean | null
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const isClosed = (t: JTrade) => t.status === 'closed' && t.pnl_amount != null

export function monthlyPnl(closed: JTrade[], year: number) {
  const out = MONTHS.map((label) => ({ label, pnl: 0 }))
  for (const t of closed) {
    const d = new Date(t.traded_at)
    if (d.getFullYear() === year) out[d.getMonth()].pnl += t.pnl_amount ?? 0
  }
  return out
}

export function equityCurve(closed: JTrade[]) {
  const sorted = [...closed].sort((a, b) => a.traded_at.localeCompare(b.traded_at))
  let eq = 0
  const pts = sorted.map((t) => { eq += t.pnl_amount ?? 0; return eq })
  return { points: pts, final: eq }
}

export function assetDistribution(trades: JTrade[]) {
  const counts: Record<string, number> = {}
  for (const t of trades) counts[t.market] = (counts[t.market] ?? 0) + 1
  const total = trades.length || 1
  return Object.entries(counts)
    .map(([market, count]) => ({ market, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count)
}

/**
 * The Recent Trades segmented filter, as a pure predicate.
 *
 * It lives here rather than inline in the component so the table's row count
 * and the footer's net are derived from ONE definition of "shown". They were
 * two: `shown.length` came from this predicate and the net came from
 * `periodSums().monthNet`, a current-calendar-month figure that no filter
 * touched. Selecting "Losses" changed the count and left the net alone.
 */
export function matchesTradeFilter(t: JTrade, key: string): boolean {
  if (key === 'all') return true
  // outcome, not r_multiple: stop-less trades close with a win/loss and no R.
  if (key === 'wins') return t.status === 'closed' && t.outcome === 'win'
  if (key === 'losses') return t.status === 'closed' && t.outcome === 'loss'
  return t.market === key
}

/**
 * Net realised money over a set of rows, with the exclusions it depends on.
 *
 * `counted` is the population the net is actually over; `excluded` is every row
 * on screen that contributes nothing (open, or closed without a P/L because the
 * account has no balance set). Returning both is the point — a net printed
 * beside a row count that is larger than its own denominator is the defect.
 */
export function netOfTrades(trades: JTrade[]): { net: number; counted: number; excluded: number } {
  let net = 0, counted = 0, excluded = 0
  for (const t of trades) {
    if (t.status === 'closed' && t.pnl_amount != null) { net += t.pnl_amount; counted++ }
    else excluded++
  }
  return { net, counted, excluded }
}

/**
 * Tone for a profit-factor readout.
 *
 * The journal's stat card hard-coded `subTone="pos"`, so a profit factor of
 * 0.54 — losing 1R for every 0.54R won — rendered in the same green as a 2.10.
 * Break-even is 1, so that is where the sign flips, with a dead band either
 * side because 0.99 and 1.01 are the same result and neither earns a colour.
 *
 * `Infinity` is winning R trades with no losing ones. `rCount === 0` is no
 * R-bearing trades at all — an absence, not a loss, and it must not go red.
 * (`computeMetrics` returns profitFactor 0 in exactly that case, which is the
 * value a naive `pf < 1` test would paint as the worst possible result.)
 */
export function profitFactorTone(pf: number, rCount: number): 'pos' | 'neg' | 'muted' {
  if (rCount === 0) return 'muted'
  if (!Number.isFinite(pf)) return 'pos'
  if (pf > 1.01) return 'pos'
  if (pf < 0.99) return 'neg'
  return 'muted'
}

export type CalCell = { day: number; inMonth: boolean; pnl: number; count: number }

export function calendarCells(trades: JTrade[], year: number, month: number): CalCell[] {
  const first = new Date(year, month, 1)
  const startDow = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const prevDays = new Date(year, month, 0).getDate()

  const byDay: Record<number, { pnl: number; count: number }> = {}
  for (const t of trades) {
    const d = new Date(t.traded_at)
    if (d.getFullYear() === year && d.getMonth() === month) {
      byDay[d.getDate()] = byDay[d.getDate()] || { pnl: 0, count: 0 }
      byDay[d.getDate()].pnl += t.pnl_amount ?? 0
      byDay[d.getDate()].count += 1
    }
  }

  const cells: CalCell[] = []
  for (let i = startDow - 1; i >= 0; i--) cells.push({ day: prevDays - i, inMonth: false, pnl: 0, count: 0 })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, inMonth: true, pnl: byDay[d]?.pnl ?? 0, count: byDay[d]?.count ?? 0 })
  let nd = 1
  while (cells.length < 42) cells.push({ day: nd++, inMonth: false, pnl: 0, count: 0 })
  return cells
}

export function periodSums(closed: JTrade[], year: number, month: number) {
  let allTime = 0, monthNet = 0, monthTrades = 0
  const weekAgo = Date.now() - 7 * 864e5
  let weekTrades = 0
  for (const t of closed) {
    allTime += t.pnl_amount ?? 0
    const d = new Date(t.traded_at)
    if (d.getFullYear() === year && d.getMonth() === month) { monthNet += t.pnl_amount ?? 0; monthTrades++ }
    if (d.getTime() >= weekAgo) weekTrades++
  }
  return { allTime, monthNet, monthTrades, weekTrades, closedCount: closed.filter(isClosed).length }
}

/** Rolling 7-day window, weeksAgo=0 is the last 7 days, weeksAgo=1 the 7 days before that. */
export function weekSlice(trades: JTrade[], weeksAgo: number): JTrade[] {
  const end = Date.now() - weeksAgo * 7 * 864e5
  const start = end - 7 * 864e5
  return trades.filter((t) => { const ms = Date.parse(t.traded_at); return ms >= start && ms < end })
}

/** Trades in a given calendar month. monthsAgo=0 is the current month, 1 the prior month. */
export function monthSlice(trades: JTrade[], monthsAgo: number): JTrade[] {
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1)
  const y = target.getFullYear(), m = target.getMonth()
  return trades.filter((t) => { const d = new Date(t.traded_at); return d.getFullYear() === y && d.getMonth() === m })
}

/** Label like "July 2026" for monthsAgo back from now. */
export function monthLabel(monthsAgo: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1)
  return `${['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()]} ${d.getFullYear()}`
}

/** Groups closed trades by setup_type ("Other" when unset), sorted by net P/L desc. */
export function groupBySetup(closed: JTrade[]): Record<string, JTrade[]> {
  const groups: Record<string, JTrade[]> = {}
  for (const t of closed) {
    const key = t.setup_type?.trim() || 'Other'
    groups[key] = groups[key] || []
    groups[key].push(t)
  }
  return groups
}

const MARKET_COLORS: Record<string, string> = {
  crypto: '#7C5CE6', stocks: '#3FB6E8', forex: '#C840BC', indices: '#FF7A4D', commodities: '#E08A1E',
}
export function marketColor(market: string) {
  return MARKET_COLORS[market] ?? '#8B8799'
}

export function instrumentBadge(symbol: string) {
  const base = symbol.split('/')[0]?.replace(/[^A-Za-z0-9]/g, '') ?? symbol
  return base.slice(0, 3).toUpperCase()
}
