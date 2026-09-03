/**
 * Password-recovery token handling (item 9 F1).
 *
 * Pure — no Supabase, no next/*, no server-only. The route handler at
 * `/auth/reset` does nothing but call `parseRecoveryRequest` and act on the
 * result, so the whole decision surface is unit-testable.
 *
 * ── Why the callback is a ROUTE HANDLER and not a page ───────────────────────
 * A recovery grant is a bearer credential sitting in a URL. `app/layout.tsx`
 * mounts GoogleAnalytics + PageViewTracker on EVERY page, and `/` additionally
 * mounts the Meta and Reddit pixels. Meta's fbevents.js reports
 * `document.location.href` — fragment included. So any *page* that receives a
 * recovery token hands it to three third parties before we ever read it.
 *
 * A route handler renders no HTML, so no layout, no <Script>, no pixel and no
 * hydration ever occur on that path. The token is consumed server-side and the
 * browser is 303'd to `/reset-password` carrying nothing but a session cookie.
 * That is the whole reason this path exists separately from `/auth/callback`.
 *
 * ── Two grant shapes, deliberately both supported ────────────────────────────
 * `token_hash` (verifyOtp) is the shape we WANT and the one the email template
 * should emit: it is browser-independent, so a link opened in Gmail's in-app
 * browser or on a different device still works.
 *
 * `code` (PKCE, exchangeCodeForSession) is what the DEFAULT Supabase template
 * emits when the request was made by a PKCE client — which ours is, because
 * `@supabase/ssr` hardcodes `flowType: 'pkce'`. It only works in the browser
 * that requested the reset, because the code_verifier lives in that browser's
 * cookie. We accept it so the flow is not broken before the template is
 * changed, and we fail closed with an honest message when the verifier is
 * missing rather than showing a blank page.
 *
 * A third shape — `#access_token=...` in the URL fragment (implicit flow) — is
 * NOT handled here and must not be: a fragment never reaches the server. See
 * `recoveryGuardSource()` below for how that case is contained.
 */

export type RecoveryGrant =
  /** GoTrue one-time token hash -> supabase.auth.verifyOtp(). Browser-independent. */
  | { kind: 'otp'; tokenHash: string; type: OtpType }
  /** PKCE authorization code -> supabase.auth.exchangeCodeForSession(). Same-browser only. */
  | { kind: 'pkce'; code: string }
  /** GoTrue told us up front that the link is bad. Never attempt an exchange. */
  | { kind: 'error'; reason: RecoveryError }

export type OtpType = 'recovery' | 'invite' | 'signup' | 'email_change' | 'magiclink'
export type RecoveryError = 'expired' | 'missing' | 'denied'

const OTP_TYPES: readonly OtpType[] = ['recovery', 'invite', 'signup', 'email_change', 'magiclink']

/**
 * The one message the reset-request page is ever allowed to show (item 9 F6).
 *
 * Identical for "we just emailed you", "that address has no account", and
 * "that address is Google-only". Any branch here is an account-existence
 * oracle, and for a finance product that is a ready-made phishing target list.
 * The wording is chosen so it is not a lie in any of those cases: it promises
 * an email *if* an account exists, and promises nothing otherwise.
 */
export const RESET_REQUEST_MESSAGE =
  'If an account exists for that email address, a password reset link is on its way. ' +
  'The link expires in 1 hour — check your spam folder if it has not arrived in a few minutes.'

/**
 * Classify what (if anything) the `/auth/reset` request is carrying.
 * `url.searchParams` only — fragments are unreachable from the server.
 */
export function parseRecoveryRequest(url: URL): RecoveryGrant {
  const q = url.searchParams

  // GoTrue appends ?error=...&error_code=...&error_description=... when it
  // rejects the link itself (already used, expired, tampered). Reading this
  // first means we never burn a pointless exchange call.
  //
  // All three fields are inspected together, not the first one present: the
  // real payload is `error=access_denied&error_code=otp_expired&
  // error_description=Email+link+is+invalid+or+has+expired`, so keying off
  // `error` alone reports every expiry as a generic denial and shows the wrong
  // copy for by far the most common failure.
  const errorFields = [q.get('error'), q.get('error_code'), q.get('error_description')].filter(Boolean)
  if (errorFields.length) {
    const e = errorFields.join(' ').toLowerCase()
    return { kind: 'error', reason: e.includes('expired') ? 'expired' : 'denied' }
  }

  const tokenHash = q.get('token_hash') || q.get('token')
  if (tokenHash) {
    const raw = (q.get('type') || 'recovery').toLowerCase()
    const type = (OTP_TYPES as readonly string[]).includes(raw) ? (raw as OtpType) : 'recovery'
    return { kind: 'otp', tokenHash, type }
  }

  const code = q.get('code')
  if (code) return { kind: 'pkce', code }

  // Someone opened /auth/reset by hand, or a mail client stripped the query.
  return { kind: 'error', reason: 'missing' }
}

/** Where a failed grant sends the user, with copy they can act on. */
export function recoveryErrorRedirect(reason: RecoveryError): string {
  return `/forgot-password?error=${reason}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Implicit-flow fragment containment
// ─────────────────────────────────────────────────────────────────────────────

type GuardWindow = {
  location: { hash: string; pathname: string; search: string; replace(url: string): void }
  history: { replaceState(state: unknown, title: string, url: string): void }
}

/**
 * Strip a Supabase implicit-flow token out of the URL fragment before any
 * third-party script can read it. Runs as the first statement in <body>, i.e.
 * during HTML parse, ahead of hydration and ahead of every `afterInteractive`
 * <Script> (GA, Meta pixel, Reddit pixel).
 *
 * WHEN THIS FIRES: only when a recovery link was issued with no PKCE challenge
 * and no `token_hash` — in practice, the Supabase dashboard's "Send password
 * recovery" button against the default template. GoTrue then redirects to the
 * project Site URL with `#access_token=...&type=recovery`, which lands on `/`
 * — the one page carrying all three pixels.
 *
 * WHAT IT DOES: scrubs, then sends the user back to request a fresh link. It
 * deliberately does NOT try to consume the token. By the time this runs the
 * token has already been in a URL on a page we do not fully control, and we
 * cannot prove nothing read it — so the only correct posture is to treat it as
 * burned and issue a new one down the safe path. Salvaging it would mean
 * parking a live credential in sessionStorage to hand to a later component,
 * which trades a small usability win for a larger exposure.
 *
 * Returns whether it acted, purely so it can be asserted in tests.
 *
 * Exported as source text via `recoveryGuardSource()` — the function shipped to
 * the browser IS this function, so the tests exercise the real thing.
 */
export function scrubRecoveryHash(w: GuardWindow): boolean {
  const hash = w.location.hash || ''
  if (hash.indexOf('access_token=') < 0) return false

  // Order matters: rewrite the address bar first, navigate second. If the
  // navigation is slow or blocked, the fragment is already gone.
  w.history.replaceState(null, '', w.location.pathname + w.location.search)
  if (hash.indexOf('type=recovery') >= 0) {
    w.location.replace('/forgot-password?error=leaked')
  }
  return true
}

/**
 * The guard as an inline <script> body. Self-contained by construction — it
 * closes over nothing, so `toString()` survives bundling and minification.
 * Wrapped in try/catch: a guard that throws must never white-screen the app.
 */
export function recoveryGuardSource(): string {
  return `try{(${scrubRecoveryHash.toString()})(window)}catch(e){}`
}
