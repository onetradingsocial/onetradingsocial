'use client'

import { useState } from 'react'
import { CloseTradeModal } from './CloseTradeModal'
import { marketColor, instrumentBadge, type JTrade } from '@/lib/journal-stats'

const FILTERS = [['all', 'All'], ['wins', 'Wins'], ['losses', 'Losses'], ['crypto', 'Crypto'], ['forex', 'Forex'], ['stocks', 'Stocks']] as const

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function RecentTrades({ trades, monthNet }: { trades: JTrade[]; monthNet: number }) {
  const [f, setF] = useState<string>('all')
  const shown = trades.filter((t) => {
    if (f === 'all') return true
    if (f === 'wins') return t.status === 'closed' && (t.r_multiple ?? 0) > 0
    if (f === 'losses') return t.status === 'closed' && (t.r_multiple ?? 0) < 0
    return t.market === f
  })

  return (
    <div className="ts-card">
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h2 className="ts-h2">Recent Trades</h2>
        <div className="ts-segfilter">
          {FILTERS.map(([k, l]) => <button key={k} type="button" data-active={f === k} onClick={() => setF(k)}>{l}</button>)}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="faint" style={{ padding: '28px 0', textAlign: 'center' }}>No trades to show.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="ts-table ts-table--rich mt-3">
            <thead><tr><th>Date</th><th>Instrument</th><th>Side</th><th>Entry</th><th>Exit</th><th>R:R</th><th>P/L</th><th>Tags</th><th></th></tr></thead>
            <tbody>
              {shown.map((t) => {
                const r = t.r_multiple, pnl = t.pnl_amount, long = t.direction === 'long'
                const tags = [t.setup_type, ...(t.strategy_tags ?? [])].filter(Boolean) as string[]
                return (
                  <tr key={t.id}>
                    <td className="faint">{fmtDate(t.traded_at)}</td>
                    <td>
                      <div className="ts-inst">
                        <span className="ts-inst-badge" style={{ background: marketColor(t.market) }}>{instrumentBadge(t.instrument)}</span>
                        <div><div style={{ fontWeight: 600 }}>{t.instrument}</div><div className="faint" style={{ fontSize: 12, textTransform: 'capitalize' }}>{t.market}</div></div>
                      </div>
                    </td>
                    <td><span className={`ts-side ${long ? 'ts-side--long' : 'ts-side--short'}`} title={long ? 'Long' : 'Short'} aria-label={long ? 'Long' : 'Short'}>{long ? '↗' : '↘'}</span></td>
                    <td className="mono">{t.entry_price}</td>
                    <td className="mono">{t.exit_price ?? '—'}</td>
                    <td className={r == null ? '' : r >= 0 ? 'ts-pos' : 'ts-neg'}>{r != null ? `${r >= 0 ? '+' : ''}${r.toFixed(1)}R` : t.planned_rr ? `1:${t.planned_rr.toFixed(1)}` : '—'}</td>
                    <td className={pnl == null ? '' : pnl >= 0 ? 'ts-pos' : 'ts-neg'}>{pnl == null ? <span className="ts-badge ts-badge--open">open</span> : `${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(0)}`}</td>
                    <td>{tags.slice(0, 2).map((x) => <span key={x} className="ts-tag">{x}</span>)}</td>
                    <td>{t.status === 'open' ? <CloseTradeModal tradeId={t.id} /> : null}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="ts-table-foot">
        <span className="faint">Showing {shown.length} of {trades.length} trades · net{' '}
          <span className={monthNet >= 0 ? 'ts-pos' : 'ts-neg'}>{monthNet >= 0 ? '+' : '−'}${Math.abs(monthNet).toFixed(0)}</span>
        </span>
      </div>
    </div>
  )
}
