'use client'

import { useActionState } from 'react'
import { signUp, type ActionState } from '@/app/actions/auth'
import { GoogleButton } from '@/app/_components/GoogleButton'

const initial: ActionState = {}

export default function SignupPage() {
  const [state, action, pending] = useActionState(signUp, initial)
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-bold">Create your free profile</h1>
      <form action={action} className="mt-6 space-y-4">
        <input name="username" placeholder="Username" required
          className="w-full rounded border border-gray-300 px-3 py-2" />
        <input name="email" type="email" placeholder="Email" required
          className="w-full rounded border border-gray-300 px-3 py-2" />
        <input name="password" type="password" placeholder="Password (min 8)" required
          className="w-full rounded border border-gray-300 px-3 py-2" />
        <label className="flex items-start gap-2 text-sm text-gray-600">
          <input type="checkbox" name="terms" className="mt-1" />
          I agree to the Terms and financial disclaimer. TradingSocial is an education and
          performance-tracking platform and does not provide financial advice.
        </label>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending}
          className="w-full rounded bg-black py-2 font-medium text-white disabled:opacity-50">
          {pending ? 'Creating…' : 'Join the Beta'}
        </button>
      </form>
      <div className="my-4 text-center text-sm text-gray-400">or</div>
      <GoogleButton />
      <p className="mt-6 text-center text-sm text-gray-600">
        Already have an account? <a href="/app/login" className="underline">Log in</a>
      </p>
    </main>
  )
}
