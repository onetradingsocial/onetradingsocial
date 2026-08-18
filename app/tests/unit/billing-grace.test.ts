import { describe, it, expect } from 'vitest'
import {
  PAST_DUE_GRACE_DAYS, subscriptionGrantsTier, graceDaysLeft,
  tierFromSubscriptions, subStatusRank, pickCurrentSubscription, resolveTier,
} from '@/lib/entitlements'

const NOW = new Date('2026-08-18T12:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString()
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 864e5).toISOString()

describe('subscriptionGrantsTier', () => {
  it('grants for active and trialing regardless of timestamps', () => {
    expect(subscriptionGrantsTier({ tier: 'trader', status: 'active' }, NOW)).toBe(true)
    expect(subscriptionGrantsTier({ tier: 'pro', status: 'trialing' }, NOW)).toBe(true)
    expect(subscriptionGrantsTier({ tier: 'pro', status: 'active', updated_at: daysAgo(900) }, NOW)).toBe(true)
  })

  it('grants for past_due inside the grace window', () => {
    expect(subscriptionGrantsTier({ tier: 'trader', status: 'past_due', updated_at: daysAgo(0) }, NOW)).toBe(true)
    expect(subscriptionGrantsTier({ tier: 'trader', status: 'past_due', updated_at: daysAgo(13.9) }, NOW)).toBe(true)
  })

  it('stops granting the instant the window closes', () => {
    expect(subscriptionGrantsTier(
      { tier: 'trader', status: 'past_due', updated_at: daysAgo(PAST_DUE_GRACE_DAYS) }, NOW,
    )).toBe(false)
    expect(subscriptionGrantsTier({ tier: 'trader', status: 'past_due', updated_at: daysAgo(60) }, NOW)).toBe(false)
  })

  it('fails closed when the grace clock is missing or unreadable', () => {
    // A caller that did not select updated_at gets the pre-grace behaviour
    // rather than an accidental unlimited grant.
    expect(subscriptionGrantsTier({ tier: 'trader', status: 'past_due' }, NOW)).toBe(false)
    expect(subscriptionGrantsTier({ tier: 'trader', status: 'past_due', updated_at: null }, NOW)).toBe(false)
    expect(subscriptionGrantsTier({ tier: 'trader', status: 'past_due', updated_at: 'not-a-date' }, NOW)).toBe(false)
  })

  it('gives NO grace to the statuses that mean dunning is already over', () => {
    // unpaid is reached only once Stripe's retries are exhausted; incomplete
    // means the first payment never succeeded, so the tier was never held.
    for (const status of ['unpaid', 'incomplete', 'incomplete_expired', 'canceled', 'paused']) {
      expect(subscriptionGrantsTier({ tier: 'pro', status, updated_at: daysAgo(0) }, NOW)).toBe(false)
    }
  })
})

describe('graceDaysLeft', () => {
  it('counts down whole days and never goes negative', () => {
    const g = (n: number) => graceDaysLeft({ tier: 'pro', status: 'past_due', updated_at: daysAgo(n) }, NOW)
    expect(g(0)).toBe(PAST_DUE_GRACE_DAYS)
    expect(g(13.5)).toBe(1)
    expect(g(PAST_DUE_GRACE_DAYS)).toBe(0)
    expect(g(99)).toBe(0)
  })
  it('is 0 for anything that is not past_due', () => {
    expect(graceDaysLeft({ tier: 'pro', status: 'active', updated_at: daysAgo(0) }, NOW)).toBe(0)
    expect(graceDaysLeft({ tier: 'pro', status: 'canceled', updated_at: daysAgo(0) }, NOW)).toBe(0)
  })
})

describe('tierFromSubscriptions with grace', () => {
  it('holds the tier through a fresh failed payment', () => {
    expect(tierFromSubscriptions(
      [{ tier: 'trader', status: 'past_due', updated_at: daysAgo(3) }], NOW,
    )).toBe('trader')
  })
  it('drops it once the window closes', () => {
    expect(tierFromSubscriptions(
      [{ tier: 'trader', status: 'past_due', updated_at: daysAgo(20) }], NOW,
    )).toBe('free')
  })
  it('still returns the highest granting tier across rows', () => {
    expect(tierFromSubscriptions([
      { tier: 'pro', status: 'past_due', updated_at: daysAgo(30) },   // out of grace
      { tier: 'trader', status: 'active' },
    ], NOW)).toBe('trader')
  })
  it('flows through resolveTier on the same clock', () => {
    expect(resolveTier(
      { subs: [{ tier: 'pro', status: 'past_due', updated_at: daysAgo(1) }] }, NOW,
    )).toBe('pro')
    expect(resolveTier(
      { subs: [{ tier: 'pro', status: 'past_due', updated_at: daysAgo(30) }] }, NOW,
    )).toBe('free')
  })
})

describe('subStatusRank', () => {
  it('ranks entitling > recoverable > over', () => {
    expect(subStatusRank({ tier: 'pro', status: 'active' }, NOW)).toBe(2)
    expect(subStatusRank({ tier: 'pro', status: 'past_due', updated_at: daysAgo(1) }, NOW)).toBe(2)
    expect(subStatusRank({ tier: 'pro', status: 'past_due', updated_at: daysAgo(40) }, NOW)).toBe(1)
    expect(subStatusRank({ tier: 'pro', status: 'unpaid' }, NOW)).toBe(1)
    expect(subStatusRank({ tier: 'pro', status: 'canceled' }, NOW)).toBe(0)
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
