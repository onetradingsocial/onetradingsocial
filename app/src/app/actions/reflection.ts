'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isReflectionOutcome, normalizeReflectionNote } from '@/lib/reflection'
import { allowAction, JOURNAL_BUDGET } from '@/lib/server/action-throttle'

/**
 * Recording the answer to "did this trade follow your rules?".
 *
 * ── Audit 2026-09-05, Wave D4 ────────────────────────────────────────────────
 *
 * Ungated by plan, on purpose and by the precedent `actions/process.ts` sets:
 * the reflection is the one improvement primitive a Free user must be able to
 * reach, or there is no complete cycle to give away. No plan gate is read,
 * added or moved in this file.
 *
 * ── Why this lives outside `actions/trade.ts` ────────────────────────────────
 *
 * It writes two columns nothing else writes, reads no entitlement, and shares
 * none of `updateTrade`'s recompute machinery — putting it there would have
 * meant threading a third mode through a function whose whole job is keeping
 * the insert and edit maths identical. Keeping it here also means the trade
 * actions file is untouched by this feature.
 */

export type ReflectionState = { error?: string; ok?: boolean }

/**
 * A reflection can be written on ANY of the caller's trades, imported ones
 * included, and that is the requirement rather than an oversight.
 *
 * Import is how most real evidence arrives. 0028's trigger locks a named tuple
 * of EXECUTION columns on non-manual rows and leaves the journal fields
 * editable; `reflection_outcome` and `reflection_note` are not in that tuple,
 * so this write lands on a broker-synced trade exactly as it does on a manual
 * one. Nothing here restates what the broker reported — the reflection sits
 * beside the execution data and is entirely the user's own.
 *
 * Note there is deliberately no `source` check of the kind `deleteTrade` and
 * 0053 carry. Those exist because rewriting or removing verified execution data
 * launders a leaderboard; a reflection changes no metric anyone else can see.
 */
export async function saveTradeReflection(
  tradeId: string,
  input: { outcome: string; note?: string | null },
): Promise<ReflectionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(JOURNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }

  if (!isReflectionOutcome(input.outcome)) return { error: 'Pick one of the three answers.' }
  const note = normalizeReflectionNote(input.note)

  // `.select()` on the update is not decoration. An UPDATE that RLS refuses, or
  // that matches no row, is SILENT: PostgREST reports success having touched
  // nothing, so without reading the result back a user would answer the prompt,
  // see a tick, and find the trade unanswered. Same failure `deleteTrade`
  // documents, same fix.
  const { data, error } = await supabase
    .from('trades')
    .update({ reflection_outcome: input.outcome, reflection_note: note })
    .eq('id', tradeId).eq('user_id', user.id)
    .select('id').maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Trade not found.' }

  await recordDailyReflection(supabase, user.id, input.outcome)

  revalidateReflectionSurfaces()
  return { ok: true }
}

/**
 * Undo an answer. Skipping the prompt is already free — this is for the
 * mis-tap, so that a control offering three one-click answers is not a control
 * you can get permanently wrong.
 *
 * The note goes with it: `trades_reflection_note_needs_outcome` (0071) refuses
 * a sentence with no answer, and a sentence explaining an answer that has been
 * withdrawn is not evidence of anything.
 *
 * Today's `process_logs` row is NOT removed. It records that the user reflected
 * today, which remains true, and `unlogProcess` already exists for a user who
 * wants that entry gone.
 */
export async function clearTradeReflection(tradeId: string): Promise<ReflectionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(JOURNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }

  const { data, error } = await supabase
    .from('trades')
    .update({ reflection_outcome: null, reflection_note: null })
    .eq('id', tradeId).eq('user_id', user.id)
    .select('id').maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Trade not found.' }

  revalidateReflectionSurfaces()
  return { ok: true }
}

/**
 * Reflecting on a trade also completes today's `rule_reflection` process entry.
 *
 * ── The decision, and why it does not double-count ───────────────────────────
 *
 * The alternative was to keep the two records strictly separate, so a user who
 * answered the prompt on three trades still had to tick "Rule reflection" on
 * the daily card to move a quest. That is the same question asked twice, and it
 * makes the per-trade prompt read as a tax on top of the thing that actually
 * pays — which is how a prompt gets dismissed forever.
 *
 * Counting it once is safe because the CAP IS NOT IN THIS CODE. It is 0070's
 * `(user_id, day, kind)` unique index, which is untouched, and it is enforced
 * again on the read side: `xp.ts` counts DISTINCT DAYS carrying a
 * `rule_reflection` row, never rows. Twenty reflections in one day are one
 * entry, one quest tick, one day of streak — exactly what the daily card alone
 * would have produced. The reward surface stays capped at four entries a day,
 * as 0070 intends.
 *
 * `day` is not sent. It defaults to the server's UTC date in Postgres and 0070
 * withholds the column from the client grants, so reflecting today on a trade
 * dated last March credits today — which is when the reflection happened. That
 * is the item-15-F7 lesson (quest buckets must not come from a user-supplied
 * timestamp) holding under a new writer.
 *
 * ON CONFLICT THE EXISTING OUTCOME IS LEFT ALONE, deliberately. `logProcess`
 * amends it, which is right when the user is operating the daily card directly;
 * here it would mean the last trade answered silently rewrites the answer the
 * user gave for their whole day, and on a mixed day (two followed, one broken)
 * the day's label would depend on click order. The per-trade rows are the
 * record of what happened to each trade; the daily row only has to record that
 * a reflection happened.
 *
 * Best-effort throughout. The trade's own reflection is already saved by the
 * time this runs, and failing to also tick a quest is not a reason to tell the
 * user their reflection did not land.
 */
async function recordDailyReflection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  outcome: string,
): Promise<void> {
  try {
    // Plain insert, not an upsert: 0070 grants the client UPDATE on `outcome`
    // alone, so an upsert's ON CONFLICT DO UPDATE — which writes every column in
    // the payload — would be refused by the column grant. 23505 from the unique
    // index means "already reflected today", which is a success, not an error.
    await supabase
      .from('process_logs')
      .insert({ user_id: userId, kind: 'rule_reflection', outcome })
  } catch { /* the reflection is saved; the quest tick is a bonus */ }
}

/** Every surface that renders a reflection, a count of them, or a reward fed by
 *  one. `/journal` carries the prompt and the trade rows; `/` and
 *  `/achievements` render the quests and streaks the daily entry moves. */
function revalidateReflectionSurfaces() {
  revalidatePath('/journal')
  revalidatePath('/achievements')
  revalidatePath('/')
}
