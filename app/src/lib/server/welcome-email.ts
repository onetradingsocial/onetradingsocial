import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, welcomeHtml } from '@/lib/server/email'
import { getTierMap } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { logError, logWarn } from '@/lib/server/log'

/**
 * The day-0 welcome email — the one lifecycle message that did not exist.
 *
 * Until this, the first thing TradingSocial ever sent a new account was an
 * inactivity nudge, earliest day 2 (MIN_ACCOUNT_AGE_DAYS in lib/recovery.ts).
 * The first contact from the product was a reminder that they had done nothing.
 *
 * WHERE THIS IS CALLED FROM, and why not the two obvious places:
 *
 *   * NOT api/cron/lifecycle-emails, which runs once a day at 13:00Z
 *     (vercel.json). A welcome email up to 24 hours late is not a welcome.
 *   * NOT app/auth/confirm, which is inert: it handles email confirmation, and
 *     confirmation is off until AUTH_EMAIL_CONFIRMATION is flipped in the
 *     Supabase dashboard. Hooking it there would have shipped a welcome email
 *     that never sends.
 *
 * It is called from saveOnboarding instead — the point where the account
 * genuinely exists AND `intended_source` has just been written (migration
 * 0062), which is what lets the copy route on what the user actually asked for
 * rather than on a guess.
 *
 * SEND-ONCE. The stamp is written BEFORE the send and conditioned on the row
 * still being un-stamped, so two concurrent calls cannot both win, and a
 * missing provider cannot turn into a user being welcomed again on every
 * attempt — the same rule the trial notice already follows. The corollary is
 * accepted deliberately: if the send fails after a successful stamp, that user
 * never gets a welcome. One lost welcome beats a loop.
 */
export async function sendWelcomeEmail(
  svc: SupabaseClient,
  userId: string,
  email: string | null,
): Promise<{ sent: boolean; reason?: string }> {
  if (!email) return { sent: false, reason: 'no_address' }

  // Everything the copy needs, plus the latch, in one read.
  const { data: profile, error: readError } = await svc
    .from('profiles')
    .select('username, display_name, intended_source, notification_prefs, welcome_email_at')
    .eq('id', userId)
    .maybeSingle()

  if (readError || !profile) {
    // 42703 here means the code is deployed ahead of migration 0063. Warn, do
    // not send: the alternative is welcoming the same user on every signup
    // attempt with nowhere to record that we did.
    logWarn('sendWelcomeEmail', readError?.message ?? 'no profile row', {
      note: 'welcome skipped (migration 0063 applied?)',
    })
    return { sent: false, reason: 'no_latch' }
  }

  if (profile.welcome_email_at) return { sent: false, reason: 'already_sent' }

  // Absent key = on, matching every other pref in the app. This gate exists for
  // the backfill rather than for new signups — nobody has set a preference
  // before they have an account — and the backfill is the case that mails
  // people who have been around long enough to have opinions.
  const prefs = (profile.notification_prefs ?? {}) as Record<string, boolean>
  if (prefs.getting_started === false) return { sent: false, reason: 'opted_out' }

  // Claim the send before making it.
  const { data: claimed, error: claimError } = await svc
    .from('profiles')
    .update({ welcome_email_at: new Date().toISOString() })
    .eq('id', userId)
    .is('welcome_email_at', null)
    .select('id')

  if (claimError) {
    logWarn('sendWelcomeEmail', claimError.message, { note: 'could not claim welcome_email_at' })
    return { sent: false, reason: 'no_latch' }
  }
  if (!claimed || claimed.length === 0) return { sent: false, reason: 'already_sent' }

  // Whether MT5 auto-sync is actually available to THIS account, resolved the
  // same way the settings page resolves it (getTierMap + flags + canFlag) so
  // the email and the page it links to can never disagree. Unknown tier is
  // treated as "cannot" — getTierMap omits a user on any read error, and the
  // failure we refuse to ship is a CTA pointing at an upgrade wall.
  let canAutosync = false
  try {
    const [tiers, flags] = await Promise.all([getTierMap([userId]), getFeatureFlags()])
    const tier = tiers.get(userId)
    canAutosync = tier ? canFlag(flags, tier, 'mt5_autosync') : false
  } catch (err) {
    logWarn('sendWelcomeEmail', err, { note: 'entitlement lookup failed; assuming no auto-sync' })
  }

  const name = profile.display_name || profile.username || 'there'
  const res = await sendEmail({
    to: email,
    subject: 'Welcome to TradingSocial — the one thing to do first',
    html: welcomeHtml({ name, intent: profile.intended_source ?? null, canAutosync }),
  })

  if (!res.sent) {
    logError('sendWelcomeEmail', res.error ?? 'unknown', {
      note: 'welcome stamped but not delivered — this user will not be welcomed again',
      userId,
    })
  }
  return res.sent ? { sent: true } : { sent: false, reason: res.error ?? 'send_failed' }
}
