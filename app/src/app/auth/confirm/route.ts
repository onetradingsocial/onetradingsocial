import { type NextRequest } from 'next/server'
import { consumeGrant } from '@/lib/server/auth-grant'

/**
 * Email-confirmation callback (item 9 F2). Inert until "Confirm email" is
 * enabled in the Supabase dashboard — nothing links here before then — which is
 * exactly the deploy order wanted: the code that handles confirmation ships
 * first, the toggle flips second.
 *
 * Lands on `/welcome`, the same destination `signUp` uses, so a confirmed user
 * resumes the funnel rather than being dropped on a dead page. Middleware
 * bounces them to `/` if they have already finished onboarding.
 *
 * This path must be added to the Supabase Redirect URL allowlist:
 *   https://app.tradingsocial.io/auth/confirm
 */
export async function GET(request: NextRequest) {
  return consumeGrant(request, {
    successPath: '/welcome',
    expectTypes: ['signup', 'invite', 'magiclink', 'email_change'],
    label: 'auth/confirm',
  })
}
