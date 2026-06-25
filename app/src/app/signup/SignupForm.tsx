'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { signUp, type ActionState } from '@/app/actions/auth'
import { GoogleButton } from '@/app/_components/GoogleButton'

const MARKETING = process.env.NEXT_PUBLIC_MARKETING_URL ?? 'https://www.tradingsocial.io'
const initial: ActionState = {}

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, initial)
  return (
    <div className="ts-authwrap">
      <div className="ts-card ts-card--auth">
        <p className="eyebrow">Join the beta</p>
        <h1 className="ts-h1 mt-3">Create your free profile</h1>
        <p className="ts-sub">Build your trading profile. Prove your edge. Climb the leaderboard.</p>

        <form action={action} className="mt-6 grid gap-3.5">
          <label className="ts-field">
            <span className="ts-label">Username</span>
            <input name="username" required className="ts-input" placeholder="yourname" />
          </label>
          <label className="ts-field">
            <span className="ts-label">Email</span>
            <input name="email" type="email" required className="ts-input" placeholder="you@email.com" />
          </label>
          <label className="ts-field">
            <span className="ts-label">Password</span>
            <input name="password" type="password" required className="ts-input" placeholder="At least 8 characters" />
          </label>
          <label className="ts-checkline">
            <input type="checkbox" name="terms" />
            <span>
              I agree to the{' '}
              <a href={`${MARKETING}/terms`} target="_blank" rel="noopener noreferrer">Terms</a>{' '}
              and{' '}
              <a href={`${MARKETING}/disclaimer`} target="_blank" rel="noopener noreferrer">financial disclaimer</a>.
              TradingSocial is an education and performance-tracking platform and does not provide
              financial advice.
            </span>
          </label>
          {state.error && <p className="ts-error">{state.error}</p>}
          <button disabled={pending} className="btn btn-primary btn-block">
            {pending ? 'Creating…' : 'Join the Beta'}
          </button>
        </form>

        <div className="ts-or">or</div>
        <GoogleButton />

        <p className="ts-sub text-center mt-5">
          Already have an account? <Link href="/login" style={{ color: 'var(--violet-br)', fontWeight: 600 }}>Log in</Link>
        </p>
      </div>
    </div>
  )
}
