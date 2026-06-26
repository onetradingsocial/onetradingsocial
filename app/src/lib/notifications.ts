import type { SupabaseClient } from '@supabase/supabase-js'

export type NotificationType = 'like' | 'comment' | 'follow' | 'post_share' | 'mention'

export interface InsertNotificationArgs {
  supabase: SupabaseClient
  userId: string      // recipient
  actorId: string     // who triggered
  type: NotificationType
  entityId?: string
  entityType?: 'post' | 'comment' | 'trade'
}

export async function insertNotification({
  supabase, userId, actorId, type, entityId, entityType,
}: InsertNotificationArgs): Promise<void> {
  if (actorId === userId) return  // no self-notifications

  if (type === 'follow') {
    // deduplicate: skip if a follow notification already exists
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('actor_id', actorId)
      .eq('type', 'follow')
      .maybeSingle()
    if (existing) return
  }

  await supabase.from('notifications').insert({
    user_id: userId,
    actor_id: actorId,
    type,
    entity_id: entityId ?? null,
    entity_type: entityType ?? null,
  })
}

// Returns unique lowercase usernames mentioned with @username syntax.
// Ignores email patterns (@ preceded by a word char).
export function extractMentions(text: string): string[] {
  const matches = text.match(/(?<![a-zA-Z0-9_])@([a-zA-Z0-9_]+)/g) ?? []
  const seen = new Set<string>()
  const result: string[] = []
  for (const m of matches) {
    const username = m.slice(1).toLowerCase()
    if (!seen.has(username)) { seen.add(username); result.push(username) }
  }
  return result
}
