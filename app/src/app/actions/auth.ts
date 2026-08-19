'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { validateUsername } from '@/lib/username'
import { trackServer } from '@/lib/server/track'
import { attributeReferral } from '@/lib/server/referral'
import { recordTermsAcceptance } from '@/lib/server/terms-acceptance'
import { passwordProblem, PASSWORD_MIN_LENGTH } from '@/lib/password'
import { RESET_REQUEST_MESSAGE } from '@/lib/auth-recovery'
import {
  allowAuthAttempt,
  LOGIN_BUDGET,
  RESET_BUDGET,
  SIGNUP_BUDGET,
} from '@/lib/server/auth-throttle'
import { logError } from '@/lib/server/log'

export type ActionState = {
  error?: string
  /** Neutral, non-error confirmation. Never varies with account existence. */
  notice?: string
  /** Login was refused because the address is unconfirmed — offer a resend. */
  unconfirmed?: boolean
}

/**
 * Is Supabase "Confirm email" switched on for this environment?
 *
 * It has to be a flag rather than something we infer, because a `signUp` that
 * returns no session is ambiguous: it means "confirm your email" when
 * confirmation is ON and "that address is already registered" when it is OFF,
 * and the two want opposite copy. Defaults to OFF, so deploying this code
 * changes nothing until the dashboard toggle is flipped in the same step.
 * See ws2-auth.md §"Ordered dashboard steps".
 */
function emailConfirmationEnabled(): boolean {
  return (process.env.AUTH_EMAIL_CONFIRMATION ?? '').toLowerCase() === 'on'
}

/**
 * Where GoTrue email links must come back to. Both paths are route handlers, so
 * the one-time token never touches a page that runs analytics. Both must be in
 * the Supabase Redirect URL allowlist or GoTrue silently falls back to the Site
 * URL — which is `/`, the page carrying all three pixels.
 */
function authRedirectUrl(path: '/auth/reset' | '/auth/confirm'): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.tradingsocial.io'
  return `${site.replace(/\/+$/, '')}${path}`
}

/** Supabase auth errors are implementation detail — "email rate limit exceeded"
 *  and `Email address "x@y" is invalid` tell a user nothing they can act on. Map
 *  the cases we know about to something actionable; the raw text stays in the
 *  server log so the real cause is never lost. */
function friendlyAuthError(raw: string, fallback: string): string {
  const m = raw.toLowerCase()
  if (m.includes('rate limit') || m.includes('too many requests') || m.includes('for security purposes')) {
    return 'Too many attempts right now. Please wait a minute and try again.'
  }
  if (m.includes('is invalid') && m.includes('email')) {
    return 'That email address was not accepted. Please try a different one.'
  }
  if (m.includes('already registered') || m.includes('already exists')) {
    return 'An account with this email already exists.'
  }
  if (m.includes('password should be') || m.includes('password is too short')) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  if (m.includes('leaked') || m.includes('pwned') || m.includes('compromised')) {
    return 'That password has appeared in a known data breach. Please choose a different one.'
  }
  if (m.includes('email not confirmed')) {
    return 'Please confirm your email address first — check your inbox for the link.'
  }
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) {
    return 'New sign-ups are paused right now. Please try again later.'
  }
  return fallback
}

