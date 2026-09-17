import { describe, it, expect, vi } from 'vitest'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/server/log', () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ insertSystemNotification: vi.fn() }))

import { referralMonthsClaimedFor } from '@/lib/server/billing'

/**
 * The referral modal offers the months a user can still claim. Checkout always
 * re-derives the figure and refuses a replay, so this helper only has to be
 * right about what it SHOWS — and must degrade to "unknown" rather than to 0
 * when Stripe cannot be read, so a failure never tells someone they have
 * nothing left.
 */
const svcWith = (customerId: string | null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { stripe_customer_id: customerId } }) }) }) }),
}) as unknown as SupabaseClient

const stripeWith = (list: () => Promise<{ data: unknown[] }>) =>
  ({ subscriptions: { list } }) as unknown as Stripe

describe('referralMonthsClaimedFor', () => {
  it('is 0 for a user with no Stripe customer', async () => {
    const list = vi.fn()
    expect(await referralMonthsClaimedFor(svcWith(null), stripeWith(list), 'u')).toBe(0)
    expect(list).not.toHaveBeenCalled()
  })

  it('sums stamped referral claims and ignores other subscriptions', async () => {
    const stripe = stripeWith(async () => ({ data: [
      { status: 'canceled', trial_start: null, trial_end: null, metadata: { flow: 'referral', referral_months: '2' } },
      { status: 'canceled', trial_start: null, trial_end: null, metadata: { flow: 'trial' } },
    ] }))
    expect(await referralMonthsClaimedFor(svcWith('cus_1'), stripe, 'u')).toBe(2)
  })

  it('treats a stale sandbox customer id as nothing claimed', async () => {
    const stripe = stripeWith(async () => {
      throw Object.assign(new Error("No such customer: 'cus_old'"), { code: 'resource_missing', param: 'customer' })
    })
    expect(await referralMonthsClaimedFor(svcWith('cus_old'), stripe, 'u')).toBe(0)
  })

  it('returns null, not 0, when Stripe is unavailable', async () => {
    const stripe = stripeWith(async () => { throw Object.assign(new Error('upstream'), { code: 'api_error' }) })
    expect(await referralMonthsClaimedFor(svcWith('cus_1'), stripe, 'u')).toBeNull()
  })
})
