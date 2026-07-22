import { describe, it, expect } from 'vitest'
import {
  rewardsFor, nextReward, makeReferralCode, conversionRates, REWARD_LADDER,
  earnedMonths, REFERRAL_MONTH_CAP,
} from '@/lib/referral'

describe('earnedMonths', () => {
  it('grants one free Pro month per activated referral', () => {
    expect(earnedMonths(0)).toBe(0)
    expect(earnedMonths(1)).toBe(1)
    expect(earnedMonths(7)).toBe(7)
  })
  it('caps at a full year and never goes negative', () => {
    expect(earnedMonths(REFERRAL_MONTH_CAP)).toBe(12)
    expect(earnedMonths(50)).toBe(12)
    expect(earnedMonths(-3)).toBe(0)
  })
})

describe('rewardsFor', () => {
  it('earns nothing at zero activated referrals', () => {
    expect(rewardsFor(0).every((r) => !r.earned)).toBe(true)
  })

  it('earns progressively as activations accrue', () => {
    expect(rewardsFor(1).filter((r) => r.earned).map((r) => r.id)).toEqual(['founder_badge'])
    expect(rewardsFor(3).filter((r) => r.earned)).toHaveLength(2)
    expect(rewardsFor(99).every((r) => r.earned)).toBe(true)
  })

  it('ignores signups that never activated — rewards key off activations only', () => {
    // The function takes activated count by construction; this asserts the
    // ladder thresholds are the activation numbers, not signup numbers.
    expect(REWARD_LADDER.map((r) => r.needs)).toEqual([1, 3, 5, 10])
  })
})

describe('nextReward', () => {
  it('reports what is left to unlock', () => {
    const n = nextReward(1)!
    expect(n.reward.id).toBe('premium_month')
    expect(n.remaining).toBe(2)
  })
  it('returns null once everything is earned', () => {
    expect(nextReward(50)).toBeNull()
  })
})

describe('makeReferralCode', () => {
  it('slugs the username, caps it at 10 chars, and appends salt', () => {
    expect(makeReferralCode('Mateo_Rivera!', 'AB12')).toBe('mateoriver-ab12')
    expect(makeReferralCode('short', 'AB12')).toBe('short-ab12')
  })
  it('falls back when the username has no usable characters', () => {
    expect(makeReferralCode('!!!', 'XY99')).toBe('trader-xy99')
  })
  it('is not guessable from the username alone', () => {
    const a = makeReferralCode('sameuser', 'aaaa')
    const b = makeReferralCode('sameuser', 'bbbb')
    expect(a).not.toBe(b)
  })
})

describe('conversionRates', () => {
  it('computes percentages', () => {
    const r = conversionRates({ clicks: 100, signups: 20, activated: 10, paid: 2 })
    expect(r.clickToSignup).toBe(20)
    expect(r.signupToActivated).toBe(50)
  })
  it('does not divide by zero', () => {
    const r = conversionRates({ clicks: 0, signups: 0, activated: 0, paid: 0 })
    expect(r.clickToSignup).toBe(0)
    expect(r.signupToActivated).toBe(0)
  })
})
