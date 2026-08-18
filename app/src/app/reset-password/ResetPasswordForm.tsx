'use client'

import { useActionState, useState } from 'react'
import { updatePassword, type ActionState } from '@/app/actions/auth'
import { AuthShell, EyeIcon, LockIcon } from '@/app/_components/AuthShell'
import { passwordProblem, scorePassword, STRENGTH_LABELS, PASSWORD_MIN_LENGTH } from '@/lib/password'

const initial: ActionState = {}

const STRENGTH_COLOURS = ['var(--line-2)', 'var(--down)', 'var(--xp)', 'var(--violet)', 'var(--up)']

export function ResetPasswordForm({ email }: { email: string | null }) {
  const [state, action, pending] = useActionState(updatePassword, initial)
  const [show, setShow] = useState(false)
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')

  const score = scorePassword(pw)
  // The SAME predicate the server action runs. The form can be stricter than
  // nothing but never looser than the server, because there is only one rule.
  const problem = pw ? passwordProblem(pw, [email]) : null
  const mismatch = confirm.length > 0 && confirm !== pw
  const blocked = !pw || !!problem || mismatch

  return (
    <AuthShell
      mode="login"
      heading="Choose a new password"
      sub={email ? `Setting a new password for ${email}.` : 'Setting a new password for your account.'}
    >
      <form action={action} className="fl-fields">
        {/* Not submitted — the server reads the address from the recovery
            session, never from the form, so a tampered field changes nothing. */}
        <div className="fl-field">
          <label htmlFor="rp-password">
            <span>New password</span>
            {pw && (
              <span style={{ color: STRENGTH_COLOURS[score], textTransform: 'none', letterSpacing: 0 }}>
                {STRENGTH_LABELS[score]}
              </span>
            )}
          </label>
          <span className="fl-input">
            <input
              id="rp-password"
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
          <span className={`fl-strength s${score}`} style={{ '--lvl-col': STRENGTH_COLOURS[score] } as React.CSSProperties}>
            <i /><i /><i /><i />
          </span>
        </div>

        <div className="fl-field">
          <label htmlFor="rp-confirm">Confirm new password</label>
          <span className="fl-input">
            <input
              id="rp-confirm"
              name="confirm"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              required
              placeholder="Type it again"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </span>
        </div>

        {problem && <p className="fl-err">{problem}</p>}
        {!problem && mismatch && <p className="fl-err">The two passwords do not match.</p>}
        {state.error && <p className="fl-err">{state.error}</p>}

        <button disabled={pending || blocked} className="fl-submit">
          {pending ? 'Saving…' : 'Set new password'}
        </button>
      </form>

      <div className="fl-foot">
        <p className="fl-secure"><LockIcon /> Secured &amp; encrypted</p>
        <p className="fl-secure" style={{ marginTop: 8, fontFamily: 'var(--body)', color: 'var(--dim)', textAlign: 'center', lineHeight: 1.6 }}>
          Saving a new password signs you out everywhere else.
        </p>
      </div>
    </AuthShell>
  )
}
