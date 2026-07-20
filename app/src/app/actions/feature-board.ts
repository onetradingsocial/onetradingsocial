'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type FrState = { error?: string; ok?: boolean; id?: number }

export async function submitFeatureRequest(input: { title: string; body?: string }): Promise<FrState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const title = input.title.trim()
  if (title.length < 3 || title.length > 120) return { error: 'Title must be 3–120 characters.' }
  const body = (input.body ?? '').trim().slice(0, 2000) || null

  const { data, error } = await supabase
    .from('feature_requests')
    .insert({ author_id: user.id, title, body })
    .select('id').single()
  if (error) return { error: 'Could not submit.' }

  // Author auto-votes their own request.
  await supabase.from('feature_request_votes').insert({ request_id: data.id, user_id: user.id })
  revalidatePath('/feature-board')
  return { ok: true, id: data.id }
}

export async function toggleFeatureVote(requestId: number): Promise<FrState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: existing } = await supabase
    .from('feature_request_votes').select('request_id')
    .eq('request_id', requestId).eq('user_id', user.id).maybeSingle()

  if (existing) {
    await supabase.from('feature_request_votes').delete().eq('request_id', requestId).eq('user_id', user.id)
  } else {
    await supabase.from('feature_request_votes').insert({ request_id: requestId, user_id: user.id })
  }
  revalidatePath('/feature-board')
  return { ok: true }
}

export async function commentOnFeature(requestId: number, body: string): Promise<FrState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const text = body.trim()
  if (!text || text.length > 1000) return { error: 'Comment must be 1–1000 characters.' }

  const { error } = await supabase
    .from('feature_request_comments')
    .insert({ request_id: requestId, author_id: user.id, body: text })
  if (error) return { error: 'Could not post comment.' }
  revalidatePath('/feature-board')
  return { ok: true }
}
