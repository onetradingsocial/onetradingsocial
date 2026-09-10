'use client'

import { useState } from 'react'
import { CloseTradeModal } from './CloseTradeModal'
import { EditTradeModal, type EditTradeConfig } from './EditTradeModal'
import { DeleteTradeButton } from './DeleteTradeButton'
import { marketColor, instrumentBadge, matchesTradeFilter, netOfTrades, type JTrade } from '@/lib/journal-stats'
import { MARKETS } from '@/lib/profile'
import { VerificationBadge } from '@/app/_components/VerificationBadge'
import { tradeLevel } from '@/lib/verification'
import { readTradeReflection, TRADE_REFLECTION_META } from '@/lib/reflection'

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
/**
 * Mistake tags are handed in as their own map, keyed by trade id, and NOT as a
 * field on `JTrade`.
 *
 * ── Audit 2026-09-05, follow-up C3 (handed over from C1) ─────────────────────
 *
 * C1 moved mistake tagging to Free, at which point a free user could write a
 * tag at close and never see it again: the tags column here is built from
 * `setup_type` and `strategy_tags` only, and every other surface that renders
 * `mistake_tags` (MistakeAnalysisCard, the Pro report, the weekly digest) is
 * Trader+ or above. A write-only input is a worse first impression than a
 * padlock — the user cannot even tell the tag saved.
 *
 * A tag is an input, not analysis, so it belongs on the free side and this
 * column renders it at every tier. What stays paid is the AGGREGATE: which tag
 * costs the most, over what win rate, at what average R. Reading back the two
 * words you yourself typed on one trade is not that.
 *
 * ── Why a separate prop ──────────────────────────────────────────────────────
 *
 * `JTrade` also backs the public profile query, whose own comment warns against
 * widening the type: a `mistake_tags` field on the shared type is a standing
 * invitation for someone to add the column to that select "to satisfy the
 * type", and it would publish a stranger's record of their own errors. The map
 * is built in journal/page.tsx from a query already filtered to
 * `user_id = auth.uid()`, and being a separate argument it cannot be picked up
 * by a component that renders somebody else's rows. `/demo` passes nothing and
 * renders none, which is correct — its sample rows belong to nobody.
 */
export function RecentTrades({ trades, canMistakeTag = false, mistakeTags, editConfig }: {
  // editConfig omitted on /demo, whose sample trades belong to nobody and
  // cannot be edited — the table then renders no Edit button at all.
  trades: JTrade[]
  canMistakeTag?: boolean
  /** trade id -> the user's own mistake tags. Own rows only; see above. */
  mistakeTags?: Record<string, string[]>
  editConfig?: EditTradeConfig
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
            {/* "Rules & mistakes" is what the TRADER said about the trade — the
                per-trade reflection (0071) and their own mistake tags — not rule
                COMPLIANCE computed from the numbers, and the two are allowed to
                disagree. Ungated: the column renders identically on every plan. */}
            <thead><tr><th>Date</th><th>Instrument</th><th>Side</th><th>Entry</th><th>Exit</th><th>R:R</th><th>P/L</th><th>Tags</th><th>Rules &amp; mistakes</th><th></th></tr></thead>
            <tbody>
              {shown.map((t) => {
                const r = t.r_multiple, pnl = t.pnl_amount, long = t.direction === 'long'
                const tags = [t.setup_type, ...(t.strategy_tags ?? [])].filter(Boolean) as string[]
                const reflection = readTradeReflection(t)
                const mistakes = mistakeTags?.[t.id] ?? []
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
                      {/* The user's own mistake tags, read back. Not a score and
                          not a ranking — the two words they typed at close, in
                          the one column on this page that holds what they said
                          about the trade. */}
                      {mistakes.map((m) => (
                        <span key={m} className="ts-tag ts-tag--mistake" title="Your own mistake tag on this trade">
                          {m}
                        </span>
                      ))}
                      {reflection ? (
                        <span
                          className="ts-tag"
                          title={reflection.note ?? TRADE_REFLECTION_META[reflection.outcome].hint}
                        >
                          {TRADE_REFLECTION_META[reflection.outcome].icon}{' '}
                          {TRADE_REFLECTION_META[reflection.outcome].short}
                        </span>
                      ) : editConfig ? (
                        // Not a warning and not a nag — an unanswered trade
                        // costs nothing. It is a link because the answer is one
                        // click away in the card at the top of the page.
                        //
                        // Same `editConfig` guard as Edit and Delete: on /demo
                        // the rows belong to nobody, there is no reflect card on
                        // that page, and the anchor would go nowhere.
                        <a href="#reflect" className="faint" style={{ fontSize: 12 }} title="Did this trade follow your rules?">
                          Reflect
                        </a>
                      ) : mistakes.length === 0 ? (
                        <span className="faint">—</span>
                      ) : null}
                    </td>
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
