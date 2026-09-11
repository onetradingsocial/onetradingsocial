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
 * ── THE HOLE THE THREE ENTRY POINTS LEFT, AND THE CHOKEPOINT THAT CLOSES IT ──
 *
 * GoTrue confirms the email inside its own `/verify` endpoint, BEFORE it
 * redirects to `/auth/confirm`. If the code exchange there then fails — the
 * ordinary case is "signed up on a laptop, clicked the email on a phone", where
 * the phone has no PKCE code-verifier cookie — the account is confirmed, has no
 * session, and has no trial. Its first session arrives later, by password
 * sign-in, by a password reset, or by a Google sign-in on an account that is no
 * longer "fresh". None of those were entry points, so the account sat on Free
 * forever with nothing logged. (Seen on dev 2026-09-11; production had one
 * such account within a day of 0074.)
 *
 * Rather than a fourth, fifth and sixth call site — each a place to forget the
 * next session route — `trialStartForSession` below runs where the server
 * already reads the trial fields for the signed-in user: `getEntitlements`,
 * which the root layout calls on every page render and every tier-gated action
 * calls too. Whatever route minted the session, the next thing the user sees is
 * a render, and that render passes through here. See that function for the
 * cost argument (no I/O at all for an account whose trial is set).
 *
 * ── THE GATE: `profiles.trial_eligible` (migration 0075) ─────────────────────
 *
 * "The trial is null" is NOT "this account should get a trial". The cohort
 * 0041's backfill deliberately SKIPPED — internal/seed accounts and users who
 * held a live subscription at the time — is null forever by design, and arming
 * a trial on one would eventually wall a demo account or re-wall a churned
 * subscriber. The three entry points dodged that with call-site tests (fresh
 * account, OTP type, "signUp returned a session"); a chokepoint on every render
 * cannot, because by construction it sees logins.
 *
 * So eligibility is a column, not an inference. 0075 adds it `false` for every
 * row that exists when it runs, then sets the column DEFAULT to `true`, so every
 * account created from then on is eligible without the signup trigger having to
 * name it; and it marks, as eligible, the accounts created after 0074 that are
 * still unstarted (the ones this bug stranded). The write below requires
 * `trial_eligible = true` in its WHERE clause, for EVERY caller — so a row the
 * migration marked `false` cannot be stamped by any path in this codebase,
 * whatever a call site believes. The call-site tests remain as a second gate.
 *
 * ── DEPLOY ORDER: EITHER IS SAFE, CODE FIRST IS THE CONVENTION ───────────────
 *
 * Until 0075 lands the column does not exist, and PostgREST fails a filter on
 * it with 42703. The two kinds of caller degrade differently, on purpose:
 *
 *   entry_point       → falls back to the pre-0075 write (no marker filter),
 *                       i.e. exactly today's behaviour, and logs that 0075 is
 *                       missing. These callers carry their own evidence that
 *                       this request IS the account's first session.
 *   observed_session  → does nothing. It has no evidence but the marker, so a
 *                       missing marker means "not eligible" — fail closed.
 *
 * So merging this before the migration changes nothing for anyone, and a
 * forgotten migration is loud in the logs rather than silent in a conversion
 * number.
 */

export type TrialStartOutcome =
  /** The stamp was written. This account's 14 days begin now. */
  | 'started'
  /** The account already had a trial. The normal case for every repeat call,
   *  and the ONLY case while the 0041 trigger is still stamping at signup. */
  | 'already_started'
  /** The row exists, has no trial, and is not marked `trial_eligible` — the
   *  0041-skipped cohort. Nothing is written. Logged only for an entry-point
   *  caller, which holds evidence that this is a brand-new account and so
   *  should never meet an ineligible row. */
  | 'ineligible'
  /** No profile row for a user who demonstrably has a session. Should be
   *  impossible — the signup trigger creates the row — so it is logged. */
  | 'no_row'
  /** The row exists, is eligible, the column is still null, and our write
   *  matched nothing anyway; or the database errored. Logged. */
  | 'failed'

/**
 * Who is asking, which decides how a missing `trial_eligible` column degrades
 * (see the deploy-order note above).
 *
 *   entry_point       — signUp with a session, a signup grant at /auth/confirm,
 *                       a fresh account at /auth/callback. The request itself
 *                       is evidence of a first session.
 *   observed_session  — the chokepoint: an authenticated user was seen. The
 *                       marker is the only evidence.
 */
