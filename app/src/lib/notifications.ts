import type { SupabaseClient } from '@supabase/supabase-js'
import { logError } from '@/lib/server/log'

export type NotificationType =
  | 'like' | 'comment' | 'follow' | 'post_share' | 'mention' | 'message'
  // System (no actor) — Sprint 4, row 31:
  | 'weekly_report' | 'import_done' | 'sync_failed' | 'goal_completed' | 'rule_breach' | 'new_learning'
  // Billing lifecycle (WS1). Transactional, NOT in the PREF_KEYS allow-list in
  // actions/notifications.ts, so they cannot be switched off — a customer must
  // always be told their payment failed or their trial ended.
  | 'payment_failed' | 'trial_ending' | 'trial_expired'

// System notification types have no actor and are addressed to the user directly.
export const SYSTEM_NOTIF_TYPES = [
  'weekly_report', 'import_done', 'sync_failed', 'goal_completed', 'rule_breach', 'new_learning',
  'payment_failed', 'trial_ending', 'trial_expired',
] as const

export interface InsertNotificationArgs {
  supabase: SupabaseClient
  userId: string      // recipient
  actorId: string     // who triggered
  type: NotificationType
  entityId?: string
  entityType?: 'post' | 'comment' | 'trade' | 'conversation'
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

// System notification (no actor). Respects the recipient's notification_prefs
// (a type set to false is suppressed). Safe to call from server routes/actions.
export async function insertSystemNotification(args: {
  supabase: SupabaseClient
  userId: string
  type: (typeof SYSTEM_NOTIF_TYPES)[number]
  entityId?: string
  entityType?: 'post' | 'comment' | 'trade' | 'conversation'
}): Promise<void> {
  const { supabase, userId, type, entityId, entityType } = args
  const { data: prof } = await supabase.from('profiles').select('notification_prefs').eq('id', userId).maybeSingle()
  const prefs = (prof?.notification_prefs ?? {}) as Record<string, boolean>
  if (prefs[type] === false) return // opted out
  // PostgREST returns failures in the result object rather than throwing, so
  // without this an insert rejected by notifications_type_check is completely
  // invisible — which is exactly how a new notification type shipped ahead of
  // its migration would look like "the feature just doesn't work".
  const { error } = await supabase.from('notifications').insert({
    user_id: userId, actor_id: null, type, entity_id: entityId ?? null, entity_type: entityType ?? null,
  })
  if (error) logError('notifications', error.message, { note: 'system insert failed', type: type })
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
