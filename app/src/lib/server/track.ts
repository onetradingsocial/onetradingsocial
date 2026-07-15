import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { isAdmin } from '@/lib/server/admin'

/**
 * Server-side funnel events (milestones fired from server actions/routes,
 * so they can't be lost to ad-blockers or closed tabs). Fire-and-forget:
 * analytics must never fail the action that triggered it.
 */
export async function trackServer(
  event: string,
  user: { id: string; email?: string | null } | null,
  props: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  try {
    const svc = createServiceClient()
    let isInternal = false
    if (user) {
      if (isAdmin(user)) {
        isInternal = true
      } else {
        const { data } = await svc.from('profiles').select('is_internal').eq('id', user.id).single()
        isInternal = data?.is_internal ?? false
      }
    }
    await svc.from('analytics_events').insert({
      user_id: user?.id ?? null,
      event,
      props,
      is_internal: isInternal,
    })
  } catch {
    // swallow: never break the calling action
  }
}
