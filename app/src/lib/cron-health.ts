/**
 * Reading a cron run's counters as a verdict.
 *
 * Kept separate from the Supabase calls in lib/server/cron-runs.ts so the
 * judgement is testable without a database — the same split lib/recovery.ts and
 * lib/trial-sequence.ts use.
 *
 * The distinction that matters here is between "nothing to do" and "nothing
 * got through". Both produce zero delivered emails, and conflating them is
 * exactly how a lifecycle system runs for months looking fine: a quiet night
 * and a broken provider are indistinguishable if you only count sends.
 */

export type RunCounters = {
  /** Users processed per branch — digests, nudges, welcomes, trial stages. */
  processed: Record<string, number>
  delivered: number
  undelivered: number
  /** Failure reason -> count, as the route's `deliver()` accumulates it. */
  failures: Record<string, number>
}

export type RunHealth =
  /** Nothing was due. Zero sends is the correct answer, not a fault. */
  | 'idle'
  /** Everything that was due went out. */
  | 'ok'
  /** Some got through, some did not. */
  | 'degraded'
  /** Work was due and none of it was delivered. */
  | 'failed'
  /** RESEND_API_KEY is unset: the whole programme is off, not one message. */
  | 'no_provider'

export function runHealth(c: RunCounters): RunHealth {
  // Checked before anything else: no_provider is a configuration state, not a
  // delivery statistic, and the fix is one environment variable rather than a
  // retry. The route already logs it loudly for the same reason.
  if (c.failures.no_provider) return 'no_provider'

  const due = c.delivered + c.undelivered
  if (due === 0) return 'idle'
  if (c.undelivered === 0) return 'ok'
  return c.delivered === 0 ? 'failed' : 'degraded'
}

/** Total users processed across every branch. */
export function totalProcessed(processed: Record<string, number>): number {
  return Object.values(processed).reduce((n, v) => n + (Number(v) || 0), 0)
}

/**
 * The failure worth putting on screen, or null.
 *
 * One reason, not a breakdown: an admin panel that lists five reasons at one
 * count each teaches less than the single dominant one, and the full map is in
 * the row for anyone who wants it.
 */
export function topFailure(failures: Record<string, number>): { reason: string; count: number } | null {
  const entries = Object.entries(failures)
    .map(([reason, count]) => ({ reason, count: Number(count) || 0 }))
    .filter((e) => e.count > 0)
  if (entries.length === 0) return null
  // Ties broken by name so the panel does not reshuffle between renders.
  entries.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
  return entries[0]
}

/**
 * Whether a run deserves attention on sight.
 *
 * `degraded` counts. A single bounce on a domain with no sending reputation is
 * worth seeing on night two rather than discovering on night four, which is the
 * whole reason these counters are now persisted.
 */
export function needsAttention(health: RunHealth): boolean {
  return health === 'failed' || health === 'no_provider' || health === 'degraded'
}
