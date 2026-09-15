import { planForPrice, TRIAL_DAYS, type PlanEnv, type Tier } from '@/lib/entitlements'

/** Structural, NOT `Stripe.Subscription`, and deliberately so.
 *
 *  getStripe() pins no apiVersion, so the payload shape is whatever the Stripe
 *  account's default API version emits — which is not necessarily the version
 *  the installed stripe-node types describe. Matching structurally on the few
 *  fields we actually read keeps this module honest under either, and keeps it
 *  pure so it is unit-testable without a Stripe client. */
type StripeSubLike = {
  id: string
  status: string
  cancel_at_period_end: boolean
  trial_start?: number | null
  trial_end?: number | null
  metadata?: Record<string, string> | null
  default_payment_method?: string | { id: string } | null
  default_source?: string | { id: string } | null
  items: {
    data: Array<{
      price: {
        id: string
        unit_amount?: number | null
        currency?: string | null
        recurring?: { interval?: string | null } | null
      }
      current_period_end?: number | null
    }>
  }
}

export type SubscriptionRow = {
  id: string
  status: string
  tier: Tier
  price_id: string
  current_period_end: string | null
  cancel_at_period_end: boolean
  /** Stripe's trial window, mirrored since 0076. NULL for a subscription that
   *  never had a trial — which is every ordinary purchase.
   *
   *  `trial_end` is NOT interchangeable with `current_period_end`. They are
   *  equal while the subscription is `trialing`, and then diverge permanently:
   *  on conversion Stripe advances the period to the next billing date and the
   *  trial boundary is gone. Anything asking "when did/does the trial end" must
   *  read this, not the period. */
  trial_start: string | null
  trial_end: string | null
}

/** Stripe sends its timestamps as epoch SECONDS. Null-safe, and NaN-safe: a
 *  malformed value becomes null rather than an `Invalid Date` that would
 *  serialise as null anyway but throw on the way there. */
function epochToIso(s: number | null | undefined): string | null {
  if (s == null || !Number.isFinite(s)) return null
  return new Date(s * 1000).toISOString()
}

/** Pure map from a Stripe subscription to a mirror row. Null when the price is
 *  not one of ours (caller should ack 200 and skip, not error). */
export function subscriptionRow(sub: StripeSubLike, env: PlanEnv): SubscriptionRow | null {
  const item = sub.items?.data?.[0]
  const priceId = item?.price?.id
  if (!priceId) return null
  const plan = planForPrice(priceId, env)
  if (!plan) return null
  return {
    id: sub.id,
    status: sub.status,
    tier: plan.tier,
    price_id: priceId,
    current_period_end: item?.current_period_end
      ? new Date(item.current_period_end * 1000).toISOString()
      : null,
    cancel_at_period_end: sub.cancel_at_period_end,
    trial_start: epochToIso(sub.trial_start),
    trial_end: epochToIso(sub.trial_end),
  }
}

/* ── Money ────────────────────────────────────────────────────────────────── */

/** Currencies Stripe quotes in whole units rather than hundredths. Short list
 *  on purpose — we sell in AUD; this exists so a currency change can never
 *  silently divide a ¥5000 charge into ¥50. */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'])

/** Stripe minor units → the display convention the rest of the product uses
 *  (`A$50`, per lib/plans.ts). Not Intl.NumberFormat: this string is rendered
 *  into email HTML on a server whose locale we do not control, and `A$` must
 *  survive verbatim. Returns null for a missing amount so callers can choose
 *  their own fallback copy rather than printing "A$0". */
export function formatStripeAmount(minor: number | null | undefined, currency: string | null | undefined): string | null {
  if (minor == null || !Number.isFinite(minor)) return null
  const code = (currency ?? 'aud').toLowerCase()
  const major = ZERO_DECIMAL.has(code) ? minor : minor / 100
  const digits = ZERO_DECIMAL.has(code) ? 0 : (Number.isInteger(major) ? 0 : 2)
  const n = major.toFixed(digits)
  return code === 'aud' ? `A$${n}` : `${code.toUpperCase()} ${n}`
}

/* ── invoice.payment_failed ───────────────────────────────────────────────── */

/** Same rationale as StripeSubLike. `invoice.subscription` was moved to
 *  `invoice.parent.subscription_details.subscription` in the 2025 API versions;
 *  both are read so this works whichever version the account is pinned to. */
