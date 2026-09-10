import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logError } from '@/lib/server/log'

/**
 * The 14-day Pro trial's start-once latch.
 *
 * ── WHAT MOVED, AND WHY ──────────────────────────────────────────────────────
 *
 * 0041 stamped `trial_started_at` inside the signup trigger, in the same INSERT
 * that creates the profile row. So the clock started the instant the account
 * existed. That is correct only while email confirmation is off. The moment
 * `AUTH_EMAIL_CONFIRMATION` is switched on, a user who confirms three days
 * later has burned three of their fourteen days sitting in an inbox — the trial
 * they were sold measured from a moment they could not use the product.
 *
 * The rule this file implements is: **the trial starts the first time the
 * account has a session.** That is precisely "the account has been confirmed",
 * because a session is exactly what GoTrue withholds until confirmation:
 *
 *   confirmation OFF  → `signUp` returns a session → starts there, as today
 *   confirmation ON   → no session at signup; it arrives at `/auth/confirm`
 *   Google OAuth      → the session arrives at `/auth/callback`
 *
 * Writing it as "start it in /auth/confirm" would have been the obvious reading
 * of the requirement and would have been silently catastrophic: confirmation is
 * OFF in production, so nothing would ever have called it, and every new
 * account would have quietly landed on Free with no error to notice.
 *
 * ── WHY IT IS A LATCH, AND WHY THAT MATTERS FOR THE DEPLOY ───────────────────
 *
 * The write is filtered on `trial_started_at is null`, the same send-once idiom
 * `welcome_email_at` (0063), `trial_email_stage` (0064) and `ackTrial` already
 * use. Three consequences, all load-bearing:
 *
 *   1. It can never RESTART or EXTEND a trial. Every entry point below can fire
 *      more than once for the same account; each subsequent call matches zero
 *      rows instead of rolling the timestamp forward.
 *   2. Existing users cannot move. Their column is already non-null, so the
 *      filter excludes them without any date arithmetic or cohort test.
 *   3. **It is correct while the old trigger is still in place.** This is what
 *      lets the code ship BEFORE migration 0074 (the convention 0063, 0064 and
 *      0065 already document): with the trigger still stamping at INSERT, every
 *      call here finds the value set and does nothing. When 0074 removes the
 *      stamp, this becomes the only writer. There is no window in which a new
 *      account gets no trial.
 *
 * Concurrency falls out of the same filter: two calls racing (a duplicated
 * confirm click, a retried callback) both issue `update ... where
 * trial_started_at is null`, and Postgres serialises them on the row — the
 * second re-evaluates the predicate against the committed value and matches
 * nothing. One stamp, whoever wins.
 *
 * ── WHY THE SERVICE CLIENT ───────────────────────────────────────────────────
 *
 * 0042 deliberately withheld any `authenticated` grant on this column: a user
 * who can write it can push it into the future for a permanently 'active'
 * trial. Every caller here passes a service client, exactly as `ackTrial` does.
 *
 * ── WHAT THIS DOES NOT DECIDE ────────────────────────────────────────────────
 *
 * Whether a given session IS a signup. This function starts a trial for any
 * account that has never had one, which is only the right question to ask at a
 * point that is genuinely a first confirmation. `/auth/callback` is the LOGIN
 * path as well as the signup path, and `/auth/confirm` nominally accepts
 * `email_change` grants; both call sites make that judgement themselves (an
 * account-freshness test and an OTP-type test respectively) before calling in.
 * The reason is the cohort 0041's backfill deliberately SKIPPED — internal/seed
 * accounts and users who held a live subscription at the time. Those rows are
 * null forever by design, and arming a trial on one would eventually wall a
 * demo account or re-wall a churned subscriber, which is the exact outcome that
 * backfill exclusion existed to prevent.
 */

export type TrialStartOutcome =
  /** The stamp was written. This account's 14 days begin now. */
  | 'started'
  /** The account already had a trial. The normal case for every repeat call,
   *  and the ONLY case while the 0041 trigger is still stamping at signup. */
  | 'already_started'
  /** No profile row for a user who demonstrably has a session. Should be
   *  impossible — the signup trigger creates the row — so it is logged. */
  | 'no_row'
  /** The row exists, the column is still null, and our write matched nothing
   *  anyway; or the database errored. Logged. */
  | 'failed'

/**
 * Start the trial if it has never been started. Idempotent, and **never
 * throws** — the same contract `recordTermsAcceptance` and `trackOAuthSignup`
 * hold. Every caller sits on a signup or confirmation path, and a failure to
 * stamp a timestamp must never be the reason an account cannot be created or a
 * confirmation link cannot be redeemed.
 *
 * ── THE FAILURE THIS EXISTS TO MAKE LOUD ─────────────────────────────────────
 *
 * A new account that silently receives no trial does not throw, does not 500,
 * and does not show the user anything wrong — they simply see Free features and
 * assume that is the product. It would be found weeks later, in a conversion
 * number. So a zero-row write is not treated as "fine": it is re-read, and only
 * a genuinely non-null timestamp is accepted as the benign explanation. `no_row`
 * and a still-null column both reach `logError`, because at this point in the
 * code the caller is holding a live session for this user and there is no
 * innocent reading of either.
 */
export async function startTrialIfUnstarted(
  svc: SupabaseClient,
  userId: string,
  at: Date = new Date(),
): Promise<TrialStartOutcome> {
  try {
    const { error, count } = await svc
      .from('profiles')
      .update({ trial_started_at: at.toISOString() }, { count: 'exact' })
      .eq('id', userId)
      .is('trial_started_at', null)

    if (error) {
      logError('startTrial', error, { note: 'trial not started' })
      return 'failed'
    }
    if ((count ?? 0) > 0) return 'started'

    // Zero rows. Benign if the trial is already running — which is every call
    // before 0074 is applied — and an alarm otherwise. The two are
    // indistinguishable from the count alone, hence the re-read.
    const { data, error: readErr } = await svc
      .from('profiles')
      .select('trial_started_at')
      .eq('id', userId)
      .maybeSingle()

    if (readErr) {
      logError('startTrial', readErr, { note: 'could not confirm trial state' })
      return 'failed'
    }
    if (!data) {
      logError('startTrial', undefined, {
        note: 'no profile row for a user holding a session — this account has no trial',
      })
      return 'no_row'
    }
    if (!data.trial_started_at) {
      // The write matched nothing yet the column is null: a permission or RLS
      // problem on the column, not a race. A race would have left it non-null.
      logError('startTrial', undefined, {
        note: 'trial_started_at still null after a conditional write matched no rows',
      })
      return 'failed'
    }
    return 'already_started'
  } catch (err) {
    logError('startTrial', err, { note: 'trial not started' })
    return 'failed'
  }
}
