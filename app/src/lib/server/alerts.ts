import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logError } from '@/lib/server/log'

/**
 * Raise a row in `system_alerts` — the same table api/cron/error-alert writes
 * to and /admin reads from. Reused rather than reinvented so a new class of
 * problem shows up in the one place someone already looks.
 *
 * Deduped by (kind, window) so a condition that recurs on every cron run or
 * every webhook retry produces one alert a day, not hundreds. `kind` is plain
 * text on the table (migration 0029) with no check constraint, so new kinds
 * need no migration.
 *
 * Best-effort by construction: alerting must never be the reason a webhook
 * 500s and Stripe starts retrying.
 */
export async function raiseAlert(
  svc: SupabaseClient,
  kind: string,
  message: string,
  opts: { count?: number; windowHours?: number } = {},
): Promise<boolean> {
  const windowHours = opts.windowHours ?? 24
  try {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()
    const { data: existing } = await svc
      .from('system_alerts')
      .select('id')
      .eq('kind', kind)
      .gte('created_at', since)
      .limit(1)
    if (existing && existing.length > 0) return false
    const { error } = await svc.from('system_alerts').insert({
      kind, message, count: opts.count ?? 0, window_minutes: windowHours * 60,
    })
    if (error) {
      logError('alerts', error.message, { note: 'insert failed', kind: kind })
      return false
    }
    return true
  } catch (err) {
    logError('alerts', err, { note: 'raise failed', kind: kind })
    return false
  }
}
