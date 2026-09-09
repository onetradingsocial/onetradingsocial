import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { trackServer } from '@/lib/server/track'

/**
 * `signup_completed` for the OAuth path.
 *
 * The event had exactly one emitter — the email/password `signUp` action — so
 * every Google signup was invisible to the funnel. Measured over the audited
 * 30-day window: 11 genuine profiles, 4 email and 7 Google, and the event fired
 * 4 times. That one gap produced both of the impossible numbers on
 * /admin/analytics (a 225% onboarding completion rate, and "11 new users" next
 * to "4 signups"), because every bar below it was measured against a
 * denominator that only ever counted one of the two ways in.
 *
 * ── Why the callback cannot simply fire on arrival ──────────────────────────
 *
 * /auth/callback is the LOGIN path as well as the signup path — it is reached
 * from the Google button on both /login and /signup, and it cannot see which
 * one sent the user (the same reason `recordTermsAcceptance` there does not
 * distinguish them). Firing unconditionally would emit a signup for every
 * returning Google user, which is a worse number than none: the funnel counts
 * rows, so a daily user would report a signup a day.
 *
 * Two conditions, both required:
 *
 *   1. The account was created moments ago. GoTrue creates the user during the
 *      code exchange that this callback is handling, so on a genuine signup
 *      `created_at` is seconds old; on a login it is however old the account
 *      is. This is the test that keeps pre-existing accounts — including every
 *      Google account that signed up before this code shipped — from being
 *      backfilled into the current window as fresh signups.
 *   2. No `signup_completed` row exists for the user yet. Cheap insurance
 *      against a second callback inside the window (sign out, sign straight
 *      back in), which the clock test alone would let through and the funnel
 *      would count twice.
 */

/** How new the account must be for this callback to be the signup itself.
 *  Generous: the exchange happens seconds after creation, and the only cost of
 *  slack is a returning user who deleted and recreated an account inside it. */
export const OAUTH_SIGNUP_WINDOW_MS = 5 * 60_000

/** Tolerance for the Postgres clock running ahead of the Node clock. Without
 *  it a small forward skew makes `now - created` negative and the account reads
 *  as "not new" — failing closed on the very signups this exists to count. */
const CLOCK_SKEW_MS = 60_000

export function isFreshAccount(createdAt: string | null | undefined, now: number): boolean {
  if (!createdAt) return false
  const t = Date.parse(createdAt)
  if (!Number.isFinite(t)) return false
  const age = now - t
  return age <= OAUTH_SIGNUP_WINDOW_MS && age >= -CLOCK_SKEW_MS
}

export type OAuthUser = {
  id: string
  email?: string | null
  created_at?: string | null
  app_metadata?: { provider?: string | null } | null
}

/**
 * Emits `signup_completed` if — and only if — this callback IS the signup.
 * Returns whether it fired, which is what the tests assert on; the caller
 * ignores it. Like `trackServer` and `recordTermsAcceptance`, it never throws:
 * the sign-in redirect must not fail because an analytics row did.
 *
 * Props deliberately mirror the email path (`actions/auth.ts`) so both are
 * queryable together: `method` (the discriminator — the provider name, so a
 * second provider does not need a schema decision), `source` (the ts_ref
 * campaign cookie) and `confirmed` (a session in hand rather than a pending
 * email click; OAuth always has one, and it is recorded rather than assumed so
 * the two paths read the same way).
 */
export async function trackOAuthSignup(
  svc: SupabaseClient,
  user: OAuthUser,
  opts: { source: string | null; confirmed: boolean; now?: number },
): Promise<boolean> {
  try {
    const now = opts.now ?? Date.now()
    if (!isFreshAccount(user.created_at, now)) return false

    const { data: existing } = await svc
      .from('analytics_events')
      .select('id')
      .eq('event', 'signup_completed')
      .eq('user_id', user.id)
      .limit(1)
    if ((existing ?? []).length > 0) return false

    await trackServer('signup_completed', { id: user.id, email: user.email }, {
      method: user.app_metadata?.provider || 'oauth',
      source: opts.source,
      confirmed: opts.confirmed,
    })
    return true
  } catch {
    return false
  }
}
