'use server'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { validateFeedback } from '@/lib/feedback'
import { trackServer } from '@/lib/server/track'

export type FeedbackState = { error?: string; ok?: boolean }

export type SubmitFeedbackInput = {
  type: string
  message: string
  pageUrl?: string | null
  meta?: { device?: string; viewport?: string; console?: string }
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const valid = validateFeedback({ type: input.type, message: input.message })
  if (!valid.ok) return { error: valid.error }

  const userAgent = (await headers()).get('user-agent')?.slice(0, 500) ?? null
  const pageUrl = (input.pageUrl ?? '').slice(0, 500) || null

  // Context metadata (device class, viewport, recent console error) — bounded
  // so the client can't stuff arbitrary payloads into the row.
  const meta: Record<string, string> = {}
  if (input.meta?.device) meta.device = String(input.meta.device).slice(0, 16)
  if (input.meta?.viewport) meta.viewport = String(input.meta.viewport).slice(0, 24)
  if (input.meta?.console) meta.console = String(input.meta.console).slice(0, 500)

  const { error } = await supabase.from('feedback').insert({
    user_id: user.id,
    type: valid.type,
    message: valid.message,
    page_url: pageUrl,
    user_agent: userAgent,
    meta,
  })
  if (error) return { error: 'Could not submit. Try again.' }

  await trackServer('feedback_submitted', user, { type: valid.type })
  return { ok: true }
}
