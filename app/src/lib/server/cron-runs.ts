import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { logWarn } from '@/lib/server/log'
import type { RunCounters } from '@/lib/cron-health'

export type CronRunRow = {
  ran_at: string
  ok: boolean
  processed: Record<string, number>
  delivery: { delivered?: number; undelivered?: number }
  failures: Record<string, number>
}

/**
 * Record what a cron run did, durably.
 *
 * Best-effort in the strongest sense: this is the LAST thing a route does and
 * it never throws. A route that cannot write its own telemetry must still have
 * sent its email — the alternative trades a real outcome for a record of one.
 *
 * A missing table (code deployed ahead of migration 0065) lands here as a
 * PostgREST error, gets a warning, and is otherwise ignored.
 */
export async function recordCronRun(
  svc: SupabaseClient,
  route: string,
  run: { ok: boolean; processed: Record<string, number>; delivered: number; undelivered: number; failures: Record<string, number> },
): Promise<void> {
  try {
    const { error } = await svc.from('cron_runs').insert({
      route,
      ok: run.ok,
      processed: run.processed,
      delivery: { delivered: run.delivered, undelivered: run.undelivered },
      failures: run.failures,
    })
    if (error) {
      logWarn('recordCronRun', error.message, { route, note: 'run not recorded (migration 0065 applied?)' })
    }
  } catch (err) {
    logWarn('recordCronRun', err, { route, note: 'run not recorded' })
  }
}

/** Most recent runs for a route, newest first. Empty on any read failure —
 *  the admin panel renders "no runs recorded" rather than an error page. */
export async function recentCronRuns(
  svc: SupabaseClient,
  route: string,
  limit = 14,
): Promise<CronRunRow[]> {
  const { data, error } = await svc
    .from('cron_runs')
    .select('ran_at, ok, processed, delivery, failures')
    .eq('route', route)
    .order('ran_at', { ascending: false })
    .limit(limit)
  if (error || !data) {
    logWarn('recentCronRuns', error?.message ?? 'no data', { route })
    return []
  }
  return data as CronRunRow[]
}

/** Shape a stored row for lib/cron-health, which knows nothing about Supabase. */
export function toCounters(row: CronRunRow): RunCounters {
  return {
    processed: row.processed ?? {},
    delivered: Number(row.delivery?.delivered ?? 0),
    undelivered: Number(row.delivery?.undelivered ?? 0),
    failures: row.failures ?? {},
  }
}
