'use client'

import { createClient } from '@/lib/supabase/client'

export function GoogleButton() {
  async function signInWithGoogle() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app/auth/callback` },
    })
  }
  return (
    <button
      type="button"
      onClick={signInWithGoogle}
      className="w-full rounded border border-gray-300 py-2 font-medium hover:bg-gray-50"
    >
      Continue with Google
    </button>
  )
}
