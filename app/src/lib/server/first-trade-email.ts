import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, firstTradeHtml } from '@/lib/server/email'
import { logError, logWarn } from '@/lib/server/log'

type Outcome = 'win' | 'loss' | 'breakeven' | 'open'

/**
 * The first-logged-trade email — the reward for the activation moment.
 *
 * `first_trade_logged` is the event the funnel is built on
 * (lib/server/funnel.ts) and the one the referral programme pays out on
 * (`markReferralActivated`), and until this existed the product's entire
 * response to it was an analytics row. The user got nothing. The next contact
 * they were scheduled for was a trial nudge or, if they stopped, a recovery
 * email telling them they had gone quiet.
 *
 * So this is sent for its effect on the person, not for its content: it lands
 * within seconds of the insert, it is pleased with them, and it asks for
 * exactly one thing — the second trade — because one trade supports no
 * statistic and the whole product is statistics over the journal.
 *
 * SEND-ONCE, by the same latch-before-send rule as sendWelcomeEmail, and here
 * it is load-bearing rather than defensive. The caller's trigger is
 * `count === 1`, which is NOT a one-way door: a user who logs a trade, deletes
 * it and logs another is back at one, and without the latch they would be
 * congratulated on their first trade again. The stamp is claimed before the
 * send and conditioned on the row still being un-stamped, so concurrent calls
 * cannot both win and a missing provider cannot turn into repeat congratulation.
 * The corollary is accepted, as it is there: a send that fails after a
 * successful claim means this user is never congratulated. One lost joke beats
 * a loop.
 */
export async function sendFirstTradeEmail(
  svc: SupabaseClient,
  userId: string,
  email: string | null,
  trade: { instrument: string; direction: 'long' | 'short'; outcome: Outcome },
): Promise<{ sent: boolean; reason?: string }> {
  if (!email) return { sent: false, reason: 'no_address' }

  const { data: profile, error: readError } = await svc
    .from('profiles')
    .select('username, display_name, notification_prefs, first_trade_email_at')
    .eq('id', userId)
    .maybeSingle()

  if (readError || !profile) {
    // 42703 here means the code is deployed ahead of migration 0080. Warn, do
    // not send — the alternative is a congratulations email with nowhere to
    // record that it was sent.
    logWarn('sendFirstTradeEmail', readError?.message ?? 'no profile row', {
      note: 'first-trade email skipped (migration 0080 applied?)',
    })
    return { sent: false, reason: 'no_latch' }
  }

  if (profile.first_trade_email_at) return { sent: false, reason: 'already_sent' }

  // Same pref as the welcome email: this is a getting-started message, and a
  // user who turned those off has already said they do not want the product
  // cheering at them. Absent key = on, matching every other pref in the app.
  const prefs = (profile.notification_prefs ?? {}) as Record<string, boolean>
  if (prefs.getting_started === false) return { sent: false, reason: 'opted_out' }

  // Claim the send before making it.
  const { data: claimed, error: claimError } = await svc
    .from('profiles')
    .update({ first_trade_email_at: new Date().toISOString() })
    .eq('id', userId)
    .is('first_trade_email_at', null)
    .select('id')

  if (claimError) {
    logWarn('sendFirstTradeEmail', claimError.message, { note: 'could not claim first_trade_email_at' })
    return { sent: false, reason: 'no_latch' }
  }
  if (!claimed || claimed.length === 0) return { sent: false, reason: 'already_sent' }

  const name = profile.display_name || profile.username || 'there'
  const res = await sendEmail({
    to: email,
    subject: 'You logged a trade. Your journal has a pulse.',
    html: firstTradeHtml({
      name,
      instrument: trade.instrument,
      direction: trade.direction,
      outcome: trade.outcome,
    }),
  })

  if (!res.sent) {
    logError('sendFirstTradeEmail', res.error ?? 'unknown', {
      note: 'first-trade email stamped but not delivered — this user will not get it again',
      userId,
    })
  }
  return res.sent ? { sent: true } : { sent: false, reason: res.error ?? 'send_failed' }
}
