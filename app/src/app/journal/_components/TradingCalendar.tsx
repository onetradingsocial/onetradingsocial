'use client'

import { useEffect, useState } from 'react'
import type { CalCell, JTrade } from '@/lib/journal-stats'
import { marketColor, instrumentBadge } from '@/lib/journal-stats'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function money(n: number) {
  return `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(0)}`
}

export function TradingCalendar({
  cells, monthLabel, today, trades, year, month,
}: {
  cells: CalCell[]; monthLabel: string; today: number
  trades: JTrade[]; year: number; month: number
}) {
  const [selDay, setSelDay] = useState<number | null>(null)

  // close on Escape
  useEffect(() => {
    if (selDay == null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelDay(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selDay])

  const dayTrades = selDay == null ? [] : trades.filter((t) => {
    const d = new Date(t.traded_at)
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === selDay
  })
  const dayNet = dayTrades.reduce((s, t) => s + (t.pnl_amount ?? 0), 0)

  return (
    <div className="ts-card">
      <div className="flex items-center justify-between">
        <h2 className="ts-h2">Trading Calendar</h2>
        <span className="faint">{monthLabel}</span>
      </div>
      <div className="ts-cal mt-4">
        {DOW.map((d) => <div key={d} className="ts-cal-dow">{d}</div>)}
        {cells.map((c, i) => {
          const tone = !c.inMonth ? 'out' : c.count === 0 ? 'empty' : c.pnl >= 0 ? 'pos' : 'neg'
          const isToday = c.inMonth && c.day === today
          return (
            <button
              key={i}
              type="button"
              className="ts-cal-cell"
              data-tone={tone}
              data-today={isToday}
              disabled={!c.inMonth}
              aria-label={c.inMonth ? `${FULL_MONTHS[month]} ${c.day}${c.count > 0 ? `, ${c.count} trade${c.count > 1 ? 's' : ''}` : ', no trades'}` : undefined}
              onClick={() => c.inMonth && setSelDay(c.day)}
            >
              <div className="d">{c.day}{isToday && <span className="ts-cal-today">TODAY</span>}</div>
              {c.inMonth && c.count > 0 && (
                <div className="m">
                  <span className={c.pnl >= 0 ? 'ts-pos' : 'ts-neg'}>{money(c.pnl)}</span>
                  <span className="ct">{c.count} trade{c.count > 1 ? 's' : ''}</span>
                </div>
              )}
            </button>
          )
        })}
      </div>
      <div className="ts-cal-legend">
        <span><i className="pos" /> Profitable day</span>
        <span><i className="neg" /> Losing day</span>
        <span><i className="today" /> Today</span>
      </div>

      {selDay != null && (
        <div className="ts-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setSelDay(null) }}>
          <div className="ts-modal ts-modal--narrow" role="dialog" aria-label={`Trades on ${FULL_MONTHS[month]} ${selDay}`}>
            <div className="ts-modal-head">
              <div>
                <h2 className="ts-h2">{FULL_MONTHS[month]} {selDay}, {year}</h2>
                {dayTrades.length > 0 && (
                  <p className="faint" style={{ marginTop: 2, fontSize: 13 }}>
                    {dayTrades.length} trade{dayTrades.length > 1 ? 's' : ''} · net{' '}
                    <span className={dayNet >= 0 ? 'ts-pos' : 'ts-neg'}>{money(dayNet)}</span>
                  </p>
                )}
              </div>
              <button type="button" className="ts-modal-close" onClick={() => setSelDay(null)} aria-label="Close">✕</button>
            </div>

            {dayTrades.length === 0 ? (
              <p className="faint" style={{ padding: '24px 0', textAlign: 'center' }}>No trades logged on this day.</p>
            ) : (
              <ul className="ts-daytrades">
                {dayTrades.map((t) => {
                  const long = t.direction === 'long'
                  const r = t.r_multiple, pnl = t.pnl_amount
                  const tags = [t.setup_type, ...(t.strategy_tags ?? [])].filter(Boolean) as string[]
                  return (
                    <li key={t.id} className="ts-daytrade">
                      <span className="ts-inst-badge" style={{ background: marketColor(t.market) }}>{instrumentBadge(t.instrument)}</span>
                      <div className="ts-daytrade-main">
                        <div className="ts-daytrade-top">
                          <b>{t.instrument}</b>
                          <span className={`ts-side ${long ? 'ts-side--long' : 'ts-side--short'}`} title={long ? 'Long' : 'Short'} aria-label={long ? 'Long' : 'Short'}>{long ? '↗' : '↘'}</span>
                        </div>
                        <div className="ts-daytrade-meta mono">
                          {t.entry_price} → {t.exit_price ?? '—'}
                          {r != null && <span className={r >= 0 ? 'ts-pos' : 'ts-neg'}> · {r >= 0 ? '+' : ''}{r.toFixed(1)}R</span>}
                        </div>
                        {tags.length > 0 && <div className="ts-daytrade-tags">{tags.slice(0, 3).map((x) => <span key={x} className="ts-tag">{x}</span>)}</div>}
                      </div>
                      <span className={'ts-daytrade-pl ' + (pnl == null ? '' : pnl >= 0 ? 'ts-pos' : 'ts-neg')}>
                        {pnl == null ? <span className="ts-badge ts-badge--open">open</span> : money(pnl)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
