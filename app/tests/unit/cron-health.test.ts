import { describe, it, expect } from 'vitest'
import { runHealth, totalProcessed, topFailure, needsAttention, cronWatchdog, CRON_STALE_HOURS } from '@/lib/cron-health'

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

describe('cronWatchdog', () => {
  // The watchdog runs 00:00-00:59 UTC; lifecycle-emails 13:00-13:59 UTC.
  const at = (iso: string) => new Date(iso)
  const latest = (ran_at: string, o: Partial<Parameters<typeof runHealth>[0]> = {}) =>
    ({ ran_at, counters: run({ delivered: 3, ...o }) })

  it('is quiet after a normal night, at the widest scheduling spread', () => {
    expect(cronWatchdog('lifecycle-emails', latest('2026-09-16T13:00:00Z'), at('2026-09-17T00:59:00Z'))).toBeNull()
  })

  it('flags a missed night, at the narrowest scheduling spread', () => {
    // Last run 13:59 on the 15th, nothing on the 16th, watchdog 00:00 on the 17th: 34h.
    const f = cronWatchdog('lifecycle-emails', latest('2026-09-15T13:59:00Z'), at('2026-09-17T00:00:00Z'))
    expect(f?.kind).toBe('cron_missed')
    expect(CRON_STALE_HOURS).toBeGreaterThan(12)
    expect(CRON_STALE_HOURS).toBeLessThan(34)
  })

  it('flags a route that has never recorded a run', () => {
    expect(cronWatchdog('lifecycle-emails', null, at('2026-09-17T00:10:00Z'))?.kind).toBe('cron_missed')
  })

  it('flags an unhealthy run with its dominant failure', () => {
    const f = cronWatchdog('lifecycle-emails',
      latest('2026-09-16T13:38:00Z', { delivered: 0, undelivered: 12, failures: { resend_429: 12 } }),
      at('2026-09-17T00:10:00Z'))
    expect(f).toEqual({ kind: 'cron_unhealthy', message: 'lifecycle-emails last run failed: 12× resend_429' })
  })

  it('flags a run that deferred work to its time budget', () => {
    const f = cronWatchdog('lifecycle-emails',
      latest('2026-09-16T13:38:00Z', { processed: { deferred: 4 } }), at('2026-09-17T00:10:00Z'))
    expect(f?.kind).toBe('cron_unhealthy')
    expect(f?.message).toMatch(/deferred 4/)
  })

  it('is quiet on an idle night — nothing due is not a fault', () => {
    expect(cronWatchdog('lifecycle-emails', latest('2026-09-16T13:38:00Z', { delivered: 0 }), at('2026-09-17T00:10:00Z'))).toBeNull()
  })
})
