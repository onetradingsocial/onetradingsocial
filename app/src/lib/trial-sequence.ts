/**
 * The three emails that go out DURING the 14-day Pro trial.
 *
 * Until this existed the trial was silent from start to finish. A user got the
 * welcome on day 0, then nothing for fourteen days, then `trialExpiredHtml`
 * telling them it was over — the notice migration 0049 added precisely because
 * 34 trials had already lapsed without a word. That fix told people afterwards.
 * Nobody was told during.
 *
 * `trialEndingHtml` looks like it should cover this and does not: its only call
 * site is lib/server/billing.ts, on the Stripe-trial path used by the referral
 * reward flow. The advertised trial takes no card and creates no Stripe
 * subscription, so that email can never fire for an ordinary signup.
 */

/** Days into the trial at which each email goes out. */
export const TRIAL_STAGES = [1, 7, 12] as const
export type TrialStage = (typeof TRIAL_STAGES)[number]

import { TRIAL_DAYS } from '@/lib/entitlements'

export type TrialStageInput = {
  /** Whole days since `trial_started_at`. */
  daysSinceStart: number
  /** Highest stage already sent, or null if none. */
  lastStageSent: number | null
}

/**
 * The stage due for this user right now, or null.
 *
 * Picks the HIGHEST stage the user has reached rather than the next one in
 * sequence. That matters for catch-up: a user who reaches day 9 with nothing
 * sent — a missed cron run, a deploy gap, or an account created before this
 * shipped — should get the day-7 message, not a "day one, here's how to start"
 * email nine days late. They then get the day-12 one on schedule. The cost is
 * that a skipped stage is skipped for good, which is the right trade: a stale
 * email is worse than a missing one.
 *
 * Returns null once the trial is over. The expiry notice is a different branch
 * with its own throttle (`last_trial_email`), and a day-12 "two days left"
 * email arriving after the trial ended would contradict it.
 */
export function dueTrialStage(o: TrialStageInput): TrialStage | null {
  if (o.daysSinceStart >= TRIAL_DAYS) return null
  const reached = [...TRIAL_STAGES].reverse().find((s) => o.daysSinceStart >= s)
  if (reached == null) return null
  if (o.lastStageSent != null && reached <= o.lastStageSent) return null
  return reached
}

/**
 * Whether a stage may be switched off by the user.
 *
 * Days 1 and 7 are engagement nudges and get a preference key like any other.
 * Day 12 is not: it is notice of an account-state change — Pro features are
 * about to stop — and 0049 established that a user may not switch off being
 * told their trial ended. The same reasoning applies two days before it does.
 */
export function trialStageIsOptional(stage: TrialStage): boolean {
  return stage !== 12
}
