'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'

const FEEDBACK_STATUSES = ['open', 'triaged', 'closed'] as const
type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<{ error?: string }> {
  await requireAdmin()
  if (!FEEDBACK_STATUSES.includes(status)) return { error: 'Bad status.' }
  const svc = createServiceClient()
  const { error } = await svc.from('feedback').update({ status }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  revalidatePath('/admin/feedback')
  return {}
}