export type TrialStartBasis = 'entry_point' | 'observed_session'

type LatchResult = { outcome: TrialStartOutcome; trialStartedAt: string | null }

/** PostgREST's answer to a filter or select naming a column that does not
 *  exist yet — i.e. this code is running ahead of migration 0075. Requires the
 *  column's name, so no other 42703 can be mistaken for it. */
function markerMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  return (err.code === '42703' || err.code === 'PGRST204') && /trial_eligible/.test(err.message ?? '')
}

/** The one write. `trial_started_at is null` makes it start-once; with the
 *  marker, `trial_eligible = true` makes the 0041-skipped cohort unreachable.
 *  `.is()` stays last: it is the call the fakes in the tests resolve on. */
function conditionalStamp(svc: SupabaseClient, userId: string, at: Date, withMarker: boolean) {
  let q = svc
    .from('profiles')
    .update({ trial_started_at: at.toISOString() }, { count: 'exact' })
    .eq('id', userId)
  if (withMarker) q = q.eq('trial_eligible', true)
  return q.is('trial_started_at', null)
}

async function latch(
  svc: SupabaseClient,
  userId: string,
  at: Date,
  basis: TrialStartBasis,
): Promise<LatchResult> {
  const none = (outcome: TrialStartOutcome): LatchResult => ({ outcome, trialStartedAt: null })
  try {
    let withMarker = true
    let { error, count } = await conditionalStamp(svc, userId, at, true)

    if (error && markerMissing(error)) {
      // Running ahead of 0075. See the deploy-order note at the top.
      if (basis === 'observed_session') return none('ineligible')
      logError('startTrial', error, {
        note: 'trial_eligible missing — migration 0075 not applied; falling back to the entry-point gate alone',
      })
      withMarker = false
      ;({ error, count } = await conditionalStamp(svc, userId, at, false))
    }

    if (error) {
      logError('startTrial', error, { note: 'trial not started', basis })
      return none('failed')
    }
    if ((count ?? 0) > 0) return { outcome: 'started', trialStartedAt: at.toISOString() }

    // Zero rows. Benign if the trial is already running (every repeat call) or
    // the account is one 0041 skipped on purpose; an alarm otherwise. The count
    // alone cannot tell those apart, hence the re-read.
    const { data, error: readErr } = await svc
      .from('profiles')
      .select(withMarker ? 'trial_started_at, trial_eligible' : 'trial_started_at')
      .eq('id', userId)
      .maybeSingle<{ trial_started_at: string | null; trial_eligible?: boolean | null }>()

    if (readErr) {
      logError('startTrial', readErr, { note: 'could not confirm trial state', basis })
      return none('failed')
    }
    if (!data) {
      logError('startTrial', undefined, {
        note: 'no profile row for a user holding a session — this account has no trial',
        basis,
      })
      return none('no_row')
    }
    if (data.trial_started_at) {
      return { outcome: 'already_started', trialStartedAt: data.trial_started_at }
    }
    if (withMarker && data.trial_eligible !== true) {
      // For the chokepoint this is the skipped cohort doing exactly what it
      // should (and is normally caught before any write — see
      // trialStartForSession). For an entry point it is a brand-new account
      // that the migration's column default failed to mark, which would be
      // every new account silently on Free: loud.
      if (basis === 'entry_point') {
        logError('startTrial', undefined, {
          note: 'first session for an account not marked trial_eligible — no trial started',
        })
      }
      return none('ineligible')
    }
    // Eligible, still null, and our write matched nothing: a permission or RLS
    // problem on the column, not a race. A race would have left it non-null.
    logError('startTrial', undefined, {
      note: 'trial_started_at still null after a conditional write matched no rows',
      basis,
    })
    return none('failed')
  } catch (err) {
    logError('startTrial', err, { note: 'trial not started', basis })
    return none('failed')
  }
}

