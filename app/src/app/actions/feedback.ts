'use server'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { validateFeedback } from '@/lib/feedback'

export type FeedbackState = { error?: string; ok?: boolean }

export type SubmitFeedbackInput = {
  type: string
  message: string
  pageUrl?: string | null
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const valid = validateFeedback({ type: input.type, message: input.message })
  if (!valid.ok) return { error: valid.error }

  const userAgent = (await headers()).get('user-agent')?.slice(0, 500) ?? null
  const pageUrl = (input.pageUrl ?? '').slice(0, 500) || null

  const { error } = await supabase.from('feedback').insert({
    user_id: user.id,
    type: valid.type,
    message: valid.message,
    page_url: pageUrl,
    user_agent: userAgent,
  })
  if (error) return { error: 'Could not submit. Try again.' }

  return { ok: true }
}
