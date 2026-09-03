'use client'

import { useState, useTransition } from 'react'
import { exportMyData, deleteMyAccount } from '@/app/actions/account'
import Link from 'next/link'

export type DangerZoneProps = {
  /** Typed back by the user to confirm. The username used to serve this
   *  purpose and it is the public profile URL, so it confirmed nothing. */
  email: string
  /** True when the account has an email+password identity, i.e. there is a
   *  credential to re-check. Google-only accounts have none. */
  hasPassword: boolean
  /** Formatted end of a paid period, when one is running. Drives the
   *  forfeiture warning — see below. */
  paidUntil: string | null
  /** Exchanges with a stored API key. We delete our copy; only the user can
   *  revoke the key at the exchange, so they have to be told. */
  exchanges: string[]
  /** True when an MT5 account is connected — it is removed from MetaApi as
   *  part of the deletion, and people want to know that happens. */
  hasBroker: boolean
}

/**
 * Data export + account deletion.
 *
 * The deletion half is now a disclosure surface as much as a button. Item 6
 * found the old dialog said "This permanently deletes your profile, trades,
 * posts and history" — a sentence that was true about Postgres and false about
 * everything else, and which did not mention that a paid subscription kept
 * billing afterwards. Consent to an irreversible act is only meaningful if the
 * description of the act is accurate, so the list below is exhaustive in both
 * directions: what goes, and what stays.
 */
export function DangerZone({ email, hasPassword, paidUntil, exchanges, hasBroker }: DangerZoneProps) {
  const [pending, start] = useTransition()
  const [confirm, setConfirm] = useState('')
  const [password, setPassword] = useState('')
  const [showDelete, setShowDelete] = useState(false)
  const [error, setError] = useState('')

  const matches = confirm.trim().toLowerCase() === email.trim().toLowerCase()
  const ready = matches && (!hasPassword || password.length > 0)

  function download() {
    start(async () => {
      const r = await exportMyData()
      if (r.error || !r.json) { setError(r.error ?? 'Export failed.'); return }
      const blob = new Blob([r.json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tradingsocial-export.json`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  function remove() {
    setError('')
    start(async () => {
      const r = await deleteMyAccount({ confirmation: confirm, password: password || undefined })
      // Success redirects server-side and never returns. Anything that comes
      // back is a real error, and it now names the step that failed rather
      // than saying "Deletion failed. Contact support."
      if (r?.error) { setError(r.error); setPassword('') }
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
          <div style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
            <p style={{ fontSize: 13.5, margin: 0 }}>
              <b>This cannot be undone.</b> There is no grace period and no way to restore the account
              afterwards. Export your data first if you want a copy.
            </p>

            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <b>Deleted immediately:</b> your profile, every trade and journal note, uploaded charts,
              avatar and cover images, posts and their images, comments, likes, follows, direct messages
              and their attachments, notifications, trading rules and goals, course progress, and your
              login.
              {hasBroker && ' Your connected MT5 account is removed from our broker provider, including the investor password you gave it.'}
            </div>

            {/* Terms §11: paid plans are charged in advance and a part-period
                the user walks away from is not refunded. That is only a fair
                term if they are told BEFORE they press the button, not after. */}
            {paidUntil && (
              <div className="ts-callout" style={{ fontSize: 13, lineHeight: 1.6 }}>
                <b>You have a paid plan running until {paidUntil}.</b> Deleting now cancels it
                immediately and <b>the unused part of the period is not refunded</b> (Terms, section 11).
                Your card is detached so nothing further can ever be charged. If you would rather use the
                time you have paid for, cancel in <Link href="/settings/billing">Billing</Link> first and delete
                the account when the period ends.
              </div>
            )}

            {exchanges.length > 0 && (
              <div className="ts-callout" style={{ fontSize: 13, lineHeight: 1.6 }}>
                <b>Revoke your {exchanges.join(' and ')} API key yourself.</b> We delete our encrypted
                copy, but only you can revoke the key at the exchange. Do that before or straight after
                deleting.
              </div>
            )}

            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <b>Kept on purpose:</b> if you have ever paid us, the invoice record stays with our payment
              provider for five years because Australian tax law requires it — your subscription is still
              cancelled and your card removed. If anyone has reported your account, that report is kept
              without your name attached. Information already sent to Meta, Reddit, Google and our email
              provider has to be removed by them; we will email you the details.
            </div>

            <label className="ts-field">
              <span className="ts-label">Type your email address to confirm</span>
              <input className="ts-input" placeholder={email} autoComplete="off"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>

            {hasPassword && (
              <label className="ts-field">
                <span className="ts-label">Your password</span>
                <input className="ts-input" type="password" autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
            )}

            {error && <p className="ts-error" style={{ lineHeight: 1.5 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-primary" style={{ background: 'var(--down)' }}
                disabled={pending || !ready} onClick={remove}>
                {pending ? 'Deleting…' : 'Permanently delete'}
              </button>
              <button type="button" className="btn"
                onClick={() => { setShowDelete(false); setConfirm(''); setPassword(''); setError('') }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
