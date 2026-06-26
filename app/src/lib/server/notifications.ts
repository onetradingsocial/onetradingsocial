import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationType } from '@/lib/notifications'

export type Notification = {
  id: string
  actorId: string
  actorUsername: string
  actorAvatarUrl: string | null
  type: NotificationType
  entityId: string | null
  entityType: 'post' | 'comment' | 'trade' | 'conversation' | null
  read: boolean
  createdAt: string
}

export async function getNotifications(
  supabase: SupabaseClient,
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<Notification[]> {
  const { limit = 20, offset = 0 } = opts
  const { data } = await supabase
    .from('notifications')
    .select('id, actor_id, type, entity_id, entity_type, read, created_at, actor:profiles!notifications_actor_id_fkey(username, avatar_url)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  return (data ?? []).map((row) => {
    const actor = (Array.isArray(row.actor) ? row.actor[0] : row.actor) as { username: string; avatar_url: string | null } | null
    return {
      id: row.id,
      actorId: row.actor_id,
      actorUsername: actor?.username ?? 'unknown',
      actorAvatarUrl: actor?.avatar_url ?? null,
      type: row.type as NotificationType,
      entityId: row.entity_id ?? null,
      entityType: row.entity_type ?? null,
      read: row.read,
      createdAt: row.created_at,
    }
  })
}

export async function getUnreadCount(supabase: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false)
  if (error) return 0
  return count ?? 0
}

export async function markAllRead(supabase: SupabaseClient, userId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false)
}

export async function markRead(supabase: SupabaseClient, userId: string, notificationId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', notificationId)
    .eq('user_id', userId)
}
