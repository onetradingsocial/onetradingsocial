import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { ForgotPasswordForm } from './ForgotPasswordForm'

export const metadata: Metadata = { title: 'Reset your password — TradingSocial' }

/**
 * Step 1 of password recovery (item 9 F1).
 *
 * Deliberately carries NO Meta/Reddit pixel, unlike `/login` and `/signup`.
 * This page and `/reset-password` sit either side of a credential handoff, and
 * the fewer third-party scripts in that corridor the better. The root layout's
 * GA is unavoidable but sends `location.pathname` only
 * (`_components/PageViewTracker.tsx`, `send_page_view: false` in
 * `_components/GoogleAnalytics.tsx`), and no token ever reaches this URL.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Already signed in — including the moment right after `/auth/reset` minted
  // the recovery session. There is nothing to email; go straight to setting the
  // new password. `/settings` would be a dead end: it has no change-password
  // control, so this page is also the only way a signed-in user can change one.
  if (user) redirect('/reset-password')

  const { error } = await searchParams
  return <ForgotPasswordForm linkError={error} />
}