const THROTTLED = 'Too many attempts. Please wait a few minutes and try again.'

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const username = String(formData.get('username') ?? '')
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const terms = formData.get('terms')

  // Wording tracks the checkbox label in SignupForm — the privacy policy is now
  // part of what the box accepts (audit item 4 finding 2).
  if (!terms) return { error: 'You must accept the terms, privacy policy and disclaimer.' }
  const v = validateUsername(username)
  if (!v.ok) return { error: v.error }
  // Item 9 F5: one shared policy, enforced here and mirrored (never replaced)
  // by the form. Checked before the throttle so a user fixing a weak password
  // does not burn signup attempts.
  const pwProblem = passwordProblem(password, [email, username])
  if (pwProblem) return { error: pwProblem }

  if (!(await allowAuthAttempt(SIGNUP_BUDGET, email))) return { error: THROTTLED }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username }, emailRedirectTo: authRedirectUrl('/auth/confirm') },
  })
  if (error) {
    logError('signUp', error.message)
    return { error: friendlyAuthError(error.message, 'Could not create your account. Please try again.') }
  }

  // An empty `identities` array is GoTrue's signal that the address is already
  // taken — with confirmation ON it hands back an obfuscated placeholder user
  // rather than an error, precisely so the caller cannot tell.
  const alreadyRegistered = !!data.user && (data.user.identities?.length ?? 0) === 0

  // Attribution and the funnel event run for a genuinely new account only. The
  // placeholder user carries a random id that matches no profile row, so
  // attributing against it would write nowhere and would fire a signup event
  // for a signup that did not happen.
  if (data.user && !alreadyRegistered) {
    // The consent above is enforced but was, until WS9, never written down:
    // the checkbox blocked the submit and then left no trace, so on any dispute
    // there was nothing to produce. Recorded here rather than in the form
    // because this is the point at which the acceptance was actually enforced.
    //
    // Deliberately BEFORE the email-confirmation branch below: the user ticked
    // the box and agreed now, whether or not they ever click the link. And
    // deliberately not awaited for its result — `recordTermsAcceptance` never
    // throws and never blocks a signup (see its comment block).
    await recordTermsAcceptance(createServiceClient(), data.user.id, 'signup_checkbox')

    // Attribution: the campaign/ref code captured by middleware sticks to the
    // profile at signup (service client: the trigger-created row is ours).
    const ref = (await cookies()).get('ts_ref')?.value ?? null
    if (ref) {
      const svc = createServiceClient()
      await svc.from('profiles')
        .update({ acquisition_source: ref.slice(0, 64) }).eq('id', data.user.id)
      // The same cookie doubles as a referral code when it matches one.
      await attributeReferral(svc, data.user.id, ref)
    }
    // `confirmed` distinguishes "in the funnel already" from "waiting on an
    // email click", which the funnel would otherwise read as a flat drop-off
    // the day confirmation is switched on.
    await trackServer('signup_completed', { id: data.user.id, email }, {
      method: 'email',
      source: ref,
      confirmed: !!data.session,
    })
  }

  // No session back means GoTrue is withholding one, for one of two reasons.
  if (!data.session) {
    if (emailConfirmationEnabled()) {
      // Item 9 F6: ONE response for "new account, confirm it" and "that address
      // already has an account". The email that lands tells the truth in both
      // cases; the web response leaks nothing. This is only honest while
      // confirmation is actually on — hence the flag rather than a guess.
      await stashPendingEmail(email)
      redirect('/check-email')
    }
    if (alreadyRegistered) {
      // Confirmation is OFF, so a neutral "check your inbox" would be a lie:
      // no email is sent in this case. Enumeration stays open until the
      // dashboard toggle lands. Recorded as an accepted risk in ws2-auth.md.
      return { error: 'An account with this email already exists.' }
    }
    // Confirmation is off and the account is new, yet GoTrue still withheld a
    // session — the project setting and our flag have drifted apart. Send the
    // user somewhere useful instead of to /welcome, which would bounce them
    // straight back to /login with no explanation.
    logError('signUp', undefined, { note: 'no session with AUTH_EMAIL_CONFIRMATION off — check the dashboard setting' })
    await stashPendingEmail(email)
    redirect('/check-email')
  }

  redirect('/welcome')
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  // Item 9 F10. On refusal we return the SAME string a wrong password returns,
  // so the throttle adds no oracle of its own — an attacker cannot use lockout
  // as a signal that the address is real or the password was close.
  if (!(await allowAuthAttempt(LOGIN_BUDGET, email))) {
    return { error: 'Invalid login credentials' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    logError('signIn', error.message)
    // "Email not confirmed" is only ever returned when the password was
    // CORRECT, so surfacing it discloses nothing an attacker did not already
    // have. Flagging it lets the form offer a resend link instead of a
    // dead end.
    if (/email not confirmed/i.test(error.message)) {
      await stashPendingEmail(email)
      return { error: friendlyAuthError(error.message, ''), unconfirmed: true }
    }
    // "Invalid login credentials" is already plain English and is the wording QA
    // signed the login flow off on, so it passes through untouched. Everything
    // else — rate limits, unconfirmed emails — gets mapped.
    if (/invalid login credentials/i.test(error.message)) return { error: error.message }
    return { error: friendlyAuthError(error.message, 'Could not log you in. Please try again.') }
  }

  redirect('/')
}

