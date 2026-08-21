'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { signUp, type ActionState } from '@/app/actions/auth'
import { GoogleButton } from '@/app/_components/GoogleButton'
import { AuthShell, EyeIcon, LockIcon } from '@/app/_components/AuthShell'
import { OAuthLegalNotice } from '@/app/_components/LegalNotice'
import { LEGAL, EXTERNAL_LINK } from '@/lib/marketing'
import { passwordProblem, scorePassword, STRENGTH_LABELS, PASSWORD_MIN_LENGTH } from '@/lib/password'

const initial: ActionState = {}

// Item 9 F5: the meter and the score now come from `lib/password`, the same
// module the server action enforces with. The local copy that used to live here
// scored a password the server had already accepted or rejected on different
// rules, which is how "password" got through a "Weak" meter and a length check.
const STRENGTH_COLOURS = ['var(--line-2)', 'var(--down)', 'var(--xp)', 'var(--violet)', 'var(--up)']

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, initial)
  const [show, setShow] = useState(false)
  const [pw, setPw] = useState('')
  const [agreed, setAgreed] = useState(false)
  // Controlled for the same reason as the password below: the post-action form
  // reset was clearing the username and email — the two fields that were fine —
  // while the rejected password survived.
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')

  const score = scorePassword(pw)
  const strengthColour = STRENGTH_COLOURS[score]
  // The SAME predicate the server action runs, so the button can never invite a
  // submit the server will refuse — and can never allow one it would refuse.
  const problem = pw ? passwordProblem(pw, [email, username]) : null

  return (
    <AuthShell
      mode="signup"
      heading="Create your free profile"
      sub="Build your trading profile. Prove your edge. Climb the leaderboard."
    >
      <GoogleButton className="fl-oauth" />
      {/* The terms checkbox lives inside the <form> below, where it gates that
          form's submit — but it cannot gate THIS button, which sits outside the
          form, so an OAuth signup accepted nothing and saw no legal link at all
          (audit item 4 finding 3). Hence the passive notice underneath. */}
      <OAuthLegalNotice />
      <div className="fl-or"><span>or</span></div>

      <form action={action} className="fl-fields">
        <div className="fl-field">
          <label htmlFor="su-username">Username</label>
          <span className="fl-input">
            <input id="su-username" name="username" autoComplete="username" required placeholder="yourname"
              value={username} onChange={(e) => setUsername(e.target.value)} />
          </span>
        </div>

        <div className="fl-field">
          <label htmlFor="su-email">Email</label>
          <span className="fl-input">
            <input id="su-email" name="email" type="email" autoComplete="email" required placeholder="you@email.com"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </span>
        </div>

        <div className="fl-field">
          <label htmlFor="su-password">
            <span>Password</span>
            {pw && <span style={{ color: strengthColour, textTransform: 'none', letterSpacing: 0 }}>{STRENGTH_LABELS[score]}</span>}
          </label>
          <span className="fl-input">
            <input
              id="su-password"
              name="password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              required
              placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
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
          <span className={`fl-strength s${score}`} style={{ '--lvl-col': strengthColour } as React.CSSProperties}>
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
          {/* The privacy policy was missing from this list — the one moment in
              the product where the user is asked to read and accept something
              (audit item 4 finding 2). Keep the order matching the error string
              in actions/auth.ts. */}
          <span className="tx">
            I agree to the{' '}
            <a href={LEGAL.terms} {...EXTERNAL_LINK}>Terms</a>,{' '}
            <a href={LEGAL.privacy} {...EXTERNAL_LINK}>Privacy Policy</a>{' '}
            and{' '}
            <a href={LEGAL.disclaimer} {...EXTERNAL_LINK}>financial disclaimer</a>.
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

        {problem && <p className="fl-err">{problem}</p>}
        {/* Only once the password is filled and clean is the checkbox the sole
            remaining blocker — say so then, rather than scolding the user about
            a control they have not reached yet. Username and email carry
            `required`, so the browser explains those itself. */}
        {!problem && pw && !agreed && (
          <p className="fl-err">Please accept the Terms, Privacy Policy and financial disclaimer to continue.</p>
        )}
        {state.error && <p className="fl-err">{state.error}</p>}

        <button disabled={pending || !!problem || !pw || !agreed} className="fl-submit">
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
