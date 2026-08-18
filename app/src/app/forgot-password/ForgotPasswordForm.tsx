'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { requestPasswordReset, type ActionState } from '@/app/actions/auth'
import { AuthShell, LockIcon } from '@/app/_components/AuthShell'

const initial: ActionState = {}

/**
 * Copy for the states `/auth/reset` can bounce back with. Kept here rather than
 * in the route handler so the route stays free of presentation.
 *
 * None of these varies with whether the address exists — they describe what
 * happened to the *link*, which the holder of the link already knows.
 */
const LINK_ERRORS: Record<string, string> = {
  expired: 'That reset link has expired or has already been used. Request a new one below.',
  denied: 'That link could not be verified. Request a new one below.',
  missing: 'That link was incomplete — some mail apps cut long links in half. Request a new one below.',
  leaked:
    'For your security that link was cancelled, because it arrived in a form that could have been ' +
    'exposed to scripts on the page. Request a fresh one below — the new link uses a safe route.',
}

export function ForgotPasswordForm({ linkError }: { linkError?: string }) {
  const [state, action, pending] = useActionState(requestPasswordReset, initial)
  const [email, setEmail] = useState('')

  // Once the neutral notice is showing there is nothing useful left to do on
  // this page, so the form is replaced rather than left inviting a resubmit
  // that would only burn the throttle budget.
  const sent = !!state.notice

  return (
    <AuthShell
      mode="login"
      heading={sent ? 'Check your email' : 'Reset your password'}
      sub={
        sent
          ? 'The link works once and expires in an hour.'
          : 'Enter the email you signed up with and we will send you a reset link.'
      }
    >
      {sent ? (
        <>
          <p className="ts-callout" style={{ marginTop: 4 }}>{state.notice}</p>
          <div className="fl-foot">
            <p className="fl-secure" style={{ marginTop: 20, fontFamily: 'var(--body)', color: 'var(--dim)' }}>
              <Link href="/login" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>
                Back to log in
              </Link>
            </p>
          </div>
        </>
      ) : (
        <>
          {linkError && LINK_ERRORS[linkError] && (
            <p className="fl-err" style={{ marginTop: 0, marginBottom: 4 }}>{LINK_ERRORS[linkError]}</p>
          )}

          <form action={action} className="fl-fields">
            <div className="fl-field">
              <label htmlFor="fp-email">Email</label>
              <span className="fl-input">
                <input
                  id="fp-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </span>
            </div>

            {state.error && <p className="fl-err">{state.error}</p>}

            <button disabled={pending} className="fl-submit">
              {pending ? 'Sending…' : 'Send reset link'}
            </button>
          </form>

          {/* Static, shown to everyone. Detecting a Google-only account and
              saying so would be an account-existence oracle, which is exactly
              what the neutral response above exists to prevent. */}
          <p className="fl-secure" style={{ marginTop: 18, fontFamily: 'var(--body)', color: 'var(--dim)', textAlign: 'center', lineHeight: 1.6 }}>
            Signed up with Google? Google accounts have no TradingSocial password —{' '}
            <Link href="/login" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>
              use Continue with Google
            </Link>{' '}
            instead.
          </p>

          <div className="fl-foot">
            <p className="fl-secure"><LockIcon /> Secured &amp; encrypted</p>
            <p className="fl-secure" style={{ marginTop: 8, fontFamily: 'var(--body)', color: 'var(--dim)' }}>
              Remembered it?{' '}
              <Link href="/login" style={{ color: 'var(--violet-br)', fontWeight: 700, marginLeft: 4 }}>
                Back to log in
              </Link>
            </p>
          </div>
        </>
      )}
    </AuthShell>
  )
}
