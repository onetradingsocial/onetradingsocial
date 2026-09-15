import { TRIAL_DAYS, trialState } from '@/lib/entitlements'

/**
 * Which trial a user is on, across BOTH mechanisms.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * For the length of the grandfathering window two different trials are live at
 * once and they share no storage:
 *
 *   local   `profiles.trial_started_at` + `trial_ack_at`. No card, no Stripe
 *           object, expires into the Free plan. The ~7 real accounts mid-trial
 *           when the switch is flipped run these out.
 *   stripe  a `trialing` row in `subscriptions`, with `trial_start`/`trial_end`
 *           mirrored since 0076. A card IS on file and Stripe bills it at
 *           `trial_end`.
 *
 * Every consumer that used to read one column now has to answer "which trial,
 * and does a charge follow it" — and getting that wrong is not a cosmetic bug.
 * The lifecycle emails state, as their single most important claim, that no card
 * was taken and nothing can be charged. Sending that to a Stripe trialist is a
 * written promise not to charge someone we are about to charge.
 *
 * So the decision lives in one pure function rather than in each caller.
 *
 * ── WHY STRIPE WINS WHEN BOTH ARE PRESENT ────────────────────────────────────
 *
 * A grandfathered user who adds a card holds both at once. The Stripe window is
 * the one that ends in a charge, so it is the one every message must describe.
 * Picking the local window would produce exactly the false reassurance above.
 * This is a safety ordering, not a recency one: it holds even when the local
 * trial ends later.
 */

/** Which mechanism produced this window. */
export type TrialSource = 'local' | 'stripe'

export type TrialWindow = {
  source: TrialSource
  /** Epoch ms. */
  startedAt: number
  /** Epoch ms — when the trial converts (stripe) or lapses (local). */
  endsAt: number
  /**
   * Whether a payment method is on file and a charge follows this trial.
   *
   * Derived from the source, deliberately, rather than looked up per user: both
   * flows that can create a Stripe trial — the referral reward and the trial
   * checkout — set `payment_method_collection: 'always'`, so a Stripe trial in
   * this product always has a card behind it. A per-user Stripe lookup would be
   * one API call per row on a cron path, for an answer that is structural.
   *
   * IF A CARD-OPTIONAL STRIPE TRIAL IS EVER INTRODUCED, THIS IS THE LINE THAT
   * HAS TO CHANGE, and every "you will not be charged" string follows it.
   */
  cardOnFile: boolean
  /**
   * False when the subscription is already set to cancel at the end of its
   * trial, so no charge is coming after all. Always true for a local trial's
   * inverse — see `willCharge`.
   */
  cancelAtPeriodEnd: boolean
}

/** The fields this module needs from a mirrored subscription row. */
export type TrialSubRow = {
  status: string
  trial_start?: string | null
  trial_end?: string | null
  cancel_at_period_end?: boolean | null
}

/** Whether money actually moves when this window ends. */
export function willCharge(w: TrialWindow): boolean {
  return w.cardOnFile && !w.cancelAtPeriodEnd
}

/** Whole days remaining, rounded up, floored at 0. Mirrors `trialDaysLeft`'s
 *  convention so the two can never disagree by a day. */
export function windowDaysLeft(w: TrialWindow, now: Date): number {
  const remaining = w.endsAt - now.getTime()
  if (remaining <= 0) return 0
  return Math.ceil(remaining / (24 * 60 * 60 * 1000))
}

/** Whole days elapsed, floored — the value `dueTrialStage` expects. */
export function windowDaysElapsed(w: TrialWindow, now: Date): number {
  return Math.floor((now.getTime() - w.startedAt) / (24 * 60 * 60 * 1000))
}

const parse = (s: string | null | undefined): number | null => {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

/**
 * The Stripe trial window for a user, or null.
 *
 * Requires `status === 'trialing'` AND a real `trial_end`. The status check
 * alone is not enough: a row mirrored before 0076 has null trial columns, and
 * treating that as a window would give every field a NaN and silently place the
 * user at "day NaN" of their trial — which `dueTrialStage` answers with null, so
 * it would look like a user who is simply not due an email rather than like a
 * bug. Fail closed instead, and let the reconcile pass populate the columns.
 */
export function stripeTrialWindow(rows: TrialSubRow[] | null | undefined): TrialWindow | null {
  for (const r of rows ?? []) {
    if (r.status !== 'trialing') continue
    const endsAt = parse(r.trial_end)
    if (endsAt == null) continue
    // Stripe always sends trial_start alongside trial_end, but a row repaired
    // by an older reconcile pass may carry only one. Back-compute rather than
    // drop the window: the length is ours, not Stripe's, and a start that is
    // slightly off only shifts which nudge is due, never whether a charge is
    // disclosed.
    const startedAt = parse(r.trial_start) ?? endsAt - TRIAL_DAYS * 24 * 60 * 60 * 1000
    return {
      source: 'stripe',
      startedAt,
      endsAt,
      cardOnFile: true,
      cancelAtPeriodEnd: r.cancel_at_period_end === true,
    }
  }
  return null
}

/** The local trial window for a user, or null. Active only — an acked or
 *  never-started trial has no window. */
export function localTrialWindow(
  trialStartedAt: string | null | undefined,
  trialAckAt: string | null | undefined,
  now: Date,
): TrialWindow | null {
  if (trialState(trialStartedAt, trialAckAt, now) !== 'active') return null
  const startedAt = parse(trialStartedAt)
  if (startedAt == null) return null
  return {
    source: 'local',
    startedAt,
    endsAt: startedAt + TRIAL_DAYS * 24 * 60 * 60 * 1000,
    cardOnFile: false,
    cancelAtPeriodEnd: false,
  }
}

/**
 * The window that describes this user right now, across both mechanisms.
 *
 * Stripe first — see the header. Returns null when neither is running, which is
 * the answer for the overwhelming majority of accounts and must never be
 * confused with "day 0 of something".
 */
export function activeTrialWindow(
  profile: { trial_started_at?: string | null; trial_ack_at?: string | null },
  subs: TrialSubRow[] | null | undefined,
  now: Date,
): TrialWindow | null {
  const stripe = stripeTrialWindow(subs)
  if (stripe && now.getTime() < stripe.endsAt) return stripe
  return localTrialWindow(profile.trial_started_at, profile.trial_ack_at, now)
}