/**
 * Start the trial if it has never been started — for the three ENTRY POINTS
 * (signUp with a session, /auth/confirm, /auth/callback). Idempotent, and
 * **never throws** — the same contract `recordTermsAcceptance` and
 * `trackOAuthSignup` hold. Every caller sits on a signup or confirmation path,
 * and a failure to stamp a timestamp must never be the reason an account cannot
 * be created or a confirmation link cannot be redeemed.
 *
 * ── THE FAILURE THIS EXISTS TO MAKE LOUD ─────────────────────────────────────
 *
 * A new account that silently receives no trial does not throw, does not 500,
 * and does not show the user anything wrong — they simply see Free features and
 * assume that is the product. It would be found weeks later, in a conversion
 * number. So a zero-row write is not treated as "fine": it is re-read, and only
 * a genuinely non-null timestamp is accepted as the benign explanation. `no_row`,
 * `ineligible` and a still-null column all reach `logError`, because at this
 * point the caller holds a first session for a new account and there is no
 * innocent reading of any of them.
 */
export async function startTrialIfUnstarted(
  svc: SupabaseClient,
  userId: string,
  at: Date = new Date(),
): Promise<TrialStartOutcome> {
  return (await latch(svc, userId, at, 'entry_point')).outcome
}

/**
 * The chokepoint. `getEntitlements` hands over what it already loaded and gets
 * back the `trial_started_at` it should compute the tier and gate from — the
 * loaded value, or the one just written, so the very render that starts the
 * trial already shows it (and a page's own tier read, racing the layout's,
 * starts or sees the same one). Never throws; returns the loaded value on any
 * failure.
 *
 * ── WHAT IT COSTS, BY ACCOUNT ────────────────────────────────────────────────
 *
 *   trial already set (every account after its first session, and every
 *   pre-0074 account 0041 did not skip)  → returns on the first line. No
 *   query, no write, no JWT check. This is the normal authenticated request.
 *
 *   trial null, caller is not that user's session (a cron's service client, a
 *   public profile reading its OWNER's tier)  → one local JWT check, nothing
 *   else. Starting a trial because someone else looked at your profile would
 *   violate the rule, so the session must be the account's own.
 *
 *   trial null, own session, not eligible (the 0041-skipped cohort)  → plus one
 *   single-row read of `trial_eligible`. Never a write. It stays in this state
 *   forever, so it pays that read on each tier lookup; it is a small cohort
 *   (internal/seed accounts, most of which never sign in) and a PK lookup.
 *
 *   trial null, own session, eligible  → one read and one conditional write,
 *   ONCE. After it the trial is set and the account is in the first row.
 *
 * Why the marker is read separately rather than added to getEntitlements'
 * profiles select: a column this code ships ahead of would fail that WHOLE
 * select with 42703 and degrade every user's tier to 'free' — the trap the
 * comment on that select already records. Here, a missing column only means
 * the chokepoint stays off.
 *
 * ── WHY `getClaims()` IS ENOUGH HERE ─────────────────────────────────────────
 *
 * `lib/supabase/server.ts` asks mutations to use `getUser()`. The difference is
 * revocation: a signed-out session's JWT still verifies until it expires. That
 * does not matter for this write. The rule is "the account has HAD a session",
 * and a validly signed access token for the account is proof GoTrue minted one
 * — revoked or not. The signature check (asymmetric keys, or GoTrue itself for
 * a symmetric project) is what stops a forged cookie from starting someone
 * else's trial, and it is not skipped.
 */
export async function trialStartForSession(
  svc: SupabaseClient,
  session: SupabaseClient,
  userId: string,
  loadedTrialStartedAt: string | null | undefined,
  at: Date = new Date(),
): Promise<string | null> {
  if (loadedTrialStartedAt) return loadedTrialStartedAt
  try {
    const { data: claims } = await session.auth.getClaims()
    if (claims?.claims?.sub !== userId) return null

    const { data, error } = await svc
      .from('profiles')
      .select('trial_eligible')
      .eq('id', userId)
      .maybeSingle<{ trial_eligible: boolean | null }>()
    if (error) {
      // Before 0075 the column is absent: the chokepoint is simply off.
      if (!markerMissing(error)) logError('trialStartForSession', error, { note: 'could not read trial_eligible' })
      return null
    }
    if (data?.trial_eligible !== true) return null

    return (await latch(svc, userId, at, 'observed_session')).trialStartedAt
  } catch (err) {
    logError('trialStartForSession', err, { note: 'trial not started' })
    return null
  }
}