export type StripeInvoiceLike = {
  id?: string | null
  amount_due?: number | null
  currency?: string | null
  attempt_count?: number | null
  next_payment_attempt?: number | null
  hosted_invoice_url?: string | null
  billing_reason?: string | null
  subscription?: string | { id: string } | null
  parent?: {
    subscription_details?: { subscription?: string | { id: string } | null } | null
  } | null
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null
  return typeof v === 'string' ? v : (v.id ?? null)
}

/** The subscription an invoice belongs to, across both API shapes. Null for a
 *  one-off invoice, which is not our concern. */
export function invoiceSubscriptionId(inv: StripeInvoiceLike): string | null {
  return idOf(inv.subscription) ?? idOf(inv.parent?.subscription_details?.subscription) ?? null
}

export type PaymentFailure = {
  subscriptionId: string
  invoiceId: string | null
  /** Which retry this was. 1 = the first failure. */
  attempt: number
  /** Stripe has no further automatic attempts scheduled: this is the last word. */
  final: boolean
  amount: string | null
  invoiceUrl: string | null
  /** Whether we should email on THIS delivery — see below. */
  notify: boolean
}

/** Pure read of an `invoice.payment_failed` payload.
 *
 *  Null for anything not tied to a subscription (one-off invoices), so the
 *  webhook can ack and move on.
 *
 *  `notify` is the dunning cadence, and it is deliberately NOT "every failure".
 *  Stripe retries a failed renewal several times over about three weeks and
 *  fires this event on each one; emailing every time trains the customer to
 *  ignore us. We send exactly twice:
 *    * the FIRST failure — "your payment didn't go through, here's how to fix
 *      it, you keep your access meanwhile"; and
 *    * the LAST attempt (`next_payment_attempt === null`) — "final notice,
 *      access ends".
 *  A single-attempt failure is both at once, and `final` lets the template say
 *  so. attempt_count is absent on some older payloads; treat that as attempt 1
 *  rather than dropping the notice entirely. */
export function paymentFailure(inv: StripeInvoiceLike): PaymentFailure | null {
  const subscriptionId = invoiceSubscriptionId(inv)
  if (!subscriptionId) return null
  const attempt = inv.attempt_count && inv.attempt_count > 0 ? inv.attempt_count : 1
  const final = inv.next_payment_attempt == null
  return {
    subscriptionId,
    invoiceId: inv.id ?? null,
    attempt,
    final,
    amount: formatStripeAmount(inv.amount_due, inv.currency),
    invoiceUrl: inv.hosted_invoice_url ?? null,
    notify: attempt === 1 || final,
  }
}

/* ── customer.subscription.trial_will_end ─────────────────────────────────── */

export type TrialEnding = {
  subscriptionId: string
  /** ISO, or null if Stripe sent no trial_end (shouldn't happen; be tolerant). */
  trialEndsAt: string | null
  /** A payment method is attached to the SUBSCRIPTION. False does not prove
   *  there is no card — it may live on the customer — so the caller checks the
   *  customer before telling anyone they will not be charged. */
  paymentMethodOnSubscription: boolean
  /** Already set to cancel, so the trial simply lapses: no charge either way. */
  cancelAtPeriodEnd: boolean
  amount: string | null
  interval: string | null
  /**
   * What the customer thinks is ending — a signup trial, or referral months.
   *
   * `subscription_data.metadata.flow` is stamped at checkout, so for anything
   * this codebase creates the answer is carried rather than guessed.
   *
   * THE FALLBACK INFERS IT FROM THE TRIAL'S LENGTH, for subscriptions that
   * predate the stamp or were created by hand in the dashboard. The two
   * producers set different lengths — the advertised trial is TRIAL_DAYS (14),
   * a referral reward is `referralMonths * 30` — so anything longer than the
   * advertised trial is a reward.
   *
   * WHY A GUESS IS TOLERABLE HERE, when guessing about money never is: it picks
   * a NOUN, never a number. The amount, the date, the card and the cancel route
   * are identical on both branches and come straight from Stripe. Get this
   * wrong and a user reads "your free months" instead of "your free trial" — a
   * cosmetic mislabel, not a misstatement about a charge.
   */
  kind: 'trial' | 'reward'
}

/** Pure read of a `customer.subscription.trial_will_end` payload.
 *
 *  ── THIS USED TO BE A RARE EVENT. IT IS ABOUT TO BE THE COMMON ONE ──────────
 *
 *  The comment here used to say this could only ever come from the referral
 *  flow, because the advertised 14-day trial creates no Stripe object and so can
 *  never charge anyone. That was true, and it is the reason every string this
 *  feeds talks about "free Pro months".
 *
 *  Once the advertised trial moves to Stripe, this fires on day 11 for EVERY
 *  signup and becomes the product's principal pre-charge notice — the thing a
 *  customer is shown before money moves, and the thing a chargeback dispute
 *  would be argued from. So it has to describe both producers, and `kind` is
 *  how it tells them apart. See that field for why inferring it is safe.
 *
 *  The amount and date are carried through so the email can name the charge
 *  instead of gesturing at "the monthly rate". */
