'use client'

import { useState, useTransition } from 'react'
import { submitReport, REPORT_REASONS } from '@/app/actions/reports'

/**
 * Report a profile/trade (Sprint 3, row 10). Small link that opens a modal
 * with reason radios + optional detail. Reports land in /admin/verification.
 */
export function ReportButton({ username }: { username: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string>('')
  const [detail, setDetail] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()

  function send() {
    if (!reason) { setError('Pick a reason.'); return }
    setError('')
    start(async () => {
      const r = await submitReport({ reportedUsername: username, reason, detail })
      if (r.error) { setError(r.error); return }
      setDone(true)
      setTimeout(() => { setOpen(false); setDone(false); setReason(''); setDetail('') }, 1600)
    })
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 12.5 }}>
        Report
      </button>
      {open && (
        <div className="ts-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="ts-modal" style={{ maxWidth: 420 }}>
            <div className="ts-modal-head">
              <h2 className="ts-h2">Report @{username}</h2>
              <button type="button" className="ts-modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            {done ? (
              <p className="mt-3">Thanks — the team will review this.</p>
            ) : (
              <>
                <div className="ts-field mt-2">
                  <span className="ts-label">Reason</span>
                  <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                    {REPORT_REASONS.map(([k, l]) => (
                      <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                        <input type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} />
                        {l}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="ts-field mt-3">
                  <span className="ts-label">Details <span className="faint">(optional)</span></span>
                  <textarea className="ts-textarea" rows={3} maxLength={1000} value={detail} onChange={(e) => setDetail(e.target.value)} />
                </label>
                {error && <p className="ts-error mt-2">{error}</p>}
                <button className="btn btn-primary btn-block mt-3" disabled={pending} onClick={send}>
                  {pending ? 'Submitting…' : 'Submit report'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
