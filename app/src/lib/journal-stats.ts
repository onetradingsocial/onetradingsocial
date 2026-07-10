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
