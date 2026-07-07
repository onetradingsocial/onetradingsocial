import type { JTrade } from '@/lib/journal-stats'

const COLUMNS = [
  'Date', 'Instrument', 'Market', 'Direction', 'Status', 'Outcome',
  'Entry', 'Exit', 'R Multiple', 'PnL', 'Planned RR', 'Setup', 'Tags',
] as const

function csvCell(v: string | number | null): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function tradesToCsv(trades: JTrade[]): string {
  const rows = trades.map((t) => [
    t.traded_at.slice(0, 10), t.instrument, t.market, t.direction, t.status, t.outcome,
    t.entry_price, t.exit_price, t.r_multiple, t.pnl_amount, t.planned_rr,
    t.setup_type ?? '', t.strategy_tags.join('; '),
  ])
  return [COLUMNS, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}
