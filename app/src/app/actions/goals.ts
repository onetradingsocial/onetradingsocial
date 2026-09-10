'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GOAL_META, GOAL_LIMIT_ERROR, type GoalKind } from '@/lib/goals'
import { allowAction, JOURNAL_BUDGET } from '@/lib/server/action-throttle'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { FREE_ACTIVE_GOAL_LIMIT } from '@/lib/entitlements'

export type GoalState = { error?: string; ok?: boolean }

const KINDS = Object.keys(GOAL_META) as GoalKind[]

export async function addGoal(input: { kind: string; target: number; windowDays: number }): Promise<GoalState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(JOURNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }
  if (!(KINDS as string[]).includes(input.kind)) return { error: 'Invalid goal.' }
  const target = Number(input.target)
  if (!Number.isFinite(target) || target <= 0) return { error: 'Target must be positive.' }
  const windowDays = Number(input.windowDays)
  if (!Number.isFinite(windowDays) || windowDays <= 0) return { error: 'Invalid window.' }

  /* The cap. Server-side because the UI's copy of it is a courtesy: GoalsCard
   * hides the Add button at the limit, and a hand-built POST ignores that.
   *
   * COUNTS, NEVER DELETES. Process goals shipped ungated and uncapped at every
   * tier, so Free accounts already hold more than one; `keepThenCap` in
   * actions/trade.ts is the precedent and its reasoning applies unchanged — a
   * lapsed or never-held subscription must not eat data the user recorded. So
   * this reads `count` and refuses the INSERT. A user sitting over the cap
   * keeps every goal, keeps its progress, can still delete one, and simply
   * cannot add another until they are back under it.
   *
   * `head: true` so this is a COUNT, not a fetch of the rows; the RLS select
   * policy already scopes to the caller, and .eq('user_id') is belt-and-braces
   * against a future policy change. A count that fails to come back is treated
   * as AT the cap rather than under it — failing closed here costs a user one
   * blocked click, failing open sells the paid boundary away on any transient
   * Postgres error. */
  const canMultiple = canFlag(await getFeatureFlags(), await getTier(supabase, user.id), 'multiple_goals')
  if (!canMultiple) {
    const { count, error: countError } = await supabase
      .from('process_goals')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('active', true)
    if (countError) return { error: 'Could not add goal.' }
    if ((count ?? FREE_ACTIVE_GOAL_LIMIT) >= FREE_ACTIVE_GOAL_LIMIT) return { error: GOAL_LIMIT_ERROR }
  }

  const { error } = await supabase.from('process_goals').insert({
    user_id: user.id, kind: input.kind, target, window_days: Math.floor(windowDays),
  })
  if (error) return { error: 'Could not add goal.' }
  revalidatePath('/journal')
  return { ok: true }
}

export async function removeGoal(id: number): Promise<GoalState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(JOURNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }
  await supabase.from('process_goals').delete().eq('id', id).eq('user_id', user.id)
  revalidatePath('/journal')
  return { ok: true }
}
