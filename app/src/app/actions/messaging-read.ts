'use server'

import { createClient } from '@/lib/supabase/server'
import { getMessages } from '@/lib/server/messaging'
import type { Message } from '@/lib/messaging'
import { allowAction, AMBIENT_BUDGET } from '@/lib/server/action-throttle'

export async function getThreadMessages(conversationId: string): Promise<Message[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  // No error channel (Message[]); an empty thread is what an unauthenticated
  // caller already gets.
  if (!(await allowAction(AMBIENT_BUDGET, user.id)).ok) return []
  return getMessages(supabase, conversationId, user.id)
}
