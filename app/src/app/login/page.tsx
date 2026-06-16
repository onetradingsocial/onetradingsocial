'use client'

import { useActionState } from 'react'
import { signIn, type ActionState } from '@/app/actions/auth'
import { GoogleButton } from '@/app/_components/GoogleButton'

const initial: ActionState = {}

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial)
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-bold">Log in</h1>
      <form action={action} className="mt-6 space-y-4">
        <input name="email" type="email" placeholder="Email" required
          className="w-full rounded border border-gray-300 px-3 py-2" />
        <input name="password" type="password" placeholder="Password" required
          className="w-full rounded border border-gray-300 px-3 py-2" />
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending}
          className="w-full rounded bg-black py-2 font-medium text-white disabled:opacity-50">
          {pending ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <div className="my-4 text-center text-sm text-gray-400">or</div>
      <GoogleButton />
      <p className="mt-6 text-center text-sm text-gray-600">
        New here? <a href="/app/signup" className="underline">Create a profile</a>
      </p>
    </main>
  )
}
