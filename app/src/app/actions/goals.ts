'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { GOAL_META, type GoalKind } from '@/lib/goals'

export type GoalState = { error?: string; ok?: boolean }

const KINDS = Object.keys(GOAL_META) as GoalKind[]

export async function addGoal(input: { kind: string; target: number; windowDays: number }): Promise<GoalState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (!(KINDS as string[]).includes(input.kind)) return { error: 'Invalid goal.' }
  const target = Number(input.target)
  if (!Number.isFinite(target) || target <= 0) return { error: 'Target must be positive.' }
  const windowDays = Number(input.windowDays)
  if (!Number.isFinite(windowDays) || windowDays <= 0) return { error: 'Invalid window.' }

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
  await supabase.from('process_goals').delete().eq('id', id).eq('user_id', user.id)
  revalidatePath('/journal')
  return { ok: true }
}
