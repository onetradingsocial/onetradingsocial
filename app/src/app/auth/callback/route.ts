import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { recordTermsAcceptance } from '@/lib/server/terms-acceptance'
import { trackOAuthSignup, isFreshAccount } from '@/lib/server/oauth-signup'
import { startTrialIfUnstarted } from '@/lib/server/trial-start'

export async function GET(request: NextRequest) {
  // Same-origin hops, so stay on the origin the callback arrived at rather than
  // bouncing to whatever NEXT_PUBLIC_SITE_URL happens to say (see signout).
  const { searchParams, origin: base } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${base}/login?error=oauth`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${base}/login?error=oauth`)
  }

  // Decided once, with the same clock the trial latch and the funnel event use
  // below, so the destination can never disagree with them about whether this
  // callback was the signup.
  const now = Date.now()
  const isSignup = !!data.user && isFreshAccount(data.user.created_at, now)

  // Record the passive consent given to `OAuthLegalNotice`, which sits directly
  // beneath the Google button on /signup and /login — the only two places
  // `GoogleButton` is rendered, so there is no way into this callback that did
  // not pass the notice. WS6 shipped the disclosure; this is the record.
  //
  // Two things this deliberately does NOT do:
  //
  //   - It does not distinguish signup from login, because the callback cannot
  //     see which page the user came from. It does not need to: the notice is
  //     identical on both, so the fact recorded — "this person was shown these
  //     three documents and continued" — is true either way. The write is
  //     `is null`-filtered, so only the first such moment is kept.
  //   - It does not backfill. An account from before WS6 stays null until its
  //     owner next signs in with Google and passes the notice themselves; that
  //     is a real, contemporaneous acceptance, not a fabricated one. Nothing is
  //     ever written for a user who does not come back.
  //
  // Never throws and never blocks the redirect (see recordTermsAcceptance).
  if (data.user) {
    const svc = createServiceClient()
    await recordTermsAcceptance(svc, data.user.id, 'oauth_notice')

    // The third entrance to the trial. Google is the one path where the session
    // and the account are born in the same request, so there is no confirmation
    // gap to close — but it still has to be wired, or switching the trial start
    // over to "first session" would leave every Google signup on Free. (This is
    // the same omission `signup_completed` had until last week, one function
    // down this file.)
    //
    // Gated on `isFreshAccount` for the reason `trackOAuthSignup` documents:
    // /auth/callback is the LOGIN path too, and it cannot see which page sent
    // the user. Without the test, a returning Google user whose
    // `trial_started_at` is null would have a trial armed on sign-in — and the
    // accounts that are null are precisely the ones 0041's backfill skipped on
    // purpose (internal/seed accounts, and users holding a live subscription),
    // so the wall would eventually land on a demo account or on a subscriber
    // who churned. The latch's `is null` filter alone does not cover that; the
    // freshness test is what makes this "the signup" rather than "a login".
    //
    // Since 0075 the latch's write also requires `profiles.trial_eligible`,
    // false for every pre-0075 account without a trial, so this test is now
    // the second gate rather than the only one. A NON-fresh account that has
    // never had a session (confirmed on another device, then chose Google) is
    // not lost either: the render this redirect leads to passes through the
    // chokepoint in getEntitlements, which starts an eligible account's trial.
    if (isSignup) {
      await startTrialIfUnstarted(svc, data.user.id)
    }

    // The funnel's other entrance. `signup_completed` used to be emitted only
    // by the email/password action, so every Google signup was missing from
    // /admin/analytics — see lib/server/oauth-signup.ts for why this is
    // conditional rather than a plain emit, and for the props.
    //
    // `ts_ref` is the campaign cookie middleware sets; it is read here for the
    // event prop only. NOTE (left deliberately, not part of this fix): unlike
    // the email path, the OAuth path never writes it to
    // `profiles.acquisition_source`, so the "Signups by source" table on the
    // same page still cannot attribute a Google signup.
    await trackOAuthSignup(svc, data.user, {
      source: request.cookies.get('ts_ref')?.value ?? null,
      confirmed: !!data.session,
      // Same clock as the freshness test above, so the event and the trial can
      // never disagree about whether this callback was the signup.
      now,
    })
  }

  // A Google signup lands where an email signup does: /welcome, the only screen
  // that offers the card-backed trial (Sign up → Trial → Onboarding). This used
  // to redirect every callback to `/`, which middleware forwards to /onboarding,
  // and once onboarding is done middleware bars /welcome for good — so from
  // 2026-09-15, when the trial moved behind that screen, no Google signup was
  // ever offered it. Four of the first seven signups after the switch were
  // Google; none reached /welcome.
  //
  // A returning user still goes home. A NON-fresh account that never finished
  // onboarding also goes to `/`, and middleware resumes it at /onboarding.
  if (isSignup) return NextResponse.redirect(`${base}/welcome`)
  return NextResponse.redirect(`${base}/`)
}
