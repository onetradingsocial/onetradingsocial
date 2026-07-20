'use client'

import { useState, useTransition } from 'react'
import { exportMyData, deleteMyAccount } from '@/app/actions/account'

/**
 * Data export + account deletion (Sprint 3, row 53). Export downloads a JSON
 * of everything the user owns; deletion is guarded by typing the username.
 */
export function DangerZone({ username }: { username: string }) {
  const [pending, start] = useTransition()
  const [confirm, setConfirm] = useState('')
  const [showDelete, setShowDelete] = useState(false)
  const [error, setError] = useState('')

  function download() {
    start(async () => {
      const r = await exportMyData()
      if (r.error || !r.json) { setError(r.error ?? 'Export failed.'); return }
      const blob = new Blob([r.json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tradingsocial-${username}-export.json`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  function remove() {
    setError('')
    start(async () => {
      const r = await deleteMyAccount(confirm)
      if (r?.error) setError(r.error)
      // success redirects server-side
    })
  }

  return (
    <section id="account-data" className="ts-card settings-section" style={{ borderColor: 'rgba(229,71,93,0.3)' }}>
      <h2 className="ts-h2">Your data</h2>
      <p className="ts-sub mb-4">Export everything you&apos;ve stored, or permanently delete your account.</p>

      <button type="button" className="btn" disabled={pending} onClick={download}>
        {pending ? 'Preparing…' : 'Export my data (JSON)'}
      </button>

      <div className="mt-6" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        {!showDelete ? (
          <button type="button" className="btn" style={{ color: 'var(--down)', borderColor: 'rgba(229,71,93,0.4)' }}
            onClick={() => setShowDelete(true)}>
            Delete my account…
          </button>
        ) : (
          <div style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
            <p style={{ fontSize: 13.5 }}>
              This <b>permanently deletes</b> your profile, trades, posts and history. It cannot be undone.
              Type <b>{username}</b> to confirm.
            </p>
            <input className="ts-input" placeholder="your username" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {error && <p className="ts-error">{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-primary" style={{ background: 'var(--down)' }}
                disabled={pending || confirm.trim() !== username} onClick={remove}>
                {pending ? 'Deleting…' : 'Permanently delete'}
              </button>
              <button type="button" className="btn" onClick={() => { setShowDelete(false); setConfirm(''); setError('') }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
