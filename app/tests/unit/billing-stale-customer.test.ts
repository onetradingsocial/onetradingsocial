// app/tests/unit/billing-stale-customer.test.ts
//
// Guards recovery from a `stripe_customer_id` that Stripe cannot see.
//
// Production ran on a sandbox Stripe key and later moved to a live one. Objects
// do not cross that boundary: the eight earliest profiles carry `cus_` ids from
// the dead namespace, and the live key answers `No such customer` for every one
// of them. Nothing detects that until the id is spent — the row looks fine, the
// billing page renders, and `checkout.sessions.create` throws on the single
// request that matters. Unhandled it is a 500 on the Upgrade button for exactly
// the oldest accounts, the ones most likely to try to pay, while everyone else
// checks out normally.
//
// The two ends need opposite remedies, and both are covered here:
//
//   checkout - mint a replacement customer, store it, retry once. What it needs
//              is somewhere to attach a NEW subscription.
//   portal   - report it. A fresh customer has no invoices, so re-minting would
//              open an empty portal and call that success.
//
// The dangerous over-correction is treating every `resource_missing` as a stale
// customer: a mistyped price id or a removed coupon returns the same code, and
// re-minting on those would replace a good customer record over a config typo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isMissingCustomer, createAndStoreCustomer } from '@/lib/server/billing'

const UID = '11111111-2222-4333-8444-555555555555'
const STALE = 'cus_deadnamespace01'

/** A Stripe error as the SDK raises it. */
const stripeError = (over: Record<string, unknown> = {}) =>
  Object.assign(new Error(`No such customer: '${STALE}'`), {
    type: 'StripeInvalidRequestError',
    code: 'resource_missing',
    param: 'customer',
    ...over,
  })

describe('isMissingCustomer', () => {
  it('recognises a customer Stripe cannot see', () => {
    expect(isMissingCustomer(stripeError(), STALE)).toBe(true)
  })

  it('recognises one reported without a param, by the id in the message', () => {
    expect(isMissingCustomer(stripeError({ param: undefined }), STALE)).toBe(true)
  })

  it('does not treat a missing price as a stale customer', () => {
    // The over-correction that would cost real money: re-minting a customer
    // every time a price id is wrong replaces a good billing record over a
    // config typo, and the user who already had a subscription loses the link
    // to it.
    const err = stripeError({ param: 'line_items[0][price]', message: "No such price: 'price_typo'" })
    expect(isMissingCustomer(err, STALE)).toBe(false)
  })

  it('does not treat a missing coupon as a stale customer', () => {
    const err = stripeError({ param: 'discounts[0][coupon]', message: "No such coupon: 'BETA'" })
    expect(isMissingCustomer(err, STALE)).toBe(false)
  })

  it('ignores every other failure', () => {
    expect(isMissingCustomer(stripeError({ code: 'card_declined' }), STALE)).toBe(false)
    expect(isMissingCustomer(new Error('network down'), STALE)).toBe(false)
    expect(isMissingCustomer(null, STALE)).toBe(false)
    expect(isMissingCustomer(undefined, STALE)).toBe(false)
  })
})

describe('createAndStoreCustomer', () => {
  const created = vi.fn(async (args: Record<string, unknown>) => ({ id: 'cus_fresh01', ...args }))
  const updated = vi.fn<(p: Record<string, unknown>) => void>()
  const updateError = vi.fn<() => unknown>(() => null)

  const stripe = { customers: { create: created } } as unknown as Parameters<typeof createAndStoreCustomer>[1]
  const svc = {
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        updated(payload)
        return { eq: async () => ({ error: updateError() }) }
      },
    }),
  } as unknown as Parameters<typeof createAndStoreCustomer>[0]

  beforeEach(() => {
    created.mockClear(); updated.mockClear(); updateError.mockReturnValue(null)
  })

  it('mints a customer and stores its id', async () => {
    const res = await createAndStoreCustomer(svc, stripe, { id: UID, email: 'a@b.co' })
    expect(res).toEqual({ customerId: 'cus_fresh01' })
    expect(updated).toHaveBeenCalledWith({ stripe_customer_id: 'cus_fresh01' })
  })

  it('stamps the user id into the customer metadata', async () => {
    // resolveUserId() falls back to metadata.user_id when the profile lookup
    // misses, so a customer created without it is one the webhook may not be
    // able to map back to an account.
    await createAndStoreCustomer(svc, stripe, { id: UID, email: 'a@b.co' })
    expect(created.mock.calls[0][0]).toMatchObject({ metadata: { user_id: UID } })
  })

  it('fails loudly when the id cannot be persisted', async () => {
    // Continuing would open a checkout whose customer we have not recorded,
    // leaving the webhook only the metadata fallback to find the buyer with.
    updateError.mockReturnValue({ message: 'permission denied' })
    const res = await createAndStoreCustomer(svc, stripe, { id: UID, email: 'a@b.co' })
    expect(res).toEqual({ error: 'could not save customer' })
  })
})
