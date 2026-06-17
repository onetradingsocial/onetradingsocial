type Row = {
  id: string
  instrument: string
  direction: string
  status: string
  outcome: string
  entry_price: number
  exit_price: number | null
  pnl_amount: number | null
  r_multiple: number | null
  planned_rr: number | null
  setup_type: string | null
  strategy_tags: string[]
  traded_at: string
}

export function TradeRow({ t }: { t: Row }) {
  const pnl = t.pnl_amount
  const tags = [t.setup_type, ...(t.strategy_tags ?? [])].filter(Boolean) as string[]
  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>{t.instrument}</div>
        <div className="faint" style={{ fontSize: 12, textTransform: 'capitalize' }}>{t.direction}</div>
      </td>
      <td>{t.entry_price}</td>
      <td>{t.exit_price ?? '—'}</td>
      <td className={pnl == null ? '' : pnl >= 0 ? 'ts-pos' : 'ts-neg'}>
        {pnl == null ? '—' : `${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`}
      </td>
      <td>{t.r_multiple != null ? `${t.r_multiple.toFixed(2)}R` : t.planned_rr != null ? `1:${t.planned_rr.toFixed(2)}` : '—'}</td>
      <td>{tags.slice(0, 2).map((x) => <span key={x} className="ts-tag">{x}</span>)}</td>
      <td><span className={`ts-badge ts-badge--${t.status === 'open' ? 'open' : t.outcome}`}>{t.status === 'open' ? 'open' : t.outcome}</span></td>
    </tr>
  )
}
