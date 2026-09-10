'use client'

import { useState } from 'react'
import { TradeReflectionPrompt } from '@/app/_components/TradeReflectionPrompt'
import {
  readTradeReflection, TRADE_REFLECTION_META,
  type ReflectionCounts, type ReflectableTrade,
} from '@/lib/reflection'

/**
 * "Trades waiting on a reflection" — where an IMPORTED trade meets the prompt.
 *
 * ── Why this card exists at all ──────────────────────────────────────────────
 *
 * A manually logged trade gets the question the moment it is saved, in the
 * capture modal, which is what the audit asks for: the prompt arrives while the
 * trade is still in front of the user. An import cannot work that way — one
 * upload can land two hundred trades, and a two-hundred-step wizard is a
 * two-hundred-step dismissal. So the import hands off to this card, and this
 * card is anchored (`#reflect`) so the handoff lands on it directly.
 *
 * It sits above the analytics rather than below them because a reflection is an
 * input to the week, not a report on it. It is not an edit form and it is not
 * reached through one — the audit is explicit that burying the prompt in an
 * edit form is the failure mode.
 *
 * ── Ungated ──────────────────────────────────────────────────────────────────
 *
 * No tier prop, no `canFlag`. Every user sees this, which is the point.
 *
 * ── No nagging ───────────────────────────────────────────────────────────────
 *
 * Unanswered trades are listed, never counted against the user. There is no
 * badge, no red dot, no "you have 12 outstanding". The tally shows the four
 * states side by side, including "not yet answered", because a compliance
 * figure printed without its denominator is the defect the audit named.
 */

export type ReflectRow = ReflectableTrade & {
  id: string
  instrument: string
  direction: string
  traded_at: string
  source?: string | null
}

/** How many unanswered trades are offered at once. Enough that a small import
 *  clears in one sitting; few enough that a large one does not become a wall. */
const BATCH = 5

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export function ReflectTradesCard({ trades, counts }: { trades: ReflectRow[]; counts: ReflectionCounts }) {
  const [shown, setShown] = useState(BATCH)

  const pending = trades.filter((t) => readTradeReflection(t) == null)
  const batch = pending.slice(0, shown)
  const more = pending.length - batch.length

  return (
    <div className="ts-card" id="reflect">
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h2 className="ts-h2">Reflect on your trades</h2>
        <span className="faint" style={{ fontSize: 12 }}>Free, on every plan</span>
      </div>
      <p className="ts-sub mt-1">
        One question per trade: did it follow your rules? Your answers are what the
        weekly review reads — nothing here changes the trade itself, and imported
        execution data stays exactly as your broker reported it.
      </p>

      <div className="ts-reflect-tally mt-3">
        <span>{counts.followed} followed</span>
        <span>{counts.broke} broke a rule</span>
        <span>{counts.unsure} not sure</span>
        <span className="faint">{counts.unreflected} not yet answered</span>
      </div>

      {pending.length === 0 ? (
        <p className="faint mt-3" style={{ fontSize: 13 }}>
          {counts.reflected > 0
            ? `Every trade has an answer. ${counts.reflected} reflected out of ${counts.total}.`
            : 'Nothing waiting. New trades will show up here as you log or import them.'}
        </p>
      ) : (
        <div className="mt-3">
          {batch.map((t) => (
            <div key={t.id} className="ts-reflect-item">
              <div className="ts-reflect-head">
                <b>{t.instrument}</b>
                <span className="faint" style={{ textTransform: 'capitalize' }}>{t.direction}</span>
                <span className="faint">{fmtDate(t.traded_at)}</span>
                {(t.source ?? 'manual') !== 'manual' && (
                  <span className="ts-tag" title="Execution data came from your broker and is locked. The reflection is yours and is not.">
                    imported
                  </span>
                )}
              </div>
              <TradeReflectionPrompt tradeId={t.id} current={readTradeReflection(t)} subtle />
            </div>
          ))}

          {more > 0 && (
            <button type="button" className="btn btn-sm mt-3" onClick={() => setShown(shown + BATCH)}>
              Show {Math.min(more, BATCH)} more ({more} waiting)
            </button>
          )}
        </div>
      )}

      {counts.reflected > 0 && (
        <p className="faint mt-3" style={{ fontSize: 12 }}>
          Answered so far:{' '}
          {counts.followed > 0 && `${counts.followed} ${TRADE_REFLECTION_META.followed.short.toLowerCase()}`}
          {counts.followed > 0 && (counts.broke > 0 || counts.unsure > 0) && ' · '}
          {counts.broke > 0 && `${counts.broke} ${TRADE_REFLECTION_META.broke.short.toLowerCase()}`}
          {counts.broke > 0 && counts.unsure > 0 && ' · '}
          {counts.unsure > 0 && `${counts.unsure} ${TRADE_REFLECTION_META.unknown.short.toLowerCase()}`}
          .
        </p>
      )}
    </div>
  )
}
