/**
 * Who may open which checkout, decided from the account's subscription history.
 *
 * Checkout always CREATES a subscription. Before this module the route refused
 * only one state — a subscription currently `trialing` — and never looked at
 * anything that had already ended. Three things followed from that:
 *
 *   1. The signup trial was repeatable. Start it, cancel in the portal, let it
 *      lapse, post `flow: 'trial'` again: another 14 days of Pro at A$0, as many
 *      times as the customer liked. Terms §8 says "One free trial per person".
 *   2. Referral months were repeatable. The reward is re-derived from the count
 *      of activated referrals, and nothing recorded that months had been spent,
 *      so claim → cancel → claim handed out the same months again.
 *   3. A paying customer could be billed twice. `active` and `past_due` were not
 *      refused, so a second Checkout opened a second subscription beside the
 *      first — the double-billing the trialing guard was written to prevent.
 *
 * History comes from two places, merged by the route: the `subscriptions`
 * mirror (keyed by user, so it survives a re-minted customer) and Stripe's own
 * list for the customer (authoritative, and the only place `flow` and
 * `referral_months` are recorded). Stripe is the ledger for claimed referral
 * months precisely so this needs no new table and no manual migration.
 *
 * Pure on purpose: the route does the I/O, this decides.
 */

export type CheckoutFlow = 'referral' | 'trial_end' | 'trial' | undefined

export type PriorSubscription = {
  status: string
  /** Unix seconds or ISO string; either is accepted. Null when no trial. */
  trialStart: number | string | null
  trialEnd: number | string | null
  /** `subscription_data.metadata.flow` as stamped by checkout; null if unknown. */
  flow: string | null
  /** `metadata.referral_months`, stamped on referral claims from this change on. */
  referralMonths: string | null
}

/**
 * Every status in which a subscription still exists as far as billing is
 * concerned. Only `canceled` and `incomplete_expired` are finished; anything
 * else means a new Checkout would sit BESIDE it rather than replace it.
 * `incomplete` is included because Stripe may still complete it within 23h.
 */
const LIVE_STATUSES = new Set(['trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete'])

export const isLiveSubscription = (status: string) => LIVE_STATUSES.has(status)

const DAY_MS = 864e5

const toMs = (v: number | string | null): number | null => {
  if (v == null) return null
  if (typeof v === 'number') return v * 1000
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Months of referral reward already spent. Read from the stamped
 * `referral_months` where present; claims opened before the stamp existed are
 * counted from their trial length, which checkout set to exactly months × 30.
 * A claim counts in full once opened, even if cancelled on day one — the months
 * were issued, and counting partial use is what made the reward replayable.
 */
export function referralMonthsClaimed(subs: PriorSubscription[]): number {
  let total = 0
  for (const s of subs) {
    if (s.flow !== 'referral') continue
    const stamped = Number(s.referralMonths)
    if (Number.isInteger(stamped) && stamped > 0) { total += stamped; continue }
    const start = toMs(s.trialStart)
    const end = toMs(s.trialEnd)
    if (start != null && end != null && end > start) total += Math.max(1, Math.round((end - start) / DAY_MS / 30))
  }
  return total
}

export type Refusal = { status: 400 | 409; error: string; reason: string }

/**
 * Null when checkout may proceed; otherwise the response to return.
 *
 * `localTrialStarted` is the legacy card-free trial (`profiles.trial_started_at`).
 * It was a free trial, so under "one free trial per person" it spends the
 * trial just as a Stripe one does. Those accounts may still SUBSCRIBE — terms
 * §8 says so explicitly — they just cannot open a second free period.
 */
export function checkoutRefusal(input: {
  flow: CheckoutFlow
  subs: PriorSubscription[]
  localTrialStarted: boolean
}): Refusal | null {
  const { flow, subs, localTrialStarted } = input

  if (subs.some((s) => s.status === 'trialing')) {
    return {
      status: 409,
      reason: 'trial already in progress',
      error: 'A trial is already running on this account. Manage your plan in Settings → Billing.',
    }
  }
  if (subs.some((s) => isLiveSubscription(s.status))) {
    return {
      status: 409,
      reason: 'subscription already live',
      error: 'You already have a subscription. Change or manage it in Settings → Billing.',
    }
  }

  // Any earlier subscription disqualifies the signup trial, not only an earlier
  // trial: someone who has already paid for the product is not a new trialist.
  if (flow === 'trial' && (localTrialStarted || subs.length > 0)) {
    return {
      status: 409,
      reason: 'trial already used',
      error: 'This account has already had its free trial. You can subscribe from Settings → Billing.',
    }
  }
  return null
}

/** Referral months still available to claim, never negative. */
export function referralMonthsAvailable(earned: number, subs: PriorSubscription[]): number {
  return Math.max(0, earned - referralMonthsClaimed(subs))
}
