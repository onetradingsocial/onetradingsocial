import { planForPrice, type PlanEnv, type Tier } from '@/lib/entitlements'

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
  trial_end?: number | null
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
}

/** Pure read of a `customer.subscription.trial_will_end` payload.
 *
 *  IMPORTANT product context. The advertised 14-day Pro trial creates NO Stripe
 *  object at all — it is two timestamps on `profiles` (migration 0041), takes
 *  no card and can never charge anyone. So the only way this event can reach us
 *  today is the referral flow, which opens a real Stripe trial WITH a card
 *  (`payment_method_collection: 'always'`, api/billing/checkout/route.ts) that
 *  auto-charges Pro monthly when the free months run out. Terms §8 draws
 *  exactly that distinction; the notice this feeds is what makes the code
 *  honour it. The amount and date are carried through so the email can name the
 *  charge instead of gesturing at "the monthly rate". */
export function trialEnding(sub: StripeSubLike): TrialEnding | null {
  if (!sub.id) return null
  const price = sub.items?.data?.[0]?.price
  return {
    subscriptionId: sub.id,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    paymentMethodOnSubscription: !!(sub.default_payment_method || sub.default_source),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    amount: formatStripeAmount(price?.unit_amount, price?.currency),
    interval: price?.recurring?.interval ?? null,
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
}

export function mirrorNeedsRepair(existing: MirrorRow | null | undefined, next: SubscriptionRow): boolean {
  if (!existing) return true
  return (
    existing.status !== next.status ||
    existing.tier !== next.tier ||
    existing.price_id !== next.price_id ||
    existing.cancel_at_period_end !== next.cancel_at_period_end ||
    // Timestamps round-trip through Postgres, so compare instants not strings.
    !sameInstant(existing.current_period_end, next.current_period_end)
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
