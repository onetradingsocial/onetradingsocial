import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isProcessKind, isReflectionOutcome, type ProcessLog } from '@/lib/process'

/**
 * One user's process entries — the source of every quest, streak and badge in
 * the reward system after the 2026-09-05 audit removed the volume quotas.
 *
 * Rows are tiny (a kind, a date, an optional outcome) and capped by the unique
 * index in migration 0070 at four per day, so a two-year-old account tops out
 * around 3k rows. The limit below is a safety rail, not a paging strategy.
 *
 * Unrecognised `kind`/`outcome` values are dropped rather than coerced: the
 * check constraints in 0070 make them impossible today, and if a later migration
 * widens the vocabulary this returns less rather than mis-scoring.
 */
export async function getProcessLogs(
  supabase: SupabaseClient, userId: string, limit = 4000,
): Promise<ProcessLog[]> {
  const { data } = await supabase
    .from('process_logs')
    .select('kind, day, outcome')
    .eq('user_id', userId)
    .order('day', { ascending: false })
    .limit(limit)
  const out: ProcessLog[] = []
  for (const r of data ?? []) {
    if (!isProcessKind(r.kind)) continue
    const day = typeof r.day === 'string' ? r.day.slice(0, 10) : null
    if (!day) continue
    out.push({ kind: r.kind, day, outcome: isReflectionOutcome(r.outcome) ? r.outcome : null })
  }
  return out
}
