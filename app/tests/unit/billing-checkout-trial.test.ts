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

type Row = { status: string; trial_start?: string | null; trial_end?: string | null }
type StripeSub = {
  status: string; trial_start?: number | null; trial_end?: number | null
  metadata?: Record<string, string>
}

/** The `subscriptions` mirror rows for this user. Empty by default. */
let mirrorRows: Row[] = []
/** Stripe's own subscription list for the customer. Empty by default. */
let stripeSubs: StripeSub[] = []
/** profiles.trial_started_at — the legacy card-free trial. */
let localTrial: string | null = null
/** Activated referrals, for the referral flow. */
let activated = 0
/** Checkout Sessions still open for the customer, and what expiring them does. */
let openSessions: Array<{ id: string }> = []
const sessionsExpire = vi.fn<(id: string) => Promise<unknown>>(async () => ({}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          // The history guard awaits `.from('subscriptions').select().eq()`.
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: table === 'subscriptions' ? mirrorRows : [] }),
          single: async () => ({ data: { stripe_customer_id: CUS, trial_started_at: localTrial } }),
          maybeSingle: async () => ({ data: table === 'referral_codes' ? { code: 'alex-ab12' } : null }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}))

vi.mock('@/lib/server/referral', () => ({
  getReferralStats: async () => ({ clicks: 0, signups: activated, activated }),
}))

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    customers: { create: vi.fn(async () => ({ id: CUS })) },
    subscriptions: { list: async () => ({ data: stripeSubs }) },
    checkout: { sessions: {
      create: sessionsCreate,
      list: async () => ({ data: openSessions }),
      expire: (id: string) => sessionsExpire(id),
    } },
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
  mirrorRows = []
  stripeSubs = []
  localTrial = null
  activated = 0
  openSessions = []
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
  beforeEach(() => { mirrorRows = [{ status: 'trialing' }] })

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

describe('the signup trial is one per person (terms §8)', () => {
  it('refuses a second trial after the first was cancelled and lapsed', async () => {
    // The replay: start, cancel in the portal, let it end, start again. Only
    // Stripe knows about it if the webhook has not mirrored it, so this fixture
    // lives in Stripe's list alone.
    stripeSubs = [{ status: 'canceled', trial_start: 1_700_000_000, trial_end: 1_701_209_600, metadata: { flow: 'trial' } }]
    const res = await post(request({ flow: 'trial' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already had its free trial/)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('refuses it when only the mirror remembers the earlier subscription', async () => {
    // A re-minted customer has an empty Stripe list; the mirror is keyed by user.
    mirrorRows = [{ status: 'canceled', trial_start: '2026-08-01T00:00:00Z', trial_end: '2026-08-15T00:00:00Z' }]
    expect((await post(request({ flow: 'trial' }))).status).toBe(409)
  })

  it('counts the legacy card-free trial as the one trial', async () => {
    localTrial = '2026-09-01T00:00:00Z'
    expect((await post(request({ flow: 'trial' }))).status).toBe(409)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('still lets a lapsed trialist SUBSCRIBE — only the free period is spent', async () => {
    stripeSubs = [{ status: 'canceled', trial_start: 1_700_000_000, trial_end: 1_701_209_600, metadata: { flow: 'trial' } }]
    localTrial = '2026-09-01T00:00:00Z'
    expect((await post(request({ tier: 'trader', interval: 'monthly' }))).status).toBe(200)
  })
})

describe('a live paid subscription blocks a second one', () => {
  for (const status of ['active', 'past_due', 'unpaid', 'paused', 'incomplete']) {
    it(`refuses a purchase beside a ${status} subscription`, async () => {
      stripeSubs = [{ status }]
      const res = await post(request({ tier: 'pro', interval: 'monthly' }))
      expect(res.status).toBe(409)
      expect((await res.json()).error).toMatch(/Settings → Billing/)
      expect(sessionsCreate).not.toHaveBeenCalled()
    })
  }

  it('allows a purchase once the earlier subscription has ended', async () => {
    stripeSubs = [{ status: 'canceled' }, { status: 'incomplete_expired' }]
    expect((await post(request({ tier: 'pro', interval: 'monthly' }))).status).toBe(200)
  })
})

describe('referral months cannot be claimed twice', () => {
  const DAY = 86_400

  it('grants only the months not already claimed, and stamps the claim', async () => {
    activated = 3
    stripeSubs = [{ status: 'canceled', metadata: { flow: 'referral', referral_months: '2' } }]
    expect((await post(request({ flow: 'referral' }))).status).toBe(200)
    expect(subData().trial_period_days).toBe(30)
    expect((subData().metadata as Record<string, string>).referral_months).toBe('1')
  })

  it('refuses the claim → cancel → claim replay', async () => {
    activated = 2
    stripeSubs = [{ status: 'canceled', metadata: { flow: 'referral', referral_months: '2' } }]
    const res = await post(request({ flow: 'referral' }))
    expect(res.status).toBe(400)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('counts a claim made before the stamp existed from its trial length', async () => {
    activated = 3
    stripeSubs = [{
      status: 'canceled', trial_start: 1_700_000_000, trial_end: 1_700_000_000 + 60 * DAY,
      metadata: { flow: 'referral' },
    }]
    expect((await post(request({ flow: 'referral' }))).status).toBe(200)
    expect(subData().trial_period_days).toBe(30)
  })
})

describe('only the newest checkout for a customer can be completed', () => {
  it('expires still-open sessions before opening a new one', async () => {
    // Two tabs: the trial on /welcome and a plan on /settings/billing. Neither
    // is a subscription yet, so the history check passes both.
    openSessions = [{ id: 'cs_old_1' }, { id: 'cs_old_2' }]
    const order: string[] = []
    sessionsExpire.mockImplementation(async (id) => { order.push(`expire:${id}`); return {} })
    sessionsCreate.mockImplementation(async () => { order.push('create'); return { url: 'https://checkout.stripe.com/c/pay/cs_new' } })

    expect((await post(request({ tier: 'pro', interval: 'monthly' }))).status).toBe(200)
    expect(order).toEqual(['expire:cs_old_1', 'expire:cs_old_2', 'create'])
  })

  it('refuses when an open session completed between list and expire', async () => {
    openSessions = [{ id: 'cs_paying_now' }]
    sessionsExpire.mockRejectedValueOnce(Object.assign(new Error('Only Checkout Sessions with a status of open can be expired.'), { code: 'resource_missing' }))
    const res = await post(request({ flow: 'trial' }))
    expect(res.status).toBe(409)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })
})
