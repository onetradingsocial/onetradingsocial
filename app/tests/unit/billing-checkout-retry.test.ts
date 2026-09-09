// app/tests/unit/billing-checkout-retry.test.ts
//
// The recovery itself: api/billing/checkout must survive a stored
// `stripe_customer_id` that Stripe cannot see, and must not "recover" from
// anything else.
//
// Companion to billing-stale-customer.test.ts, which covers the predicate and
// the minting helper in isolation. This one drives the route, because the part
// that can regress is the control flow around them — retry exactly once, on
// exactly one error, and only after the replacement id has been stored.
//
// Mocking style follows tests/unit/trade-edit.test.ts: vi.mock the server-only
// edges and let the route's own logic run.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const UID = '11111111-2222-4333-8444-555555555555'
const STALE = 'cus_deadnamespace01'
const FRESH = 'cus_fresh01'

const storedCustomerId = vi.fn<() => string | null>(() => STALE)
const updated = vi.fn<(p: Record<string, unknown>) => void>()
const customersCreate = vi.fn(async () => ({ id: FRESH }))
const sessionsCreate = vi.fn<(args: { customer: string }) => Promise<{ url: string }>>()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: UID, email: 'a@b.co' } } }) },
  }),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { stripe_customer_id: storedCustomerId() } }),
          maybeSingle: async () => ({ data: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updated(payload)
        return { eq: async () => ({ error: null }) }
      },
    }),
  }),
}))

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    customers: { create: customersCreate },
    checkout: { sessions: { create: sessionsCreate } },
  }),
}))

vi.mock('@/lib/server/rate-limit', () => ({
  rateLimit: () => ({ ok: true }),
  clientKey: () => 'k',
  tooMany: () => new Response(null, { status: 429 }),
}))

vi.mock('@/lib/server/track', () => ({ trackServer: vi.fn() }))
vi.mock('@/lib/server/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/terms-acceptance', () => ({ stripeTermsConsent: () => undefined }))

const request = () => ({
  json: async () => ({ tier: 'trader', interval: 'monthly' }),
  cookies: { get: () => undefined },
}) as unknown as Parameters<typeof post>[0]

async function post(...args: unknown[]) {
  const mod = await import('@/app/api/billing/checkout/route')
  return (mod.POST as (r: unknown) => Promise<Response>)(args[0])
}

/** A Stripe error as the SDK raises it. */
const stripeError = (over: Record<string, unknown> = {}) =>
  Object.assign(new Error(`No such customer: '${STALE}'`), {
    type: 'StripeInvalidRequestError',
    code: 'resource_missing',
    param: 'customer',
    ...over,
  })

beforeEach(() => {
  vi.clearAllMocks()
  storedCustomerId.mockReturnValue(STALE)
  customersCreate.mockResolvedValue({ id: FRESH })
  process.env.STRIPE_PRICE_TRADER_MONTHLY = 'price_tm'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com'
})

