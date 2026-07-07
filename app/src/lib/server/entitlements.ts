import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { tierFromSubscriptions, TIER_RANK, type Tier } from '@/lib/entitlements'
import { parseAdminEmails, emailIsAdmin } from '@/lib/admin'
import { createServiceClient } from '@/lib/supabase/service'

/** Effective tier from the local mirror. Fails closed to 'free' on any error.
 *  Admins get the top tier ('pro') for their own account, bypassing Stripe, so
 *  they can access every gated feature without an active subscription — and
 *  so their profile shows Pro perks to everyone, not just themselves (looked
 *  up by the target user's own email, independent of who's viewing / which
 *  client is passed in). */
export async function getTier(supabase: SupabaseClient, userId: string): Promise<Tier> {
  const { data: { user } } = await createServiceClient().auth.admin.getUserById(userId)
  if (user && emailIsAdmin(user.email, parseAdminEmails(process.env.ADMIN_EMAILS))) {
    return 'pro'
  }

  const { data, error } = await supabase
    .from('subscriptions').select('tier, status').eq('user_id', userId)
  if (error || !data) return 'free'
  return tierFromSubscriptions(data)
}

export type CurrentSub = {
  tier: Tier
  status: string
  priceId: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

/** The highest-ranked subscription row for billing UI (renewal/cancel display). */
export async function getSubscription(
  supabase: SupabaseClient, userId: string,
): Promise<CurrentSub | null> {
  const { data } = await supabase
    .from('subscriptions')
    .select('tier, status, price_id, current_period_end, cancel_at_period_end')
    .eq('user_id', userId)
  if (!data || data.length === 0) return null
  const best = [...data].sort(
    (a, b) => (TIER_RANK[b.tier as Tier] ?? -1) - (TIER_RANK[a.tier as Tier] ?? -1),
  )[0]
  return {
    tier: best.tier as Tier,
    status: best.status,
    priceId: best.price_id,
    currentPeriodEnd: best.current_period_end,
    cancelAtPeriodEnd: best.cancel_at_period_end,
  }
}
