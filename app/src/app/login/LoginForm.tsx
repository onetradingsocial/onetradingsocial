'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { signIn, type ActionState } from '@/app/actions/auth'
import { GoogleButton } from '@/app/_components/GoogleButton'
import { AuthShell, EyeIcon, LockIcon } from '@/app/_components/AuthShell'

const initial: ActionState = {}

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, initial)
  const [show, setShow] = useState(false)
  // Controlled: React resets the form after a failed action, which wiped the
  // email and made the user retype it after every mistyped password. Only the
  // password is meant to clear.
  const [email, setEmail] = useState('')

  return (
    <AuthShell mode="login" heading="Welcome back" sub="Log in to keep tracking your edge.">
      <GoogleButton className="fl-oauth" />
      <div className="fl-or"><span>or</span></div>

      <form action={action} className="fl-fields">
        <div className="fl-field">
          <label htmlFor="li-email">Email</label>
          <span className="fl-input">
            <input id="li-email" name="email" type="email" autoComplete="email" required placeholder="you@email.com"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </span>
        </div>

        <div className="fl-field">
          <label htmlFor="li-password">Password</label>
          <span className="fl-input">
            <input
              id="li-password"
              name="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              required
              placeholder="••••••••"
            />
            <button
              type="button"
              className="eye"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              <EyeIcon off={show} />
            </button>
          </span>
        </div>

        {/* Item 9 F1: without this link there is no way back into a password
            account at all — 436 of 454 production identities are email+password
            and not one had ever used recovery. */}
        <div className="fl-remember" style={{ justifyContent: 'flex-end' }}>
          <Link href="/forgot-password" className="fl-forgot">Forgot password?</Link>
        </div>

        {state.error && <p className="fl-err">{state.error}</p>}

        {/* Only reachable once Supabase "Confirm email" is on, and only when the
            password was CORRECT — GoTrue returns this instead of a session. So
            offering the resend here discloses nothing to someone guessing. */}
        {state.unconfirmed && (
          <p className="fl-secure" style={{ marginTop: 10, fontFamily: 'var(--body)', color: 'var(--dim)' }}>
            <Link href="/check-email" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>
              Resend the confirmation email
            </Link>
          </p>
        )}

        <button disabled={pending} className="fl-submit">
          {pending ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <div className="fl-foot">
        <p className="fl-secure"><LockIcon /> Secured &amp; encrypted</p>
        <p className="fl-secure" style={{ marginTop: 8, fontFamily: 'var(--body)', color: 'var(--dim)' }}>
          New here?{' '}
          <Link href="/signup" style={{ color: 'var(--violet-br)', fontWeight: 700, marginLeft: 4 }}>
            Create a profile
          </Link>
        </p>
      </div>
    </AuthShell>
  )
}
