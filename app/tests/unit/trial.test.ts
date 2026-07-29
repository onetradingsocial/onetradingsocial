import { describe, it, expect } from 'vitest'
import {
  TRIAL_DAYS, trialState, trialDaysLeft, effectiveTier, shouldShowWall,
} from '@/lib/entitlements'

const NOW = new Date('2026-07-29T12:00:00.000Z')
const daysBefore = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

describe('trialState', () => {
  it('is none when no trial was ever started', () => {
    expect(trialState(null, null, NOW)).toBe('none')
    expect(trialState(undefined, undefined, NOW)).toBe('none')
    // A stray ack without a start is still "never on a trial".
    expect(trialState(null, daysBefore(1), NOW)).toBe('none')
  })

  it('is active from day 0 until the instant day 14 arrives', () => {
    expect(trialState(daysBefore(0), null, NOW)).toBe('active')
    expect(trialState(daysBefore(1), null, NOW)).toBe('active')
    expect(trialState(daysBefore(13.9), null, NOW)).toBe('active')
  })

  it('is expired at exactly 14 days and beyond', () => {
    expect(trialState(daysBefore(14), null, NOW)).toBe('expired')
    expect(trialState(daysBefore(400), null, NOW)).toBe('expired')
  })

  it('is resolved once acknowledged, whatever the elapsed time', () => {
    expect(trialState(daysBefore(400), daysBefore(300), NOW)).toBe('resolved')
    expect(trialState(daysBefore(1), daysBefore(1), NOW)).toBe('resolved')
  })
})

describe('trialDaysLeft', () => {
  it('counts down whole days and never goes negative', () => {
    expect(trialDaysLeft(daysBefore(0), NOW)).toBe(TRIAL_DAYS)
    expect(trialDaysLeft(daysBefore(13.5), NOW)).toBe(1)
    expect(trialDaysLeft(daysBefore(14), NOW)).toBe(0)
    expect(trialDaysLeft(daysBefore(99), NOW)).toBe(0)
  })

  it('is 0 with no trial', () => {
    expect(trialDaysLeft(null, NOW)).toBe(0)
  })
})

describe('effectiveTier', () => {
  it('grants pro while the trial is active', () => {
    expect(effectiveTier(null, 'free', 'active')).toBe('pro')
  })

  it('never downgrades a paying user', () => {
    expect(effectiveTier(null, 'pro', 'expired')).toBe('pro')
    expect(effectiveTier(null, 'trader', 'expired')).toBe('trader')
    // Trial pro outranks a Trader sub — a deliberate gift until day 14.
    expect(effectiveTier(null, 'trader', 'active')).toBe('pro')
  })

  it('honours comp grants after the trial ends', () => {
    expect(effectiveTier('trader', 'free', 'expired')).toBe('trader')
    expect(effectiveTier('pro', 'free', 'resolved')).toBe('pro')
  })

  it('falls back to free once the trial is over', () => {
    expect(effectiveTier(null, 'free', 'expired')).toBe('free')
    expect(effectiveTier(null, 'free', 'resolved')).toBe('free')
    expect(effectiveTier(null, 'free', 'none')).toBe('free')
    expect(effectiveTier('gold', 'free', 'expired')).toBe('free')
  })
})

describe('shouldShowWall', () => {
  it('walls only an expired trial on the free tier with the flag on', () => {
    expect(shouldShowWall('expired', 'free', true)).toBe(true)
  })

  it('does not wall when any one condition fails', () => {
    expect(shouldShowWall('expired', 'free', false)).toBe(false)
    expect(shouldShowWall('expired', 'trader', true)).toBe(false)
    expect(shouldShowWall('expired', 'pro', true)).toBe(false)
    expect(shouldShowWall('active', 'free', true)).toBe(false)
    expect(shouldShowWall('resolved', 'free', true)).toBe(false)
    expect(shouldShowWall('none', 'free', true)).toBe(false)
  })
})
