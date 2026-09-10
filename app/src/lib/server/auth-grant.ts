import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseRecoveryRequest, recoveryErrorRedirect, type OtpType } from '@/lib/auth-recovery'
import { logError } from '@/lib/server/log'

/**
 * Shared body of the two GoTrue email-link callbacks, `/auth/reset` and
 * `/auth/confirm` (item 9 F1, F2).
 *
 * Both are ROUTE HANDLERS rather than pages, and that is the whole point:
 * `app/layout.tsx` mounts GoogleAnalytics + PageViewTracker on every *page*,
 * and `/` additionally mounts the Meta and Reddit pixels — Meta's fbevents.js
 * reports `document.location.href`. A route handler renders no HTML, so no
 * layout, no <Script>, no pixel and no hydration ever run on these paths. The
 * one-time token is consumed server-side and the browser is redirected with a
 * session cookie and a clean URL.
 *
 * Same-origin idiom as `auth/callback/route.ts`: the destination is built from
 * the origin the request arrived at and a caller-supplied literal, never from a
 * `next`/`redirect` query param, so no open redirect exists here either.
 */
export type GrantedSession = {
  /** The account the grant belonged to. Null if GoTrue returned no user. */
  userId: string | null
  /** The OTP type that was redeemed, or null for a PKCE code — the code
   *  carries no type, so a caller that must distinguish signup from
   *  email_change has to treat null as "unknown" and decide accordingly. */
  otpType: OtpType | null
}

export async function consumeGrant(
  request: NextRequest,
  opts: {
    successPath: string
    expectTypes: readonly OtpType[]
    label: string
    /**
     * Runs once the grant has been redeemed and a session exists, before the
     * redirect. Added so `/auth/confirm` can start the Pro trial at the moment
     * of confirmation (see lib/server/trial-start.ts); `/auth/reset` passes
     * nothing and is unaffected.
     *
     * MUST NOT THROW — a redemption that succeeded must still land the user on
     * `successPath`. Wrapped here as well, so a careless caller cannot turn a
     * working confirmation link into an error page.
     */
    onSession?: (granted: GrantedSession) => Promise<void>
  },
): Promise<NextResponse> {
  const url = new URL(request.url)
  const base = url.origin
  const grant = parseRecoveryRequest(url)

  if (grant.kind === 'error') {
    return NextResponse.redirect(`${base}${recoveryErrorRedirect(grant.reason)}`)
  }

  // A recovery token must not be redeemable at the confirm endpoint or vice
  // versa: the two land the user in different places with different
  // assumptions about what they are allowed to do next.
  if (grant.kind === 'otp' && !opts.expectTypes.includes(grant.type)) {
    return NextResponse.redirect(`${base}${recoveryErrorRedirect('denied')}`)
  }

  const supabase = await createClient()
  let userId: string | null = null

  if (grant.kind === 'otp') {
    // The shape the email templates should use: browser-independent, so a link
    // opened on a different device from the one that requested it still works.
    const { data, error } = await supabase.auth.verifyOtp({
      type: grant.type,
      token_hash: grant.tokenHash,
    })
    if (error) {
      logError(`${opts.label} verifyOtp`, error.message)
      return NextResponse.redirect(`${base}${recoveryErrorRedirect('expired')}`)
    }
    userId = data.user?.id ?? null
  } else {
    // PKCE. Only succeeds in the browser that made the request, because the
    // code_verifier lives in that browser's cookie. A cross-device click fails
    // here and gets the honest "ask for a new link" page rather than a blank
    // screen — the same fail-closed shape as auth/callback.
    const { data, error } = await supabase.auth.exchangeCodeForSession(grant.code)
    if (error) {
      logError(`${opts.label} exchangeCodeForSession`, error.message)
      return NextResponse.redirect(`${base}${recoveryErrorRedirect('expired')}`)
    }
    userId = data.user?.id ?? null
  }

  if (opts.onSession) {
    try {
      await opts.onSession({ userId, otpType: grant.kind === 'otp' ? grant.type : null })
    } catch (e) {
      // The grant has already been redeemed at this point; the token is spent
      // and the session cookie is set. Bouncing the user to "ask for a new
      // link" would be a lie AND unrecoverable.
      logError(`${opts.label} onSession`, e)
    }
  }

  // 303 so the browser continues with a GET. Nothing but the session cookie
  // crosses this hop — no token, no query string.
  return NextResponse.redirect(`${base}${opts.successPath}`, 303)
}
