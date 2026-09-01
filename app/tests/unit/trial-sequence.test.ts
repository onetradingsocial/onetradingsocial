import { describe, it, expect } from 'vitest'
import { dueTrialStage, trialStageIsOptional, TRIAL_STAGES } from '@/lib/trial-sequence'
import { TRIAL_DAYS } from '@/lib/entitlements'

/**
 * The trial used to be silent from day 0 to day 14. These guard the two ways
 * the fix could be worse than the silence: replaying a stale "day one, here's
 * how to start" email at day nine, and letting a "two days left" email land
 * after the trial has already ended and been announced as over.
 */
describe('dueTrialStage', () => {
  const at = (daysSinceStart: number, lastStageSent: number | null = null) =>
    dueTrialStage({ daysSinceStart, lastStageSent })

  it('sends nothing on the day the trial starts', () => {
    expect(at(0)).toBeNull()
  })

  it('sends each stage on its day', () => {
    expect(at(1)).toBe(1)
    expect(at(7, 1)).toBe(7)
    expect(at(12, 7)).toBe(12)
  })

  it('does not resend a stage already sent', () => {
    expect(at(1, 1)).toBeNull()
    expect(at(7, 7)).toBeNull()
    expect(at(12, 12)).toBeNull()
  })

  it('holds between stages', () => {
    expect(at(3, 1)).toBeNull()
    expect(at(6, 1)).toBeNull()
    expect(at(11, 7)).toBeNull()
  })

  it('catches a late user up to the RIGHT stage, not the next one', () => {
    // A missed cron run, a deploy gap, or an account that predates this. Day 9
    // with nothing sent must not produce a "day one, here's how to start"
    // email nine days late.
    expect(at(9, null)).toBe(7)
    expect(at(13, null)).toBe(12)
  })

  it('still delivers the remaining stages after a catch-up', () => {
    expect(at(12, 7)).toBe(12)
  })

  it('stops once the trial is over', () => {
    // The expiry notice owns this side of the line. A "two days left" email
    // arriving after "your trial has ended" would contradict it.
    expect(at(TRIAL_DAYS)).toBeNull()
    expect(at(TRIAL_DAYS, 7)).toBeNull()
    expect(at(40, 7)).toBeNull()
  })

  it('never returns a stage outside the declared set', () => {
    for (let d = 0; d < TRIAL_DAYS + 5; d++) {
      const s = dueTrialStage({ daysSinceStart: d, lastStageSent: null })
      if (s !== null) expect(TRIAL_STAGES).toContain(s)
    }
  })
})

describe('trialStageIsOptional', () => {
  it('lets a user switch off the nudges', () => {
    expect(trialStageIsOptional(1)).toBe(true)
    expect(trialStageIsOptional(7)).toBe(true)
  })

  it('does not let a user switch off notice that Pro is ending', () => {
    // Same rule 0049 set for the expiry notice: a user may not opt out of being
    // told their account state is about to change.
    expect(trialStageIsOptional(12)).toBe(false)
  })
})
