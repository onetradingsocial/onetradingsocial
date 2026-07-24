import { describe, it, expect } from 'vitest'
import {
  TIER_RANK, JOURNAL_FREE_LIMIT, tierFromSubscriptions,
  planForPrice, priceForPlan, can, type PlanEnv,
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
  it('gates import at trader and autosync at pro', () => {
    expect(can('free', 'crypto_import')).toBe(false)
    expect(can('trader', 'crypto_import')).toBe(true)
    expect(can('trader', 'crypto_autosync')).toBe(false)
    expect(can('pro', 'crypto_autosync')).toBe(true)
  })
})
