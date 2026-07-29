import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  tierFromSubscriptions, TIER_RANK,
  trialState, trialDaysLeft, effectiveTier, shouldShowWall,
  type Tier, type TrialState,
} from '@/lib/entitlements'
import { parseAdminEmails, emailIsAdmin } from '@/lib/admin'
import { createServiceClient } from '@/lib/supabase/service'

/** Effective tier from the local mirror. Fails closed to 'free' on any error.
 *  Admins get the top tier ('pro') for their own account, bypassing Stripe, so
 *  they can access every gated feature without an active subscription — and
 *  so their profile shows Pro perks to everyone, not just themselves (looked
 *  up by the target user's own email, independent of who's viewing / which
 *  client is passed in). */
export async function getTier(supabase: SupabaseClient, userId: string): Promise<Tier> {
  const svc = createServiceClient()
  const { data: { user } } = await svc.auth.admin.getUserById(userId)
  if (user && emailIsAdmin(user.email, parseAdminEmails(process.env.ADMIN_EMAILS))) {
    return 'pro'
  }

  const [{ data: prof }, { data: subs, error }] = await Promise.all([
    svc.from('profiles')
      .select('comp_tier, trial_started_at, trial_ack_at')
      .eq('id', userId).maybeSingle(),
    supabase.from('subscriptions').select('tier, status').eq('user_id', userId),
  ])

  const stripeTier: Tier = error || !subs ? 'free' : tierFromSubscriptions(subs)
  const trial = trialState(prof?.trial_started_at, prof?.trial_ack_at, new Date())
  return effectiveTier(prof?.comp_tier, stripeTier, trial)
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

export type TrialGate = { state: TrialState; daysLeft: number; showWall: boolean }

const NO_GATE: TrialGate = { state: 'none', daysLeft: 0, showWall: false }

/** Trial state for UI: the countdown chip, the final-days banner and the
 *  end-of-trial wall. Fails open — any read failure yields no wall, because a
 *  bug here must never lock the userbase out. */
export async function getTrialGate(
  supabase: SupabaseClient, userId: string, tier: Tier,
): Promise<TrialGate> {
  const svc = createServiceClient()
  const { data: prof, error } = await svc
    .from('profiles')
    .select('trial_started_at, trial_ack_at')
    .eq('id', userId).maybeSingle()
  if (error || !prof) return NO_GATE

  const now = new Date()
  const state = trialState(prof.trial_started_at, prof.trial_ack_at, now)
  return {
    state,
    daysLeft: trialDaysLeft(prof.trial_started_at, now),
    showWall: shouldShowWall(state, tier, process.env.TRIAL_WALL_ENABLED === 'true'),
  }
}
