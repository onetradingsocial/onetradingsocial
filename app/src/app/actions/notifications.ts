'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { markRead, markAllRead } from '@/lib/server/notifications'
import { allowAction, AMBIENT_BUDGET, PROFILE_BUDGET } from '@/lib/server/action-throttle'

export async function markNotificationRead(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  // Void return type: a throttled call is a silent no-op, exactly as an
  // unauthenticated one already is.
  if (!(await allowAction(AMBIENT_BUDGET, user.id)).ok) return
  const service = createServiceClient()
  await markRead(service, user.id, id)
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  if (!(await allowAction(AMBIENT_BUDGET, user.id)).ok) return
  const service = createServiceClient()
  await markAllRead(service, user.id)
}

// 'getting_started' and 'recovery_email' gate the two lifecycle emails that had
// no switch: the day-0 welcome and the inactivity nudge. Contrast the billing
// and trial notices added in 0049, which are deliberately absent here — a user
// may not switch off being told their payment failed. These two are marketing,
// not notice, so they get a toggle.
const PREF_KEYS = new Set([
  'weekly_report', 'import_done', 'sync_failed', 'goal_completed', 'rule_breach', 'new_learning',
  'follow', 'comment', 'mention', 'like', 'post_share', 'message',
  'getting_started', 'recovery_email',
])

export async function saveNotificationPrefs(prefs: Record<string, boolean>): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  if (!(await allowAction(PROFILE_BUDGET, user.id)).ok) return
  // Whitelist keys + coerce to booleans so the jsonb can't be stuffed.
  const clean: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(prefs)) if (PREF_KEYS.has(k)) clean[k] = !!v
  await supabase.from('profiles').update({ notification_prefs: clean }).eq('id', user.id)
}
