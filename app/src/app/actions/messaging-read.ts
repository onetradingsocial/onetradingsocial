'use server'

import { createClient } from '@/lib/supabase/server'
import { getMessages } from '@/lib/server/messaging'
import type { Message } from '@/lib/messaging'

export async function getThreadMessages(conversationId: string): Promise<Message[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  return getMessages(supabase, conversationId, user.id)
}
