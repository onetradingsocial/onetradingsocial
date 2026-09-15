// app/tests/unit/billing-checkout-trial.test.ts
//
// The `flow: 'trial'` branch of api/billing/checkout — the session that opens
// every signup's 14-day trial.
//
// These assertions are about money, not plumbing. Each one corresponds to a way
// the session can be built that looks fine, returns a Stripe URL, and costs
// either the customer or us:
//
//   * no trial_settings          → a customer who detaches their card gets an
//                                  unpaid invoice, past_due, and 14 further
//                                  days of dunning grace: 28 free days.
//   * no payment_method_collection → Stripe skips the card on a A$0 session and
//                                  the trial can never convert.
//   * a client-chosen price      → the plan is forgeable from the browser.
//   * the annual coupon attached → it can be consumed by the A$0 invoice Stripe
//                                  raises at trial start, so day 14 bills full
//                                  price after a 76%-off quote.
//
// Mocking style follows billing-checkout-retry.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TRIAL_DAYS } from '@/lib/entitlements'

const UID = '11111111-2222-4333-8444-555555555555'
const CUS = 'cus_ok01'

type SessionArgs = Record<string, unknown>
const sessionsCreate = vi.fn<(a: SessionArgs) => Promise<{ url: string }>>()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: UID, email: 'a@b.co' } } }) },
  }),
}))

/** Rows the guard's `subscriptions` lookup should return. Empty by default: no
 *  trial in progress, so checkout proceeds. */
let trialingRows: Array<{ id: string }> = []

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          // The duplicate-subscription guard: .eq().eq().limit()
          eq: () => ({ limit: async () => ({ data: table === 'subscriptions' ? trialingRows : [] }) }),
          single: async () => ({ data: { stripe_customer_id: CUS } }),
          maybeSingle: async () => ({ data: null }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}))

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    customers: { create: vi.fn(async () => ({ id: CUS })) },
    checkout: { sessions: { create: sessionsCreate } },
  }),
}))

vi.mock('@/lib/server/rate-limit', () => ({
  rateLimit: () => ({ ok: true }),
  clientKey: () => 'k',
  tooMany: () => new Response(null, { status: 429 }),
}))

vi.mock('@/lib/server/track', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/server/log', () => ({ logError: vi.fn(), logInfo: vi.fn() }))
vi.mock('@/lib/terms-acceptance', () => ({ stripeTermsConsent: () => undefined }))

const request = (body: Record<string, unknown>) => ({
  json: async () => body,
  cookies: { get: () => undefined },
}) as unknown as Parameters<typeof post>[0]

async function post(...args: unknown[]) {
  const mod = await import('@/app/api/billing/checkout/route')
  return (mod.POST as (r: unknown) => Promise<Response>)(args[0])
}

const sent = () => sessionsCreate.mock.calls[0][0]
const subData = () => sent().subscription_data as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  trialingRows = []
  sessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_x' })
  process.env.STRIPE_PRICE_TRADER_MONTHLY = 'price_tm'
  process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pm'
  process.env.STRIPE_PRICE_PRO_ANNUAL = 'price_pa'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com'
  delete process.env.STRIPE_COUPON_BETA_ANNUAL
})

