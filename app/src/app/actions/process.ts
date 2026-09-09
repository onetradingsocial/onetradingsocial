'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isProcessKind, validateEntry } from '@/lib/process'
import { allowAction, JOURNAL_BUDGET } from '@/lib/server/action-throttle'

/**
 * Recording a process entry — the write behind every quest, streak and badge
 * after the 2026-09-05 audit removed the volume quotas.
 *
 * Ungated by plan, on purpose and by precedent: process goals
 * (`actions/goals.ts`) are already available at every tier, and they are the one
 * improvement primitive a Free user can reach. A reward system built on a
 * Trader+ signal would be a reward system that pays nobody on Free — which is
 * exactly the trap `weekly_review_viewed` is in, and the reason this action does
 * not touch it.
 *
 * No plan gate is added or moved here.
 */

export type ProcessState = { error?: string; ok?: boolean }

/**
 * The server's UTC date — the same expression as `process_logs.day`'s default.
 * Used only to ADDRESS a row that Postgres already dated; never to set one.
 */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Every surface that renders quests, streaks or the week chain. */
function revalidateRewardSurfaces() {
  revalidatePath('/journal')
  revalidatePath('/achievements')
  revalidatePath('/')
}

/**
 * Record (or amend) today's entry of one kind.
 *
 * The day is never sent from the client: `process_logs.day` defaults to the UTC
 * date in Postgres and migration 0070 withholds the column from the client
 * grants, so "today" is the server's today. That is the item-15-F7 lesson
 * applied before the mistake can be repeated — the trade quests it replaced were
 * farmable precisely because their bucket came from a user-supplied timestamp.
 *
 * Re-recording the same kind on the same day is not an error and is not a second
 * reward: the unique index collapses it, and for a rule reflection the outcome is
 * updated in place so a trader can change "not sure" to "broke a rule" once they
 * have worked out which it was.
 */
export async function logProcess(input: { kind: string; outcome?: string | null }): Promise<ProcessState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(JOURNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }

  const entry = validateEntry(input.kind, input.outcome ?? null)
  if (!entry) return { error: 'Invalid entry.' }

  // Insert-then-amend rather than upsert. An upsert's ON CONFLICT DO UPDATE
  // writes every column in the payload, and 0070 grants the client UPDATE on
  // `outcome` alone — so an upsert would be refused by the column grant the
  // moment a user recorded the same kind twice in a day. The narrow grant is the
  // control (kind and day must not be rewritable after the fact); the two-step
  // is what fits it.
  const { error } = await supabase
    .from('process_logs')
    .insert({ user_id: user.id, kind: entry.kind, outcome: entry.outcome })
  if (error) {
    // 23505 = the (user_id, day, kind) unique index: already recorded today.
    if (error.code !== '23505') return { error: 'Could not save that.' }
    if (entry.outcome != null) {
      const { error: updErr } = await supabase
        .from('process_logs').update({ outcome: entry.outcome })
        .eq('user_id', user.id).eq('kind', entry.kind).eq('day', utcToday())
      if (updErr) return { error: 'Could not save that.' }
    }
  }

  revalidateRewardSurfaces()
  return { ok: true }
}

/**
 * Undo today's entry of one kind. Scoped to today and to the caller: an entry
 * from a previous day is history and stays put, so a streak cannot be edited
 * after the fact in either direction.
 */
export async function unlogProcess(kind: string): Promise<ProcessState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(JOURNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }

  if (!isProcessKind(kind)) return { error: 'Invalid entry.' }

  const { error } = await supabase
    .from('process_logs').delete()
    .eq('user_id', user.id).eq('kind', kind).eq('day', utcToday())
  if (error) return { error: 'Could not remove that.' }

  revalidateRewardSurfaces()
  return { ok: true }
}
