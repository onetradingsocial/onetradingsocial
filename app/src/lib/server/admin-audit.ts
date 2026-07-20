import 'server-only'
import type { User } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Record a privileged admin action (row 52). Fire-and-forget: an audit failure
 * must never block the action itself, but every admin mutation should call it.
 */
export async function logAdminAction(
  admin: User,
  action: string,
  target?: { type?: string; id?: string | number },
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await createServiceClient().from('admin_audit').insert({
      actor_id: admin.id,
      actor_email: admin.email ?? null,
      action,
      target_type: target?.type ?? null,
      target_id: target?.id != null ? String(target.id) : null,
      detail,
    })
  } catch {
    // swallow — auditing is observability, not a gate
  }
}