describe('flow: trial — the session that opens a signup trial', () => {
  it('opens a 14-day trial and collects a card', async () => {
    const res = await post(request({ flow: 'trial' }))
    expect(res.status).toBe(200)
    expect(subData().trial_period_days).toBe(TRIAL_DAYS)
    // Without this Stripe skips card collection on a A$0-due session, and the
    // trial becomes today's card-free trial with a Stripe object attached.
    expect(sent().payment_method_collection).toBe('always')
  })

  it('CANCELS at trial end when the card is gone, rather than invoicing', async () => {
    // The single most expensive line in this file. The Stripe account default
    // is `create_invoice`, which routes a card-less trial into past_due and
    // hands it the 14-day dunning grace — 28 free days on no payment method,
    // repeatable per account. The default is not observable from this repo, so
    // it is set explicitly.
    expect(await post(request({ flow: 'trial' })).then((r) => r.status)).toBe(200)
    expect(subData().trial_settings).toEqual({
      end_behavior: { missing_payment_method: 'cancel' },
    })
  })

  it('prices the trial on the server — the client cannot choose the plan', async () => {
    await post(request({ flow: 'trial', tier: 'trader', interval: 'annual' }))
    // Pro monthly, despite the body asking for Trader annual.
    expect((sent().line_items as Array<{ price: string }>)[0].price).toBe('price_pm')
    expect((sent().metadata as Record<string, string>).tier).toBe('pro')
    expect((sent().metadata as Record<string, string>).interval).toBe('monthly')
  })

  it('never attaches the annual coupon to a trial', async () => {
    process.env.STRIPE_COUPON_BETA_ANNUAL = 'coupon_beta'
    // Even when the body asks for annual, which is what would have slipped the
    // coupon past the old check on the raw request field.
    await post(request({ flow: 'trial', interval: 'annual' }))
    expect(sent().discounts).toBeUndefined()
  })

  it('stamps the flow on the SUBSCRIPTION, so the pre-charge email can name it', async () => {
    await post(request({ flow: 'trial' }))
    expect((subData().metadata as Record<string, string>).flow).toBe('trial')
  })

  it('returns a mid-signup user to the flow, not to a billing page they have never seen', async () => {
    await post(request({ flow: 'trial' }))
    expect(sent().success_url).toContain('/onboarding')
    // Cancelling lands back where the decline route still waits.
    expect(sent().cancel_url).toContain('/welcome')
  })

  it('keeps the AUD guarantee — adaptive pricing stays off', async () => {
    await post(request({ flow: 'trial' }))
    expect(sent().adaptive_pricing).toEqual({ enabled: false })
  })
})

describe('the other flows are unchanged by the trial branch', () => {
  it('an ordinary purchase opens no trial and collects no card up front', async () => {
    await post(request({ tier: 'trader', interval: 'monthly' }))
    expect(sent().subscription_data).toBeUndefined()
    expect(sent().payment_method_collection).toBeUndefined()
  })

  it('an ordinary ANNUAL purchase still gets the beta coupon', async () => {
    // The guard moved from the raw request field to the server-priced value, so
    // this is the case that proves the move did not disable the promo.
    process.env.STRIPE_COUPON_BETA_ANNUAL = 'coupon_beta'
    await post(request({ tier: 'pro', interval: 'annual' }))
    expect(sent().discounts).toEqual([{ coupon: 'coupon_beta' }])
  })

  it('the success URL carries the plan actually sold, not the raw request', async () => {
    await post(request({ tier: 'pro', interval: 'annual' }))
    expect(sent().success_url).toContain('tier=pro')
    expect(sent().success_url).toContain('interval=annual')
  })

  it('still rejects a malformed ordinary purchase', async () => {
    expect((await post(request({ tier: 'bogus', interval: 'monthly' }))).status).toBe(400)
    expect((await post(request({}))).status).toBe(400)
  })
})

describe('a trial already in progress blocks every new subscription', () => {
  // Checkout CREATES a subscription; it never modifies one. Someone mid-trial
  // on Pro who buys Trader from the in-app upsell would hold both and pay A$80
  // a month having chosen one plan. Nothing cancels the first.
  beforeEach(() => { trialingRows = [{ id: 'sub_trialing' }] })

  it('refuses the in-app upsell — the path that would double-bill', async () => {
    const res = await post(request({ tier: 'trader', interval: 'monthly', flow: 'trial_end' }))
    expect(res.status).toBe(409)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('refuses a second trial', async () => {
    expect((await post(request({ flow: 'trial' }))).status).toBe(409)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('refuses a referral claim mid-trial, which would duplicate the same way', async () => {
    expect((await post(request({ flow: 'referral' }))).status).toBe(409)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('refuses a plain purchase too', async () => {
    expect((await post(request({ tier: 'pro', interval: 'annual' }))).status).toBe(409)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('points the customer at the billing portal rather than just failing', async () => {
    const res = await post(request({ tier: 'trader', interval: 'monthly', flow: 'trial_end' }))
    expect((await res.json()).error).toMatch(/Settings/)
  })
})
