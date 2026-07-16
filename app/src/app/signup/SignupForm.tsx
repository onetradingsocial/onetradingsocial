'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { signUp, type ActionState } from '@/app/actions/auth'
import { GoogleButton } from '@/app/_components/GoogleButton'
import { AuthShell, EyeIcon, LockIcon } from '@/app/_components/AuthShell'

const MARKETING = process.env.NEXT_PUBLIC_MARKETING_URL ?? 'https://www.tradingsocial.io'
const initial: ActionState = {}

const STRENGTH = [
  { label: '', col: 'var(--line-2)' },
  { label: 'Weak', col: 'var(--down)' },
  { label: 'Fair', col: 'var(--xp)' },
  { label: 'Good', col: 'var(--violet)' },
  { label: 'Strong', col: 'var(--up)' },
]

function scorePassword(pw: string): number {
  if (!pw) return 0
  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++
  return Math.min(s, 4)
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, initial)
  const [show, setShow] = useState(false)
  const [pw, setPw] = useState('')
  const [agreed, setAgreed] = useState(false)

  const score = scorePassword(pw)
  const lvl = STRENGTH[score]

  return (
    <AuthShell
      mode="signup"
      heading="Create your free profile"
      sub="Build your trading profile. Prove your edge. Climb the leaderboard."
    >
      <GoogleButton className="fl-oauth" />
      <div className="fl-or"><span>or</span></div>

      <form action={action} className="fl-fields">
        <div className="fl-field">
          <label htmlFor="su-username">Username</label>
          <span className="fl-input">
            <input id="su-username" name="username" autoComplete="username" required placeholder="yourname" />
          </span>
        </div>

        <div className="fl-field">
          <label htmlFor="su-email">Email</label>
          <span className="fl-input">
            <input id="su-email" name="email" type="email" autoComplete="email" required placeholder="you@email.com" />
          </span>
        </div>

        <div className="fl-field">
          <label htmlFor="su-password">
            <span>Password</span>
            {pw && <span style={{ color: lvl.col, textTransform: 'none', letterSpacing: 0 }}>{lvl.label}</span>}
          </label>
          <span className="fl-input">
            <input
              id="su-password"
              name="password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              required
              placeholder="At least 8 characters"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
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
          <span className={`fl-strength s${score}`} style={{ '--lvl-col': lvl.col } as React.CSSProperties}>
            <i /><i /><i /><i />
          </span>
        </div>

        <label className={`fl-terms${agreed ? ' on' : ''}`}>
          <input type="checkbox" name="terms" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span className="fl-check">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span className="tx">
            I agree to the{' '}
            <a href={`${MARKETING}/terms`} target="_blank" rel="noopener noreferrer">Terms</a>{' '}
            and{' '}
            <a href={`${MARKETING}/disclaimer`} target="_blank" rel="noopener noreferrer">financial disclaimer</a>.
          </span>
        </label>

        <div className="fl-disc">
          <span className="d-ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <p>TradingSocial is an education and performance-tracking platform and does not provide financial advice.</p>
        </div>

        {state.error && <p className="fl-err">{state.error}</p>}

        <button disabled={pending} className="fl-submit">
          {pending ? 'Creating…' : 'Join the Beta'}
        </button>
      </form>

      <div className="fl-foot">
        <p className="fl-secure"><LockIcon /> Secured &amp; encrypted</p>
        <p className="fl-secure" style={{ marginTop: 8, fontFamily: 'var(--body)', color: 'var(--dim)' }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: 'var(--violet-br)', fontWeight: 700, marginLeft: 4 }}>
            Log in
          </Link>
          {' '}· Not ready?{' '}
          <Link href="/demo" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>
            Explore the demo journal
          </Link>
        </p>
      </div>
    </AuthShell>
  )
}
