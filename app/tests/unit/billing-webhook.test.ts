import { describe, it, expect } from 'vitest'
import {
  subscriptionRow, formatStripeAmount, invoiceSubscriptionId, paymentFailure,
  trialEnding, mirrorNeedsRepair, staleMirrorRows,
} from '@/lib/billing-webhook'
import type { PlanEnv } from '@/lib/entitlements'

const ENV: PlanEnv = {
  STRIPE_PRICE_TRADER_MONTHLY: 'price_tm',
  STRIPE_PRICE_PRO_ANNUAL: 'price_pa',
}

const sub = (priceId: string, over: Record<string, unknown> = {}, itemOver: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  status: 'active',
  cancel_at_period_end: false,
  items: { data: [{ price: { id: priceId }, current_period_end: 1_700_000_000, ...itemOver }] },
  ...over,
})

describe('subscriptionRow', () => {
  it('maps an active trader monthly subscription', () => {
    expect(subscriptionRow(sub('price_tm'), ENV)).toEqual({
      id: 'sub_1',
      status: 'active',
      tier: 'trader',
      price_id: 'price_tm',
      current_period_end: '2023-11-14T22:13:20.000Z',
      cancel_at_period_end: false,
    })
  })
  it('carries status and cancel flag', () => {
    const row = subscriptionRow(sub('price_pa', { status: 'past_due', cancel_at_period_end: true }), ENV)
    expect(row?.tier).toBe('pro')
    expect(row?.status).toBe('past_due')
    expect(row?.cancel_at_period_end).toBe(true)
  })
  it('returns null for an unknown price (do not 500 the webhook)', () => {
    expect(subscriptionRow(sub('price_unknown'), ENV)).toBeNull()
  })
  it('handles a null current_period_end', () => {
    expect(subscriptionRow(sub('price_tm', {}, { current_period_end: null }), ENV)?.current_period_end).toBeNull()
  })
})

/* ── formatStripeAmount ─────────────────────────────────────────────────── */

describe('formatStripeAmount', () => {
  it('uses the A$ convention the rest of the product uses for AUD', () => {
    expect(formatStripeAmount(5000, 'aud')).toBe('A$50')
    expect(formatStripeAmount(3050, 'AUD')).toBe('A$30.50')
    expect(formatStripeAmount(0, 'aud')).toBe('A$0')
  })
  it('names any other currency explicitly rather than showing a bare symbol', () => {
    expect(formatStripeAmount(5000, 'usd')).toBe('USD 50')
    expect(formatStripeAmount(1234, 'eur')).toBe('EUR 12.34')
  })
  it('does not divide zero-decimal currencies', () => {
    expect(formatStripeAmount(5000, 'jpy')).toBe('JPY 5000')
  })
  it('returns null for a missing amount so callers pick their own fallback', () => {
    expect(formatStripeAmount(null, 'aud')).toBeNull()
    expect(formatStripeAmount(undefined, 'aud')).toBeNull()
  })
  it('defaults to AUD when Stripe sends no currency', () => {
    expect(formatStripeAmount(5000, null)).toBe('A$50')
  })
})

/* ── invoice.payment_failed ─────────────────────────────────────────────── */

const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'in_1',
  amount_due: 5000,
  currency: 'aud',
  attempt_count: 1,
  next_payment_attempt: 1_800_000_000,
  hosted_invoice_url: 'https://invoice.stripe.com/x',
  ...over,
})

describe('invoiceSubscriptionId', () => {
  it('reads the pre-2025 flat field', () => {
    expect(invoiceSubscriptionId(invoice({ subscription: 'sub_flat' }))).toBe('sub_flat')
    expect(invoiceSubscriptionId(invoice({ subscription: { id: 'sub_obj' } }))).toBe('sub_obj')
  })
  it('reads the 2025+ parent.subscription_details shape', () => {
    // getStripe() pins no apiVersion, so the payload can be either shape.
    expect(invoiceSubscriptionId(invoice({
      parent: { subscription_details: { subscription: 'sub_nested' } },
    }))).toBe('sub_nested')
    expect(invoiceSubscriptionId(invoice({
      parent: { subscription_details: { subscription: { id: 'sub_nested_obj' } } },
    }))).toBe('sub_nested_obj')
  })
  it('is null for a one-off invoice', () => {
    expect(invoiceSubscriptionId(invoice())).toBeNull()
    expect(invoiceSubscriptionId(invoice({ subscription: null, parent: null }))).toBeNull()
  })
})

