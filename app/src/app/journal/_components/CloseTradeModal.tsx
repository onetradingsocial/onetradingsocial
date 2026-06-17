'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { closeTrade } from '@/app/actions/trade'

export function CloseTradeModal({ tradeId }: { tradeId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [exit, setExit] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    const ex = Number(exit)
    if (!Number.isFinite(ex)) { setError('Enter a valid exit price.'); return }
    setPending(true); setError('')
    const res = await closeTrade(tradeId, ex)
    if (res.error) { setError(res.error); setPending(false); return }
    setPending(false); setOpen(false); router.refresh()
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Close</button>
      {open && (
        <div className="ts-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="ts-modal" style={{ maxWidth: 380 }}>
            <div className="ts-modal-head">
              <h2 className="ts-h2">Close trade</h2>
              <button type="button" className="ts-modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <label className="ts-field"><span className="ts-label">Exit price</span>
              <input className="ts-input" value={exit} onChange={(e) => setExit(e.target.value)} inputMode="decimal" autoFocus /></label>
            {error && <p className="ts-error mt-3">{error}</p>}
            <button className="btn btn-primary btn-block mt-4" disabled={pending || !exit} onClick={submit}>
              {pending ? 'Closing…' : 'Close trade'}</button>
          </div>
        </div>
      )}
    </>
  )
}
