'use client'

import { useEffect, useState } from 'react'
import { useTradeModal } from '@/app/_components/TradeModalProvider'
import { getPickableTrades } from '@/app/actions/social'

type T = { id: string; instrument: string; direction: string; r_multiple: number | null; pnl_amount: number | null; status: string; traded_at: string }

export function TradePickerModal({ onPick, onClose }: { onPick: (t: T) => void; onClose: () => void }) {
  const { open } = useTradeModal()
  const [trades, setTrades] = useState<T[]>([])
  async function load() { setTrades(await getPickableTrades()) }
  useEffect(() => { load() }, [])
  return (
    <div className="ts-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ts-modal" style={{ maxWidth: 460 }}>
        <div className="ts-modal-head">
          <h2 className="ts-h2">Attach a trade</h2>
          <button type="button" className="ts-modal-close" onClick={onClose}>✕</button>
        </div>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => open()}>+ Log a new trade</button>
        <p className="faint" style={{ fontSize: 12, margin: '8px 0' }}>After logging, reopen this picker to attach it.</p>
        <div className="ts-picker-list">
          {trades.length === 0 ? <p className="faint" style={{ textAlign: 'center', padding: 20 }}>No trades yet.</p> : trades.map((t) => (
            <button key={t.id} type="button" className="ts-picker-row" onClick={() => onPick(t)}>
              <span style={{ fontWeight: 600 }}>{t.instrument} <span className="faint" style={{ textTransform: 'capitalize', fontWeight: 400 }}>{t.direction}</span></span>
              <span className={t.r_multiple == null ? 'faint' : t.r_multiple >= 0 ? 'ts-pos' : 'ts-neg'} style={{ fontWeight: 700 }}>
                {t.status === 'open' ? 'open' : t.r_multiple != null ? `${t.r_multiple >= 0 ? '+' : ''}${t.r_multiple.toFixed(1)}R` : '—'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
