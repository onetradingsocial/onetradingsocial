// app/tests/unit/checkout-eligibility.test.ts
//
// The rules in lib/checkout-eligibility.ts, without the route around them.
// billing-checkout-trial.test.ts drives the same rules through the route.
import { describe, it, expect } from 'vitest'
import {
  checkoutRefusal, referralMonthsClaimed, referralMonthsAvailable, type PriorSubscription,
} from '@/lib/checkout-eligibility'

const sub = (over: Partial<PriorSubscription> = {}): PriorSubscription => ({
  status: 'canceled', trialStart: null, trialEnd: null, flow: null, referralMonths: null, ...over,
})

describe('checkoutRefusal', () => {
  it('lets a brand-new account open any flow', () => {
    for (const flow of [undefined, 'trial', 'trial_end', 'referral'] as const) {
      expect(checkoutRefusal({ flow, subs: [], localTrialStarted: false })).toBeNull()
    }
  })

  it('refuses every flow beside a live subscription', () => {
    for (const status of ['trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete']) {
      for (const flow of [undefined, 'trial', 'referral'] as const) {
        expect(checkoutRefusal({ flow, subs: [sub({ status })], localTrialStarted: false })?.status).toBe(409)
      }
    }
  })

  it('treats canceled and incomplete_expired as finished', () => {
    const subs = [sub({ status: 'canceled' }), sub({ status: 'incomplete_expired' })]
    expect(checkoutRefusal({ flow: undefined, subs, localTrialStarted: false })).toBeNull()
    expect(checkoutRefusal({ flow: 'referral', subs, localTrialStarted: false })).toBeNull()
  })

  it('refuses the trial to any account with history, or a legacy trial', () => {
    expect(checkoutRefusal({ flow: 'trial', subs: [sub()], localTrialStarted: false })?.reason).toBe('trial already used')
    expect(checkoutRefusal({ flow: 'trial', subs: [], localTrialStarted: true })?.reason).toBe('trial already used')
  })
})

describe('referral month ledger', () => {
  it('reads the stamp when present', () => {
    expect(referralMonthsClaimed([sub({ flow: 'referral', referralMonths: '3' })])).toBe(3)
  })

  it('falls back to trial length for unstamped claims, counting at least one', () => {
    const start = 1_700_000_000
    expect(referralMonthsClaimed([sub({ flow: 'referral', trialStart: start, trialEnd: start + 90 * 86_400 })])).toBe(3)
    expect(referralMonthsClaimed([sub({ flow: 'referral', trialStart: start, trialEnd: start + 86_400 })])).toBe(1)
    expect(referralMonthsClaimed([sub({
      flow: 'referral', trialStart: '2026-08-01T00:00:00Z', trialEnd: '2026-08-31T00:00:00Z',
    })])).toBe(1)
  })

  it('ignores subscriptions that were not referral claims', () => {
    expect(referralMonthsClaimed([sub({ flow: 'trial', referralMonths: '4' }), sub()])).toBe(0)
  })

  it('never goes negative', () => {
    expect(referralMonthsAvailable(2, [sub({ flow: 'referral', referralMonths: '5' })])).toBe(0)
  })
})
