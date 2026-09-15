import { describe, it, expect } from 'vitest'
import {
  PAST_DUE_GRACE_DAYS, subscriptionGrantsTier, graceDaysLeft,
  tierFromSubscriptions, subStatusRank, pickCurrentSubscription, resolveTier, TRIAL_DAYS,
} from '@/lib/entitlements'

const NOW = new Date('2026-08-18T12:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString()
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 864e5).toISOString()

/** A past_due row for a customer who HAS paid before — a failed renewal, and
 *  the only kind of past_due that earns grace since 0079. `first_paid_at` is
 *  dated well before dunning started, as a real one would be. */
const renewalFailure = (daysIntoDunning: number, tier = 'trader') => ({
  tier, status: 'past_due',
  updated_at: daysAgo(daysIntoDunning),
  first_paid_at: daysAgo(daysIntoDunning + 60),
})

/** A past_due row for a subscription that never took a payment — a TRIAL whose
 *  conversion charge declined. Same status, no money, no grace. */
const trialConversionFailure = (daysIntoDunning: number, tier = 'trader') => ({
  tier, status: 'past_due', updated_at: daysAgo(daysIntoDunning),
})

describe('subscriptionGrantsTier', () => {
  it('grants for active and trialing regardless of timestamps', () => {
    expect(subscriptionGrantsTier({ tier: 'trader', status: 'active' }, NOW)).toBe(true)
    expect(subscriptionGrantsTier({ tier: 'pro', status: 'trialing' }, NOW)).toBe(true)
    expect(subscriptionGrantsTier({ tier: 'pro', status: 'active', updated_at: daysAgo(900) }, NOW)).toBe(true)
  })

  it('grants for past_due inside the grace window', () => {
    expect(subscriptionGrantsTier(renewalFailure(0), NOW)).toBe(true)
    expect(subscriptionGrantsTier(renewalFailure(6.9), NOW)).toBe(true)
  })

  it('stops granting the instant the window closes', () => {
    expect(subscriptionGrantsTier(renewalFailure(PAST_DUE_GRACE_DAYS), NOW)).toBe(false)
    expect(subscriptionGrantsTier(renewalFailure(60), NOW)).toBe(false)
  })

  it('fails closed when the grace clock is missing or unreadable', () => {
    // A caller that did not select updated_at gets the pre-grace behaviour
    // rather than an accidental unlimited grant.
    expect(subscriptionGrantsTier({ tier: 'trader', status: 'past_due', first_paid_at: daysAgo(90) }, NOW)).toBe(false)
    expect(subscriptionGrantsTier({ tier: 'trader', status: 'past_due', updated_at: null, first_paid_at: daysAgo(90) }, NOW)).toBe(false)
    expect(subscriptionGrantsTier({ tier: 'trader', status: 'past_due', updated_at: 'not-a-date', first_paid_at: daysAgo(90) }, NOW)).toBe(false)
  })

  it('gives NO grace to the statuses that mean dunning is already over', () => {
    // unpaid is reached only once Stripe's retries are exhausted; incomplete
    // means the first payment never succeeded, so the tier was never held.
    for (const status of ['unpaid', 'incomplete', 'incomplete_expired', 'canceled', 'paused']) {
      expect(subscriptionGrantsTier({ tier: 'pro', status, updated_at: daysAgo(0), first_paid_at: daysAgo(90) }, NOW)).toBe(false)
    }
  })

  // ── 0079: the failed TRIAL CONVERSION ──────────────────────────────────────
  //
  // Stripe puts it in `past_due`, identical to a failed renewal, because the
  // subscription was established. The customer has paid nothing. Before this,
  // the grace window sat on top of the 14 trial days and handed out 28 days of
  // Pro on a card that never worked — repeatable with a fresh account.
  it('gives NO grace to a past_due subscription that never took a payment', () => {
    expect(subscriptionGrantsTier(trialConversionFailure(0), NOW)).toBe(false)
    expect(subscriptionGrantsTier(trialConversionFailure(1), NOW)).toBe(false)
    expect(subscriptionGrantsTier({ ...trialConversionFailure(0), first_paid_at: null }, NOW)).toBe(false)
  })

  it('treats an unreadable first_paid_at as never paid', () => {
    expect(subscriptionGrantsTier({ ...trialConversionFailure(0), first_paid_at: 'not-a-date' }, NOW)).toBe(false)
  })

  it('still grants the same day a real renewal fails', () => {
    // The point of the change is to withhold grace from the never-paid, NOT to
    // make dunning harsher for customers. This is the case grace exists for.
    expect(subscriptionGrantsTier(renewalFailure(0.1), NOW)).toBe(true)
  })
})

describe('graceDaysLeft', () => {
  it('counts down whole days and never goes negative', () => {
    const g = (n: number) => graceDaysLeft(renewalFailure(n, 'pro'), NOW)
    expect(g(0)).toBe(PAST_DUE_GRACE_DAYS)
    expect(g(6.5)).toBe(1)
    expect(g(PAST_DUE_GRACE_DAYS)).toBe(0)
    expect(g(99)).toBe(0)
  })
  it('is 0 for anything that is not past_due', () => {
    expect(graceDaysLeft({ tier: 'pro', status: 'active', updated_at: daysAgo(0), first_paid_at: daysAgo(90) }, NOW)).toBe(0)
    expect(graceDaysLeft({ tier: 'pro', status: 'canceled', updated_at: daysAgo(0), first_paid_at: daysAgo(90) }, NOW)).toBe(0)
  })
  it('is 0 for a never-paid past_due, so no countdown is offered that the tier will not honour', () => {
    expect(graceDaysLeft(trialConversionFailure(0, 'pro'), NOW)).toBe(0)
  })
})

