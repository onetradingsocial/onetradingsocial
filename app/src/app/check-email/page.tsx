import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { CheckEmailForm } from './CheckEmailForm'

// Auth page: never indexed, but its links may be followed.
// SEO audit 2026-09-18, finding 3.
export const metadata: Metadata = {
  title: 'Confirm your email — TradingSocial',
  robots: { index: false, follow: true },
}

/**
 * "Check your inbox" landing for the email-confirmation flow (item 9 F2).
 *
 * Inert today: nothing routes here while `AUTH_EMAIL_CONFIRMATION` is off, so
 * this ships dark and lights up the moment the dashboard toggle and the env var
 * are flipped together.
 *
 * The address comes from an httpOnly cookie set by the action, never from a
 * query string — an email address in a URL ends up in access logs, Referer
 * headers and analytics paths, and this one belongs to an account that has not
 * even been confirmed yet.
 */
export default async function CheckEmailPage() {
  const email = (await cookies()).get('ts_pending_email')?.value ?? null
  return <CheckEmailForm email={email} />
}