/**
 * Step 1 of password recovery (item 9 F1).
 *
 * Returns the identical `RESET_REQUEST_MESSAGE` on every path — address exists,
 * address does not exist, address is Google-only, GoTrue errored, we throttled
 * the caller. Any deviation is an account-existence oracle. The only thing that
 * varies is whether an email actually goes out, which the caller cannot see.
 */
export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim()

  // A malformed address cannot be a real account, so refusing it leaks nothing
  // — and it is the one case where silence would just be confusing.
  if (!email || !email.includes('@')) {
    return { error: 'Please enter a valid email address.' }
  }

  if (await allowAuthAttempt(RESET_BUDGET, email)) {
    const supabase = await createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: authRedirectUrl('/auth/reset'),
    })
    // Logged, never surfaced. A GoTrue rate-limit message shown to the user
    // would say "this address is real and we just tried to mail it".
    if (error) logError('requestPasswordReset', error.message)
    await trackServer('password_reset_requested', null, {})
  }

  return { notice: RESET_REQUEST_MESSAGE }
}

/**
 * Step 2 of password recovery (item 9 F1).
 *
 * Requires a real session — the recovery session minted by `/auth/reset`.
 * `getUser()` and not `getSessionUser()`: this is a mutation of a credential,
 * so it takes the authoritative server check, per the rule in
 * `lib/supabase/server.ts`.
 */
export async function updatePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'That reset link has expired. Please request a new one from the login page.' }
  }

  if (password !== confirm) return { error: 'The two passwords do not match.' }
  const problem = passwordProblem(password, [user.email])
  if (problem) return { error: problem }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    logError('updatePassword', error.message)
    return { error: friendlyAuthError(error.message, 'Could not update your password. Please try again.') }
  }

  // A password reset is the standard response to "someone else may have my
  // account", so every OTHER session is revoked at GoTrue. `scope: 'others'`
  // keeps the session in this browser alive so the user lands signed in rather
  // than being bounced to /login immediately after succeeding. Best-effort: a
  // failure here must not make a completed password change look failed.
  try {
    await supabase.auth.signOut({ scope: 'others' })
  } catch (e) {
    logError('updatePassword signOut others', e)
  }

  await trackServer('password_reset_completed', { id: user.id, email: user.email }, {})
  redirect('/?password=updated')
}

/**
 * Re-send the signup confirmation email (item 9 F2 support path).
 * Enumeration-safe in exactly the same way as `requestPasswordReset`.
 */
export async function resendConfirmation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim()
  if (!email || !email.includes('@')) {
    return { error: 'Please enter a valid email address.' }
  }

  if (await allowAuthAttempt(RESET_BUDGET, email)) {
    const supabase = await createClient()
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: authRedirectUrl('/auth/confirm') },
    })
    if (error) logError('resendConfirmation', error.message)
  }

  return {
    notice:
      'If that address needs confirming, a new link is on its way. ' +
      'The link expires in 1 hour — check your spam folder if it has not arrived in a few minutes.',
  }
}

/**
 * Carry the address to `/check-email` without putting it in a URL.
 *
 * httpOnly so no page script (and therefore no pixel) can read it, 30-minute
 * life, and it only ever prefills a form field the user typed themselves.
 */
async function stashPendingEmail(email: string): Promise<void> {
  try {
    ;(await cookies()).set('ts_pending_email', email.slice(0, 254), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * 60,
    })
  } catch {
    // Called from a context with a sealed cookie store; the page just shows an
    // empty field instead of a prefilled one.
  }
}