describe('checkout with a stale customer id', () => {
  it('re-mints, stores and retries once, and the user reaches Stripe', async () => {
    sessionsCreate
      .mockRejectedValueOnce(stripeError())
      .mockResolvedValueOnce({ url: 'https://checkout.stripe.com/c/pay/cs_live_x' })

    const res = await post(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_live_x' })

    expect(customersCreate).toHaveBeenCalledTimes(1)
    expect(updated).toHaveBeenCalledWith({ stripe_customer_id: FRESH })
    // First attempt on the dead id, second on the replacement.
    expect(sessionsCreate.mock.calls.map((c) => c[0].customer)).toEqual([STALE, FRESH])
  })

  it('stores the replacement before spending it', async () => {
    // The webhook maps a Stripe customer back to a user through this column. A
    // session opened on an id we have not recorded is a payment we might not be
    // able to attribute.
    const order: string[] = []
    updated.mockImplementation(() => { order.push('stored') })
    sessionsCreate.mockImplementation(async ({ customer }) => {
      order.push(`session:${customer}`)
      if (customer === STALE) throw stripeError()
      return { url: 'https://checkout.stripe.com/c/pay/cs_live_x' }
    })

    await post(request())
    expect(order).toEqual([`session:${STALE}`, 'stored', `session:${FRESH}`])
  })

  it('retries only once, then gives up', async () => {
    // A replacement that also fails is not a stale pointer — something else is
    // wrong, and minting customers in a loop would be the worst possible answer.
    sessionsCreate.mockRejectedValue(stripeError())

    await expect(post(request())).rejects.toThrow()
    expect(customersCreate).toHaveBeenCalledTimes(1)
    expect(sessionsCreate).toHaveBeenCalledTimes(2)
  })
})

describe('checkout failures that are not a stale customer', () => {
  it('does not re-mint on a missing price', async () => {
    // Same `resource_missing` code, entirely different cause. Re-minting here
    // would replace a working customer record over a config typo.
    sessionsCreate.mockRejectedValue(stripeError({
      param: 'line_items[0][price]', message: "No such price: 'price_typo'",
    }))

    await expect(post(request())).rejects.toThrow()
    expect(customersCreate).not.toHaveBeenCalled()
    expect(sessionsCreate).toHaveBeenCalledTimes(1)
  })

  it('does not re-mint on any other Stripe failure', async () => {
    sessionsCreate.mockRejectedValue(stripeError({ code: 'api_error', param: undefined, message: 'upstream' }))

    await expect(post(request())).rejects.toThrow()
    expect(customersCreate).not.toHaveBeenCalled()
  })
})

describe('checkout with a healthy customer id', () => {
  it('spends the stored id and mints nothing', async () => {
    sessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_live_ok' })

    const res = await post(request())
    expect(res.status).toBe(200)
    expect(customersCreate).not.toHaveBeenCalled()
    expect(updated).not.toHaveBeenCalled()
    expect(sessionsCreate).toHaveBeenCalledTimes(1)
  })

  it('mints once for a user who has never had one', async () => {
    storedCustomerId.mockReturnValue(null)
    sessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_live_ok' })

    await post(request())
    expect(customersCreate).toHaveBeenCalledTimes(1)
    expect(updated).toHaveBeenCalledWith({ stripe_customer_id: FRESH })
    expect(sessionsCreate.mock.calls.map((c) => c[0].customer)).toEqual([FRESH])
  })
})

describe('checkout currency', () => {
  it('disables adaptive pricing so the charge matches the quote', async () => {
    // Every price surface in the product says AUD, prefixed `A$`, backed by
    // CURRENCY_NOTE and the ACL s48 reasoning in lib/plans.ts: the quoted
    // figure must be the total payable. Stripe's adaptive pricing converts by
    // geography — observed on production quoting ₱1,410.68 for a plan listed at
    // A$30 — which contradicts that disclosure at the moment of payment.
    sessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_live_ok' })
    storedCustomerId.mockReturnValue('cus_healthy')

    await post(request())

    const params = sessionsCreate.mock.calls[0][0] as { adaptive_pricing?: { enabled: boolean } }
    expect(
      params.adaptive_pricing,
      'The Checkout session must disable adaptive pricing. Without it Stripe ' +
      'converts the amount into the visitor\'s local currency at a rate the ' +
      'product quotes nowhere, while /settings/billing states all prices are AUD.',
    ).toEqual({ enabled: false })
  })

  it('disables it on the retry path too', async () => {
    // The re-mint path builds its own session. A stale customer id must not be
    // the thing that reintroduces a foreign-currency charge.
    sessionsCreate
      .mockRejectedValueOnce(stripeError())
      .mockResolvedValueOnce({ url: 'https://checkout.stripe.com/c/pay/cs_live_x' })

    await post(request())

    for (const call of sessionsCreate.mock.calls) {
      expect((call[0] as { adaptive_pricing?: { enabled: boolean } }).adaptive_pricing)
        .toEqual({ enabled: false })
    }
  })
})
