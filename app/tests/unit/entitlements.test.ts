import { describe, it, expect } from 'vitest'
import {
  TIER_RANK, JOURNAL_FREE_LIMIT, tierFromSubscriptions,
  planForPrice, priceForPlan, can, higherTier, normalizeCompTier, resolveTier, type PlanEnv,
} from '@/lib/entitlements'

const ENV: PlanEnv = {
  STRIPE_PRICE_TRADER_MONTHLY: 'price_tm',
  STRIPE_PRICE_TRADER_ANNUAL: 'price_ta',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pm',
  STRIPE_PRICE_PRO_ANNUAL: 'price_pa',
}

describe('tierFromSubscriptions', () => {
  it('returns free with no active subs', () => {
    expect(tierFromSubscriptions([])).toBe('free')
    expect(tierFromSubscriptions([{ tier: 'pro', status: 'canceled' }])).toBe('free')
    expect(tierFromSubscriptions([{ tier: 'trader', status: 'past_due' }])).toBe('free')
  })
  it('counts active and trialing', () => {
    expect(tierFromSubscriptions([{ tier: 'trader', status: 'active' }])).toBe('trader')
    expect(tierFromSubscriptions([{ tier: 'pro', status: 'trialing' }])).toBe('pro')
  })
  it('picks the highest active tier', () => {
    expect(tierFromSubscriptions([
      { tier: 'trader', status: 'active' },
      { tier: 'pro', status: 'active' },
    ])).toBe('pro')
  })
  it('ignores unknown tier strings', () => {
    expect(tierFromSubscriptions([{ tier: 'gold', status: 'active' }])).toBe('free')
  })
})

describe('planForPrice / priceForPlan', () => {
  it('resolves a known price', () => {
    expect(planForPrice('price_pa', ENV)).toEqual({ tier: 'pro', interval: 'annual' })
    expect(planForPrice('price_tm', ENV)).toEqual({ tier: 'trader', interval: 'monthly' })
  })
  it('returns null for an unknown price', () => {
    expect(planForPrice('price_x', ENV)).toBeNull()
  })
  it('round-trips plan -> price', () => {
    expect(priceForPlan('trader', 'annual', ENV)).toBe('price_ta')
    expect(priceForPlan('pro', 'monthly', ENV)).toBe('price_pm')
    expect(priceForPlan('free', 'monthly', ENV)).toBeNull()
  })
})

describe('can', () => {
  it('gates by rank', () => {
    expect(can('free', 'journal_unlimited')).toBe(false)
    expect(can('trader', 'journal_unlimited')).toBe(true)
    expect(can('trader', 'advanced_stats')).toBe(true)
    expect(can('free', 'advanced_stats')).toBe(false)
    expect(can('trader', 'pro_badge')).toBe(false)
    expect(can('pro', 'pro_badge')).toBe(true)
    expect(can('trader', 'learning_intermediate')).toBe(true)
    expect(can('free', 'learning_intermediate')).toBe(false)
    expect(can('pro', 'premium_courses')).toBe(true)
    expect(can('trader', 'premium_courses')).toBe(false)
  })
})

describe('constants', () => {
  it('ranks and limit', () => {
    expect(TIER_RANK).toEqual({ free: 0, trader: 1, pro: 2 })
    expect(JOURNAL_FREE_LIMIT).toBe(30)
  })
})

describe('crypto feature gates', () => {
  it('gates crypto import and autosync at pro', () => {
    expect(can('free', 'crypto_import')).toBe(false)
    expect(can('trader', 'crypto_import')).toBe(false)
    expect(can('pro', 'crypto_import')).toBe(true)
    expect(can('trader', 'crypto_autosync')).toBe(false)
    expect(can('pro', 'crypto_autosync')).toBe(true)
  })
})

describe('higherTier', () => {
  it('returns the higher-ranked tier regardless of order', () => {
    expect(higherTier('free', 'pro')).toBe('pro')
    expect(higherTier('pro', 'free')).toBe('pro')
    expect(higherTier('trader', 'pro')).toBe('pro')
    expect(higherTier('trader', 'free')).toBe('trader')
    expect(higherTier('free', 'free')).toBe('free')
  })
})

describe('resolveTier', () => {
  const NOW = new Date('2026-07-31T12:00:00Z')
  const dayBefore = (days: number) => new Date(NOW.getTime() - days * 864e5).toISOString()

  it('is free with nothing at all', () => {
    expect(resolveTier({ subs: [] }, NOW)).toBe('free')
  })
  it('reads an active subscription', () => {
    expect(resolveTier({ subs: [{ tier: 'trader', status: 'active' }] }, NOW)).toBe('trader')
    expect(resolveTier({ subs: [{ tier: 'pro', status: 'canceled' }] }, NOW)).toBe('free')
  })
  it('counts an active trial as pro and an expired one as free', () => {
    expect(resolveTier({ subs: [], trialStartedAt: dayBefore(3) }, NOW)).toBe('pro')
    expect(resolveTier({ subs: [], trialStartedAt: dayBefore(20) }, NOW)).toBe('free')
  })
  it('never lets a trial or comp downgrade a higher grant', () => {
    expect(resolveTier({ subs: [{ tier: 'pro', status: 'active' }], trialStartedAt: dayBefore(20) }, NOW)).toBe('pro')
    expect(resolveTier({ subs: [{ tier: 'trader', status: 'active' }], compTier: 'pro' }, NOW)).toBe('pro')
  })
  it('gives admins pro regardless of everything else', () => {
    expect(resolveTier({ isAdmin: true, subs: [], trialStartedAt: dayBefore(99) }, NOW)).toBe('pro')
  })
  it('matches getEntitlements: an unreadable subscription list is not a grant', () => {
    expect(resolveTier({ subs: [], compTier: null }, NOW)).toBe('free')
  })
})

describe('normalizeCompTier', () => {
  it('passes through valid comp tiers', () => {
    expect(normalizeCompTier('trader')).toBe('trader')
    expect(normalizeCompTier('pro')).toBe('pro')
  })
  it('maps null/empty/invalid to free', () => {
    expect(normalizeCompTier(null)).toBe('free')
    expect(normalizeCompTier(undefined)).toBe('free')
    expect(normalizeCompTier('free')).toBe('free')
    expect(normalizeCompTier('gold')).toBe('free')
  })
})