describe('paymentFailure', () => {
  it('is null for an invoice with no subscription — nothing for us to do', () => {
    expect(paymentFailure(invoice())).toBeNull()
  })

  it('reads a first failure and formats the amount', () => {
    const f = paymentFailure(invoice({ subscription: 'sub_1' }))!
    expect(f.subscriptionId).toBe('sub_1')
    expect(f.attempt).toBe(1)
    expect(f.final).toBe(false)
    expect(f.amount).toBe('A$50')
    expect(f.invoiceUrl).toBe('https://invoice.stripe.com/x')
    expect(f.notify).toBe(true)
  })

  it('notifies on the first attempt and the last, and stays quiet in between', () => {
    // Stripe retries a failed renewal several times over ~3 weeks and fires
    // this event each time; emailing every one trains people to ignore us.
    const n = (attempt: number, next: number | null) =>
      paymentFailure(invoice({ subscription: 'sub_1', attempt_count: attempt, next_payment_attempt: next }))!.notify
    expect(n(1, 1_800_000_000)).toBe(true)   // first
    expect(n(2, 1_800_000_000)).toBe(false)  // middle
    expect(n(3, 1_800_000_000)).toBe(false)  // middle
    expect(n(4, null)).toBe(true)            // final
  })

  it('marks the final attempt so the email can say so', () => {
    const f = paymentFailure(invoice({ subscription: 'sub_1', attempt_count: 4, next_payment_attempt: null }))!
    expect(f.final).toBe(true)
  })

  it('treats a single-attempt failure as both first and final', () => {
    const f = paymentFailure(invoice({ subscription: 'sub_1', attempt_count: 1, next_payment_attempt: null }))!
    expect(f.attempt).toBe(1)
    expect(f.final).toBe(true)
    expect(f.notify).toBe(true)
  })

  it('falls back to attempt 1 rather than dropping the notice when attempt_count is absent', () => {
    const f = paymentFailure(invoice({ subscription: 'sub_1', attempt_count: undefined }))!
    expect(f.attempt).toBe(1)
    expect(f.notify).toBe(true)
  })

  it('survives an invoice with no amount or invoice url', () => {
    const f = paymentFailure(invoice({ subscription: 'sub_1', amount_due: null, hosted_invoice_url: null }))!
    expect(f.amount).toBeNull()
    expect(f.invoiceUrl).toBeNull()
  })
})

/* ── customer.subscription.trial_will_end ───────────────────────────────── */

const trialSub = (over: Record<string, unknown> = {}, priceOver: Record<string, unknown> = {}) => ({
  id: 'sub_t',
  status: 'trialing',
  cancel_at_period_end: false,
  trial_end: 1_800_000_000,
  default_payment_method: 'pm_1',
  items: { data: [{ price: { id: 'price_pm', unit_amount: 5000, currency: 'aud', recurring: { interval: 'month' }, ...priceOver } }] },
  ...over,
})

describe('trialEnding', () => {
  it('names the amount, interval and date so the email never says "the monthly rate"', () => {
    const t = trialEnding(trialSub())!
    expect(t.subscriptionId).toBe('sub_t')
    expect(t.amount).toBe('A$50')
    expect(t.interval).toBe('month')
    expect(t.trialEndsAt).toBe(new Date(1_800_000_000 * 1000).toISOString())
    expect(t.paymentMethodOnSubscription).toBe(true)
    expect(t.cancelAtPeriodEnd).toBe(false)
  })

  it('reports no payment method on the subscription without asserting there is none', () => {
    // False here does NOT prove no card exists — it may live on the customer —
    // which is why the caller checks the customer before saying "no charge".
    const t = trialEnding(trialSub({ default_payment_method: null, default_source: null }))!
    expect(t.paymentMethodOnSubscription).toBe(false)
  })

  it('accepts a legacy default_source as a payment method', () => {
    expect(trialEnding(trialSub({ default_payment_method: null, default_source: 'card_1' }))!
      .paymentMethodOnSubscription).toBe(true)
  })

  it('carries cancel_at_period_end so a lapsing trial is not announced as a charge', () => {
    expect(trialEnding(trialSub({ cancel_at_period_end: true }))!.cancelAtPeriodEnd).toBe(true)
  })

  it('tolerates a missing trial_end and a price with no unit_amount', () => {
    const t = trialEnding(trialSub({ trial_end: null }, { unit_amount: null }))!
    expect(t.trialEndsAt).toBeNull()
    expect(t.amount).toBeNull()
  })
})

