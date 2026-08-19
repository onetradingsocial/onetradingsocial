import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { recordTermsAcceptance } from '@/lib/server/terms-acceptance'

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
    await recordTermsAcceptance(createServiceClient(), data.user.id, 'oauth_notice')
  }

  // New Google users have onboarding_completed=false; middleware sends them to onboarding.
  return NextResponse.redirect(`${base}/`)
}
