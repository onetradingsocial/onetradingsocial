'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { markRead, markAllRead } from '@/lib/server/notifications'

export async function markNotificationRead(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const service = createServiceClient()
  await markRead(service, user.id, id)
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const service = createServiceClient()
  await markAllRead(service, user.id)
}
