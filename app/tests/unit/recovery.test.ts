import { describe, it, expect } from 'vitest'
import {
  recoveryNudge, recoveryDue, recoveryGapDays, sinceLabel, RECOVERY_STOP_DAYS,
} from '@/lib/recovery'

/**
 * The bug these guard against: the old rules capped eligibility at
 * `ageDays <= 30` (never-traded) and `since last trade <= 30 days`. Both read as
 * throttling and acted as permanent exclusion — measured against production,
 * 24 of 40 users matched no condition at all and never would again.
 *
 * The opposite error is just as easy to ship, so both directions are tested:
 * a long-lapsed user must still be reachable, AND must eventually be left alone.
 */
describe('recoveryNudge — reachability', () => {
  const neverTraded = (daysSinceSignup: number) =>
    recoveryNudge({ tradeCount: 0, daysSinceSignup, daysSinceLastTrade: null })

  it('reaches a never-traded user long past the old 30-day cliff', () => {
    // Day 45 and day 120 both returned null under the old rules.
    expect(neverTraded(45)).not.toBeNull()
    expect(neverTraded(120)).not.toBeNull()
  })

  it('reaches a lapsed trader whose last trade is older than a month', () => {
    const n = recoveryNudge({ tradeCount: 8, daysSinceSignup: 200, daysSinceLastTrade: 95 })
    expect(n).not.toBeNull()
    expect(n?.cta).toBe('Back to your journal')
  })

  it('still leaves brand-new and still-active accounts alone', () => {
    expect(neverTraded(1)).toBeNull()                                                  // too new
    expect(recoveryNudge({ tradeCount: 5, daysSinceSignup: 40, daysSinceLastTrade: 3 })) // still trading
      .toBeNull()
  })

  it('stops entirely at six months rather than nagging forever', () => {
    expect(neverTraded(RECOVERY_STOP_DAYS)).toBeNull()
    expect(neverTraded(400)).toBeNull()
    expect(recoveryNudge({ tradeCount: 3, daysSinceSignup: 400, daysSinceLastTrade: 365 })).toBeNull()
  })

  it('picks the message that matches the user, not a generic one', () => {
    expect(neverTraded(10)?.cta).toBe('Log your first trade')
    expect(recoveryNudge({ tradeCount: 1, daysSinceSignup: 30, daysSinceLastTrade: 20 })?.cta)
      .toBe('Log another trade')
  })

  it('never tells a months-lapsed user it has been "over a week"', () => {
    // The old copy said "over a week" to everyone, which reads as broken
    // automation to someone four months gone.
    const n = recoveryNudge({ tradeCount: 4, daysSinceSignup: 200, daysSinceLastTrade: 100 })
    expect(n?.reason).not.toContain('over a week')
    expect(n?.reason).toContain('a few months')
  })
})

describe('recoveryGapDays — contact decays, then ends', () => {
  it('widens the gap as someone stays lapsed', () => {
    expect(recoveryGapDays(3)).toBe(7)
    expect(recoveryGapDays(45)).toBe(21)
    expect(recoveryGapDays(120)).toBe(45)
  })
  it('returns null once we should stop', () => {
    expect(recoveryGapDays(RECOVERY_STOP_DAYS)).toBeNull()
    expect(recoveryGapDays(500)).toBeNull()
  })
})

describe('recoveryDue — throttle honours the decaying gap', () => {
  it('lets a never-emailed user through', () => {
    expect(recoveryDue({ lapsedDays: 10, daysSinceLastRecoveryEmail: null })).toBe(true)
  })
  it('holds a recently-emailed user back', () => {
    expect(recoveryDue({ lapsedDays: 10, daysSinceLastRecoveryEmail: 2 })).toBe(false)
  })
  it('applies the wider gap to the longer-lapsed', () => {
    // 14 days since last email: due at the 7-day tier, not yet at the 21-day one.
    expect(recoveryDue({ lapsedDays: 10, daysSinceLastRecoveryEmail: 14 })).toBe(true)
    expect(recoveryDue({ lapsedDays: 60, daysSinceLastRecoveryEmail: 14 })).toBe(false)
  })
  it('never comes due once contact has stopped', () => {
    expect(recoveryDue({ lapsedDays: 400, daysSinceLastRecoveryEmail: 999 })).toBe(false)
  })
})

describe('sinceLabel', () => {
  it('scales with the actual gap', () => {
    expect(sinceLabel(8)).toBe('over a week')
    expect(sinceLabel(20)).toBe('a couple of weeks')
    expect(sinceLabel(40)).toBe('over a month')
    expect(sinceLabel(100)).toBe('a few months')
  })
})
