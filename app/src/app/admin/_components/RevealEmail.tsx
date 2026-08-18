'use client'

import { useState, useTransition } from 'react'
import { revealUserEmail, revealBrokerLogin } from '@/app/actions/admin'

/**
 * The masked-identifier control. Audit item 18, F3.
 *
 * Renders the mask until an admin asks for the real value, then swaps in the
 * value returned by a server action that has already re-checked `requireAdmin()`
 * and written an `admin_audit` row. The masked string is what the server sent —
 * the address is genuinely not in the page payload until the click, so this is
 * not a CSS blur over data that was shipped anyway.
 *
 * Once revealed it stays revealed for the life of the page. Re-masking after a
 * few seconds would look more secure and would only cause a second reveal (and
 * a second audit row) for the same look. One deliberate act, one record.
 */
export function RevealEmail({
  userId,
  masked,
  context = 'directory',
  /** Optional mailto template — used by /admin/interviews, which exists to send mail. */
  mailto,
}: {
  userId: string
  masked: string
  context?: 'directory' | 'detail' | 'interviews'
  mailto?: { subject: string; body: string }
}) {
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (email) {
    return (
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 13 }}>{email}</span>
        {mailto && (
          <a
            className="btn btn-ghost btn-sm"
            href={`mailto:${email}?subject=${encodeURIComponent(mailto.subject)}&body=${encodeURIComponent(mailto.body)}`}
          >
            Invite
          </a>
        )}
      </span>
    )
  }

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <span style={{ fontSize: 13 }} title="Masked. Revealing is recorded in the audit log.">
        {masked}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null)
            const res = await revealUserEmail(userId, context)
            if (res.error) setError(res.error)
            else setEmail(res.email ?? '—')
          })
        }
      >
        {pending ? '…' : 'Reveal'}
      </button>
      {error && <span className="faint" style={{ fontSize: 12 }}>{error}</span>}
    </span>
  )
}

/**
 * Same control for the MT5 broker `login` on /admin/verification. Separate
 * component because it calls a separate action with a separate audit label:
 * revealing an identifier at a third-party broker is a different disclosure
 * from revealing an email, and the log should not conflate them.
 */
export function RevealBrokerLogin({ userId, masked }: { userId: string; masked: string }) {
  const [login, setLogin] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (login) return <span className="ad-kv">{login}</span>

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span className="ad-kv" title="Masked. Revealing is recorded in the audit log.">{masked}</span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await revealBrokerLogin(userId)
            setLogin(res.login ?? '—')
          })
        }
      >
        {pending ? '…' : 'Reveal'}
      </button>
    </span>
  )
}
