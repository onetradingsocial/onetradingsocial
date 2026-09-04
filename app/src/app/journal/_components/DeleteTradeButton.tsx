'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteTrade } from '@/app/actions/trade'
import type { JTrade } from '@/lib/journal-stats'

function fmt(t: JTrade) {
  const d = new Date(t.traded_at).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
  const pnl = t.pnl_amount
  const result = pnl == null
    ? 'still open'
    : `${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`
  return `${t.instrument} · ${t.direction === 'long' ? 'Long' : 'Short'} · ${d} · ${result}`
}

/**
 * Delete one manually logged trade.
 *
 * Only rendered for `source === 'manual'`. Migration 0053 narrowed
 * `trades_delete` to manual rows, and a DELETE refused by RLS is SILENT —
 * PostgREST reports success having matched zero rows. `deleteTrade` reads the
 * row first so it can return a real message, but the better answer is not to
 * offer the button on a trade that can never be deleted.
 */
export function DeleteTradeButton({ trade }: { trade: JTrade }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function remove() {
    setPending(true); setError('')
    const res = await deleteTrade(trade.id)
    if (res.error) { setError(res.error); setPending(false); return }
    setPending(false); setOpen(false); router.refresh()
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ color: 'var(--down)' }}
        onClick={() => setOpen(true)}
        aria-label={`Delete trade: ${fmt(trade)}`}
      >
        Delete
      </button>

      {open && (
        <div className="ts-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="ts-modal" style={{ maxWidth: 460 }}>
            <div className="ts-modal-head">
              <h2 className="ts-h2">Delete this trade?</h2>
              <button type="button" className="ts-modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>

            {/* Rows in the table look alike. Naming the trade is what makes
                this a confirmation rather than a second click in the dark. */}
            <div className="ts-callout mt-3" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              <b>{fmt(trade)}</b>
            </div>

            <p className="mt-3" style={{ fontSize: 13.5, lineHeight: 1.6, margin: '12px 0 0' }}>
              <b>This cannot be undone.</b> The trade is removed from your journal and from every
              statistic computed over it — win rate, profit factor, expectancy and your streaks all
              change. If you only need to correct a detail, close this and use <b>Edit</b> instead.
            </p>

            {/* 0028 keeps trade_audits rows with no FK to trades precisely so
                history survives deletion. Saying so is honest, and it is the
                fact that makes the button safe to offer at all. */}
            <p className="faint mt-3" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              A record that this trade existed and was deleted is kept in your account history.
            </p>

            {error && <p className="ts-error mt-3" style={{ lineHeight: 1.5 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button type="button" className="btn btn-primary" style={{ background: 'var(--down)' }}
                disabled={pending} onClick={remove}>
                {pending ? 'Deleting…' : 'Delete trade'}
              </button>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
