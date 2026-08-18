import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ResetPasswordForm } from './ResetPasswordForm'

/**
 * Step 2 of password recovery (item 9 F1). Reached only via `/auth/reset`,
 * which has already consumed the one-time token and minted a session — so this
 * page never sees a token in its own URL and there is nothing here for a
 * tracker to read.
 *
 * `getUser()`, not `getSessionUser()`: this page is the front door to a
 * credential mutation, so it takes the authoritative server check rather than a
 * locally-verified JWT.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // No session means the link was never consumed, or it expired between the
  // callback and here. Fail closed, back to the request page with copy that
  // explains it.
  if (!user) redirect('/forgot-password?error=expired')

  return <ResetPasswordForm email={user.email ?? null} />
}