/* ── Reconciliation ─────────────────────────────────────────────────────── */

const mirrored = {
  status: 'active', tier: 'trader', price_id: 'price_tm',
  current_period_end: '2026-09-01T00:00:00.000Z', cancel_at_period_end: false,
}
const fromStripe = { id: 'sub_1', ...mirrored, tier: 'trader' as const }

describe('mirrorNeedsRepair', () => {
  it('is true when there is no local row at all', () => {
    expect(mirrorNeedsRepair(null, { ...fromStripe })).toBe(true)
    expect(mirrorNeedsRepair(undefined, { ...fromStripe })).toBe(true)
  })

  it('is FALSE when the row already matches', () => {
    // Load-bearing: subscriptions_touch_updated_at fires on every UPDATE, and
    // updated_at is what the past_due grace window is measured from. A blind
    // re-upsert every run would restart every grace clock indefinitely.
    expect(mirrorNeedsRepair({ ...mirrored }, { ...fromStripe })).toBe(false)
  })

  it('detects each field that matters', () => {
    expect(mirrorNeedsRepair({ ...mirrored, status: 'past_due' }, { ...fromStripe })).toBe(true)
    expect(mirrorNeedsRepair({ ...mirrored, tier: 'pro' }, { ...fromStripe })).toBe(true)
    expect(mirrorNeedsRepair({ ...mirrored, price_id: 'price_other' }, { ...fromStripe })).toBe(true)
    expect(mirrorNeedsRepair({ ...mirrored, cancel_at_period_end: true }, { ...fromStripe })).toBe(true)
    expect(mirrorNeedsRepair({ ...mirrored, current_period_end: '2026-10-01T00:00:00.000Z' }, { ...fromStripe })).toBe(true)
  })

  it('compares period ends as instants, not strings', () => {
    // Postgres hands back '+00:00' where Stripe gave us 'Z'; same moment.
    expect(mirrorNeedsRepair(
      { ...mirrored, current_period_end: '2026-09-01T00:00:00+00:00' }, { ...fromStripe },
    )).toBe(false)
  })

  it('handles a null period end on either side', () => {
    expect(mirrorNeedsRepair({ ...mirrored, current_period_end: null }, { ...fromStripe })).toBe(true)
    expect(mirrorNeedsRepair(
      { ...mirrored, current_period_end: null }, { ...fromStripe, current_period_end: null },
    )).toBe(false)
  })
})

describe('staleMirrorRows', () => {
  const NOW = new Date('2026-08-18T12:00:00.000Z')
  const ago = (d: number) => new Date(NOW.getTime() - d * 864e5).toISOString()

  it('flags the exact production symptom: active, but the period lapsed weeks ago', () => {
    const rows = [{ id: 'sub_1', status: 'active', current_period_end: ago(23) }]
    expect(staleMirrorRows(rows, NOW).map((r) => r.id)).toEqual(['sub_1'])
  })

  it('leaves recent lapses alone — renewals take a moment to land', () => {
    expect(staleMirrorRows([{ id: 'sub_1', status: 'active', current_period_end: ago(1) }], NOW)).toEqual([])
  })

  it('ignores rows that do not claim to be live', () => {
    expect(staleMirrorRows([
      { id: 'sub_1', status: 'canceled', current_period_end: ago(400) },
      { id: 'sub_2', status: 'past_due', current_period_end: ago(400) },
    ], NOW)).toEqual([])
  })

  it('ignores rows with no period end and unparseable dates', () => {
    expect(staleMirrorRows([
      { id: 'sub_1', status: 'active', current_period_end: null },
      { id: 'sub_2', status: 'active', current_period_end: 'nonsense' },
    ], NOW)).toEqual([])
  })

  it('honours a custom grace', () => {
    const rows = [{ id: 'sub_1', status: 'trialing', current_period_end: ago(3) }]
    expect(staleMirrorRows(rows, NOW, 24)).toHaveLength(1)
    expect(staleMirrorRows(rows, NOW, 24 * 10)).toHaveLength(0)
  })
})
