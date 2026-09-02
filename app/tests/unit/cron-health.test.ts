import { describe, it, expect } from 'vitest'
import { runHealth, totalProcessed, topFailure, needsAttention } from '@/lib/cron-health'

const run = (o: Partial<Parameters<typeof runHealth>[0]> = {}) => ({
  processed: {}, delivered: 0, undelivered: 0, failures: {}, ...o,
})

/**
 * The distinction these guard is the one that let the lifecycle system look
 * healthy for months: a quiet night and a broken provider both deliver zero
 * emails, and a counter that cannot tell them apart is worse than no counter,
 * because it reassures.
 */
describe('runHealth', () => {
  it('calls a night with nothing due idle, not failed', () => {
    expect(runHealth(run())).toBe('idle')
    // Work processed but nothing to deliver — e.g. every candidate opted out.
    expect(runHealth(run({ processed: { welcomes: 3 } }))).toBe('idle')
  })

  it('reports ok only when everything due got through', () => {
    expect(runHealth(run({ delivered: 10 }))).toBe('ok')
  })

  it('separates partial delivery from total failure', () => {
    expect(runHealth(run({ delivered: 7, undelivered: 3, failures: { resend_422: 3 } }))).toBe('degraded')
    expect(runHealth(run({ delivered: 0, undelivered: 4, failures: { resend_500: 4 } }))).toBe('failed')
  })

  it('treats a missing provider as its own state, whatever the counts say', () => {
    // The fix is one environment variable, not a retry — so it must not be
    // filed under the same heading as a bounced address.
    expect(runHealth(run({ undelivered: 9, failures: { no_provider: 9 } }))).toBe('no_provider')
    expect(runHealth(run({ delivered: 2, undelivered: 1, failures: { no_provider: 1 } }))).toBe('no_provider')
  })
})

describe('needsAttention', () => {
  it('flags degraded, not just outright failure', () => {
    // A single bounce on a domain with no sending reputation is worth seeing on
    // night two rather than discovering on night four.
    expect(needsAttention('degraded')).toBe(true)
    expect(needsAttention('failed')).toBe(true)
    expect(needsAttention('no_provider')).toBe(true)
  })
  it('leaves healthy and quiet runs alone', () => {
    expect(needsAttention('ok')).toBe(false)
    expect(needsAttention('idle')).toBe(false)
  })
})

describe('totalProcessed', () => {
  it('sums every branch', () => {
    expect(totalProcessed({ digests: 2, nudges: 5, welcomes: 10, trialStageEmails: 4 })).toBe(21)
  })
  it('survives an empty or malformed map', () => {
    expect(totalProcessed({})).toBe(0)
    expect(totalProcessed({ a: NaN as unknown as number, b: 3 })).toBe(3)
  })
})

describe('topFailure', () => {
  it('returns the dominant reason', () => {
    expect(topFailure({ resend_422: 1, no_address: 6 })).toEqual({ reason: 'no_address', count: 6 })
  })
  it('is null when nothing failed', () => {
    expect(topFailure({})).toBeNull()
    expect(topFailure({ resend_422: 0 })).toBeNull()
  })
  it('breaks ties by name so the panel does not reshuffle between renders', () => {
    expect(topFailure({ zeta: 2, alpha: 2 })).toEqual({ reason: 'alpha', count: 2 })
  })
})