describe('the grace window is one week', () => {
  it('is 7 days, and deliberately not the same number as the trial', () => {
    // They were both 14 for explainability. That stopped being a virtue once a
    // trial could turn into a dunning case — one number doing both jobs invited
    // exactly the confusion the first_paid_at rule exists to remove.
    expect(PAST_DUE_GRACE_DAYS).toBe(7)
    expect(PAST_DUE_GRACE_DAYS).not.toBe(TRIAL_DAYS)
  })

  it('caps a paying customer at 7 free days, not 14', () => {
    expect(subscriptionGrantsTier(renewalFailure(6.9), NOW)).toBe(true)
    expect(subscriptionGrantsTier(renewalFailure(7.1), NOW)).toBe(false)
  })
})

describe('tierFromSubscriptions with grace', () => {
  it('holds the tier through a fresh failed payment', () => {
    expect(tierFromSubscriptions([renewalFailure(3)], NOW)).toBe('trader')
  })
  it('drops it once the window closes', () => {
    expect(tierFromSubscriptions([renewalFailure(20)], NOW)).toBe('free')
  })
  it('drops a never-paid trial conversion immediately', () => {
    expect(tierFromSubscriptions([trialConversionFailure(0, 'pro')], NOW)).toBe('free')
  })
  it('still returns the highest granting tier across rows', () => {
    expect(tierFromSubscriptions([
      renewalFailure(30, 'pro'),                      // out of grace
      { tier: 'trader', status: 'active' },
    ], NOW)).toBe('trader')
  })
  it('flows through resolveTier on the same clock', () => {
    expect(resolveTier({ subs: [renewalFailure(1, 'pro')] }, NOW)).toBe('pro')
    expect(resolveTier({ subs: [renewalFailure(30, 'pro')] }, NOW)).toBe('free')
    expect(resolveTier({ subs: [trialConversionFailure(1, 'pro')] }, NOW)).toBe('free')
  })
})

describe('subStatusRank', () => {
  it('ranks entitling > recoverable > over', () => {
    expect(subStatusRank({ tier: 'pro', status: 'active' }, NOW)).toBe(2)
    expect(subStatusRank(renewalFailure(1, 'pro'), NOW)).toBe(2)
    expect(subStatusRank(renewalFailure(40, 'pro'), NOW)).toBe(1)
    expect(subStatusRank({ tier: 'pro', status: 'unpaid' }, NOW)).toBe(1)
    expect(subStatusRank({ tier: 'pro', status: 'canceled' }, NOW)).toBe(0)
  })
  it('still calls a never-paid past_due RECOVERABLE, not over', () => {
    // It grants nothing, but the customer can still fix it by adding a working
    // card, so the billing page should describe it rather than bury it.
    expect(subStatusRank(trialConversionFailure(0, 'pro'), NOW)).toBe(1)
  })
})

describe('pickCurrentSubscription (item 12 F10)', () => {
  it('returns null for no rows', () => {
    expect(pickCurrentSubscription([], NOW)).toBeNull()
  })

  it('prefers an ACTIVE lower tier over a CANCELED higher one', () => {
    // The regression this fix exists for: sorting on tier alone drove the whole
    // billing page from the dead Pro row — wrong status, wrong renewal date,
    // "your plan" marker on the wrong card, Checkout offered for a held plan.
    const rows = [
      { tier: 'pro', status: 'canceled', current_period_end: daysAgo(90) },
      { tier: 'trader', status: 'active', current_period_end: daysAhead(20) },
    ]
    expect(pickCurrentSubscription(rows, NOW)?.tier).toBe('trader')
    // ...and independent of the order PostgREST happened to return them in.
    expect(pickCurrentSubscription([...rows].reverse(), NOW)?.tier).toBe('trader')
  })

  it('still prefers the higher tier when both rows entitle', () => {
    expect(pickCurrentSubscription([
      { tier: 'trader', status: 'active' },
      { tier: 'pro', status: 'active' },
    ], NOW)?.tier).toBe('pro')
  })

  it('treats a past_due row in grace as live, and out of grace as merely recoverable', () => {
    expect(pickCurrentSubscription([
      { tier: 'trader', status: 'past_due', updated_at: daysAgo(2) },
      { tier: 'pro', status: 'canceled' },
    ], NOW)?.tier).toBe('trader')
    // Out of grace it still beats a canceled row for DISPLAY — "update your
    // card" is more useful to show than a subscription that is simply over.
    expect(pickCurrentSubscription([
      { tier: 'trader', status: 'past_due', updated_at: daysAgo(40) },
      { tier: 'pro', status: 'canceled' },
    ], NOW)?.status).toBe('past_due')
  })

  it('breaks ties on the later period end', () => {
    expect(pickCurrentSubscription([
      { tier: 'trader', status: 'canceled', current_period_end: daysAgo(200) },
      { tier: 'trader', status: 'canceled', current_period_end: daysAgo(10) },
    ], NOW)?.current_period_end).toBe(daysAgo(10))
  })

  it('does not mutate the caller\'s array', () => {
    const rows = [
      { tier: 'pro', status: 'canceled' },
      { tier: 'trader', status: 'active' },
    ]
    pickCurrentSubscription(rows, NOW)
    expect(rows[0].tier).toBe('pro')
  })
})
