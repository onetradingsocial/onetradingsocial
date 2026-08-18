'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { resendConfirmation, type ActionState } from '@/app/actions/auth'
import { AuthShell, LockIcon } from '@/app/_components/AuthShell'

const initial: ActionState = {}

export function CheckEmailForm({ email }: { email: string | null }) {
  const [state, action, pending] = useActionState(resendConfirmation, initial)
  const [value, setValue] = useState(email ?? '')

  return (
    <AuthShell
      mode="signup"
      heading="Confirm your email"
      sub="We sent you a link. Click it to finish setting up your account."
    >
      {/* Neutral by construction. This page is reached both by a brand-new
          signup and by someone re-registering an address that already has an
          account, and it must read identically for both — the email that lands
          is what tells them apart (item 9 F6). */}
      <p className="ts-callout" style={{ marginTop: 4 }}>
        Open the link in the email to activate your account. It expires in an hour.
        If an account already existed for that address, the email will say so instead.
      </p>

      <form action={action} className="fl-fields">
        <div className="fl-field">
          <label htmlFor="ce-email">Didn&apos;t get it? Resend to</label>
          <span className="fl-input">
            <input
              id="ce-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@email.com"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </span>
        </div>

        {state.error && <p className="fl-err">{state.error}</p>}
        {state.notice && <p className="ts-callout" style={{ marginTop: 14 }}>{state.notice}</p>}

        <button disabled={pending} className="fl-submit">
          {pending ? 'Sending…' : 'Resend confirmation email'}
        </button>
      </form>

      <div className="fl-foot">
        <p className="fl-secure"><LockIcon /> Secured &amp; encrypted</p>
        <p className="fl-secure" style={{ marginTop: 8, fontFamily: 'var(--body)', color: 'var(--dim)' }}>
          <Link href="/login" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>
            Back to log in
          </Link>
        </p>
      </div>
    </AuthShell>
  )
}