export function trialEnding(sub: StripeSubLike): TrialEnding | null {
  if (!sub.id) return null
  const price = sub.items?.data?.[0]?.price
  // The stamp first. Only 'referral' means a reward — any other flow, and an
  // absent one, falls through to the length test rather than being trusted.
  const stamped = sub.metadata?.flow
  // Longer than the advertised trial ⇒ referral months. Unknown length falls
  // back to 'trial', the shorter and more common of the two.
  const days = sub.trial_start != null && sub.trial_end != null
    ? Math.round((sub.trial_end - sub.trial_start) / 86_400)
    : null
  const kind: 'trial' | 'reward' = stamped === 'referral'
    ? 'reward'
    : stamped === 'trial'
      ? 'trial'
      : (days != null && days > TRIAL_DAYS ? 'reward' : 'trial')
  return {
    subscriptionId: sub.id,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    paymentMethodOnSubscription: !!(sub.default_payment_method || sub.default_source),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    amount: formatStripeAmount(price?.unit_amount, price?.currency),
    interval: price?.recurring?.interval ?? null,
    kind,
  }
}

/* ── Reconciliation ───────────────────────────────────────────────────────── */

/** Whether the mirror row needs rewriting to match Stripe.
 *
 *  Load-bearing for more than efficiency: `subscriptions_touch_updated_at`
 *  fires on EVERY update, changed values or not, and `updated_at` is what the
 *  past_due grace window is measured from (see PAST_DUE_GRACE_DAYS). A
 *  reconciliation pass that blindly re-upserted every row would restart every
 *  grace clock on every run and hand out unlimited free access to a dunning
 *  account. So: compare first, write only on a real difference. */
export type MirrorRow = {
  status: string
  tier: string
  price_id?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean | null
  trial_start?: string | null
  trial_end?: string | null
}

export function mirrorNeedsRepair(existing: MirrorRow | null | undefined, next: SubscriptionRow): boolean {
  if (!existing) return true
  return (
    existing.status !== next.status ||
    existing.tier !== next.tier ||
    existing.price_id !== next.price_id ||
    existing.cancel_at_period_end !== next.cancel_at_period_end ||
    // Timestamps round-trip through Postgres, so compare instants not strings.
    !sameInstant(existing.current_period_end, next.current_period_end) ||
    // 0076. A trial being extended or cut short in the Stripe dashboard is a
    // real difference and must be mirrored.
    //
    // EVERY CALLER MUST SELECT THESE. A caller that omits them hands us
    // `undefined` for `existing` while `next` holds a real value, so this
    // returns true on every single event, the row is rewritten every time, and
    // `subscriptions_touch_updated_at` restarts the past_due grace clock on
    // each one — the exact hazard the header comment above exists to prevent,
    // reintroduced by an incomplete select rather than by faulty logic.
    !sameInstant(existing.trial_start, next.trial_start) ||
    !sameInstant(existing.trial_end, next.trial_end)
  )
}

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  const ta = Date.parse(a), tb = Date.parse(b)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b
  return ta === tb
}

export type StaleMirrorRow = { id: string; user_id?: string | null; status: string; current_period_end: string | null }

/** Mirror rows that claim to be live but whose billing period lapsed more than
 *  `graceHours` ago. This is the exact production symptom that proved the
 *  webhook had never been observed working: one row, status 'active',
 *  current_period_end weeks in the past, updated_at never moved. After a
 *  reconciliation pass has already rewritten everything Stripe knows about,
 *  anything still in this state is drift Stripe cannot explain, and is worth
 *  waking someone up for. `graceHours` absorbs the ordinary lag between a
 *  period ending and the renewal landing. */
export function staleMirrorRows(rows: StaleMirrorRow[], now: Date, graceHours = 48): StaleMirrorRow[] {
  const cutoff = now.getTime() - graceHours * 60 * 60 * 1000
  return rows.filter((r) => {
    if (r.status !== 'active' && r.status !== 'trialing') return false
    if (!r.current_period_end) return false
    const end = Date.parse(r.current_period_end)
    return !Number.isNaN(end) && end < cutoff
  })
}
