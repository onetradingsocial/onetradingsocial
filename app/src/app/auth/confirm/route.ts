import { type NextRequest } from 'next/server'
import { consumeGrant } from '@/lib/server/auth-grant'
import { createServiceClient } from '@/lib/supabase/service'
import { startTrialIfUnstarted } from '@/lib/server/trial-start'

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

/**
 * Which grants at this endpoint mean "a new account has just been confirmed",
 * and therefore start the 14-day Pro trial.
 *
 * NOT the full `expectTypes` list below. That list is defensively broad;
 * `email_change` and `magiclink` would both be a grant redeemed by an account
 * that already exists and has been using the product, and stamping a trial
 * there could arm the end-of-trial wall on someone 0041 deliberately left out
 * of the backfill (an internal/seed account, or a live subscriber) simply
 * because they changed their email address.
 *
 * A PKCE `code` carries no type at all, and is included: nothing in this
 * codebase issues a confirm-link for anything but a signup — `emailRedirectTo`
 * points here from `signUp` and from `resendConfirmation({ type: 'signup' })`
 * only, and no call to `updateUser({ email })` exists — so an untyped grant
 * arriving here is a signup confirmation. If an email-change flow is ever
 * added, it must not redirect to this route.
 *
 * Since 0075 this is the SECOND gate, not the only one. The latch's write also
 * requires `profiles.trial_eligible`, which is false for every account that
 * existed before 0075 without a trial, so even an email_change or magiclink
 * grant that got past this test could not arm the skipped cohort. And a grant
 * this test declines is not a lost trial for a genuinely new account: the
 * `/welcome` render that follows passes through the chokepoint in
 * getEntitlements (see lib/server/trial-start.ts), which starts it there.
 */
function grantStartsTrial(otpType: string | null): boolean {
  return otpType === null || otpType === 'signup' || otpType === 'invite'
}

export async function GET(request: NextRequest) {
  return consumeGrant(request, {
    successPath: '/welcome',
    expectTypes: ['signup', 'invite', 'magiclink', 'email_change'],
    label: 'auth/confirm',
    // The point of the whole change: with confirmation ON, this is the first
    // moment the account has a session, so this is when the 14 days start.
    // Idempotent and `is null`-filtered — see lib/server/trial-start.ts — so
    // while the 0041 trigger is still stamping at signup this is a no-op, and a
    // user who clicks the link twice gets one trial, not two.
    onSession: async ({ userId, otpType }) => {
      if (!userId || !grantStartsTrial(otpType)) return
      await startTrialIfUnstarted(createServiceClient(), userId)
    },
  })
}
