'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { signIn, type ActionState } from '@/app/actions/auth'
import { GoogleButton } from '@/app/_components/GoogleButton'

const initial: ActionState = {}

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial)
  return (
    <div className="ts-authwrap">
      <div className="ts-card ts-card--auth">
        <p className="eyebrow">Welcome back</p>
        <h1 className="ts-h1 mt-3">Log in</h1>
        <p className="ts-sub">Track. Prove. Improve your trading.</p>

        <form action={action} className="mt-6 grid gap-3.5">
          <label className="ts-field">
            <span className="ts-label">Email</span>
            <input name="email" type="email" required className="ts-input" placeholder="you@email.com" />
          </label>
          <label className="ts-field">
            <span className="ts-label">Password</span>
            <input name="password" type="password" required className="ts-input" placeholder="••••••••" />
          </label>
          {state.error && <p className="ts-error">{state.error}</p>}
          <button disabled={pending} className="btn btn-primary btn-block">
            {pending ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <div className="ts-or">or</div>
        <GoogleButton />

        <p className="ts-sub text-center mt-5">
          New here? <Link href="/signup" style={{ color: 'var(--violet-br)', fontWeight: 600 }}>Create a profile</Link>
        </p>
      </div>
    </div>
  )
}
