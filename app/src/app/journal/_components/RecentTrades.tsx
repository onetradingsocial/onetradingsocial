'use client'

import { useState } from 'react'
import { CloseTradeModal } from './CloseTradeModal'
import { EditTradeModal, type EditTradeConfig } from './EditTradeModal'
import { DeleteTradeButton } from './DeleteTradeButton'
import { marketColor, instrumentBadge, matchesTradeFilter, netOfTrades, type JTrade } from '@/lib/journal-stats'
import { MARKETS } from '@/lib/profile'
import { VerificationBadge } from '@/app/_components/VerificationBadge'
import { tradeLevel } from '@/lib/verification'

// Labels for the market chips. Typed against MARKETS so adding a market to the
// canonical list is a type error here until it is given a label — the previous
// hand-written row named only crypto/forex/stocks and had silently fallen two
// markets behind it, so a trader whose journal was entirely gold (or indices)
// was offered three filters and matched none of them.
const MARKET_LABELS: Record<(typeof MARKETS)[number], string> = {
  forex: 'Forex',
  crypto: 'Crypto',
  stocks: 'Stocks',
  indices: 'Indices',
  commodities: 'Commodities',
}

// Outcome filters first, then every market in canonical order. `.ts-segfilter`
// already wraps, so the longer row reflows rather than overflowing.
const FILTERS: readonly (readonly [string, string])[] = [
  ['all', 'All'],
  ['wins', 'Wins'],
  ['losses', 'Losses'],
  ...MARKETS.map((m) => [m, MARKET_LABELS[m]] as const),
]

// Year included: "Jan 1" made a 2031-dated trade indistinguishable from one
// logged this week, which is how a fabricated future trade went unnoticed.
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// The footer used to take a `monthNet` prop — the current calendar month's net,
// printed in the same sentence as an all-history row count and unaffected by the
// filter. On a real account the rows carried +$1,834 and the footer read +$0.
//
// The net is now derived from the rows the table is showing, so the sentence
// describes one population. The month figure was not deleted, it was moved to
// where it is true: the "Total P/L · <month>" stat card and the journal hero,
// both of which name their period.
export function RecentTrades({ trades, canMistakeTag = false, editConfig }: {
  // editConfig omitted on /demo, whose sample trades belong to nobody and
  // cannot be edited — the table then renders no Edit button at all.
  trades: JTrade[]; canMistakeTag?: boolean; editConfig?: EditTradeConfig
}) {
  const [f, setF] = useState<string>('all')
  const shown = trades.filter((t) => matchesTradeFilter(t, f))
  const { net, counted, excluded } = netOfTrades(shown)

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
                        <div>
                          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {t.instrument}
                            <VerificationBadge level={tradeLevel(t.source)} short />
                          </div>
                          <div className="faint" style={{ fontSize: 12, textTransform: 'capitalize' }}>{t.market}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className={`ts-side ${long ? 'ts-side--long' : 'ts-side--short'}`} title={long ? 'Long' : 'Short'} aria-label={long ? 'Long' : 'Short'}>{long ? '↗' : '↘'}</span></td>
                    <td className="mono">{t.entry_price}</td>
                    <td className="mono">{t.exit_price ?? '—'}</td>
                    <td className={r == null ? '' : r >= 0 ? 'ts-pos' : 'ts-neg'}>{r != null ? `${r >= 0 ? '+' : ''}${r.toFixed(1)}R` : t.planned_rr ? `1:${t.planned_rr.toFixed(1)}` : '—'}</td>
                    <td className={pnl == null ? '' : pnl >= 0 ? 'ts-pos' : 'ts-neg'}>{pnl == null ? <span className="ts-badge ts-badge--open">open</span> : `${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(0)}`}</td>
                    <td>{tags.slice(0, 2).map((x) => <span key={x} className="ts-tag">{x}</span>)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {editConfig && <EditTradeModal trade={t} config={editConfig} />}
                        {t.status === 'open' && <CloseTradeModal tradeId={t.id} canMistakeTag={canMistakeTag} />}
                        {/* Manual only: 0053 narrowed `trades_delete` to manual
                            rows, so Delete on an imported trade could only ever
                            be refused. Same `editConfig` guard as Edit — the
                            /demo table's sample rows belong to nobody. */}
                        {editConfig && (t.source ?? 'manual') === 'manual' && <DeleteTradeButton trade={t} />}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="ts-table-foot">
        <span className="faint">Showing {shown.length} of {trades.length} trades · net{' '}
          <span className={net >= 0 ? 'ts-pos' : 'ts-neg'}>{net >= 0 ? '+' : '−'}${Math.abs(net).toFixed(0)}</span>{' '}
          across the {counted} closed {counted === 1 ? 'row' : 'rows'} shown
          {excluded > 0 && ` · ${excluded} excluded (open, or closed with no money P/L)`}
        </span>
      </div>
    </div>
  )
}
