import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  tierFromSubscriptions, TIER_RANK,
  trialState, trialDaysLeft, effectiveTier, shouldShowWall,
  type Tier, type TrialState,
} from '@/lib/entitlements'
import { parseAdminEmails, emailIsAdmin } from '@/lib/admin'
import { createServiceClient } from '@/lib/supabase/service'

export type TrialGate = { state: TrialState; daysLeft: number; showWall: boolean }
export type Entitlements = { tier: Tier; gate: TrialGate }

const NO_GATE: TrialGate = { state: 'none', daysLeft: 0, showWall: false }

/** Tier AND trial gate from one pass over the same two rows.
 *
 *  The tier fails CLOSED to 'free' on a read error, because a feature accessed
 *  on a tier the user may not hold is the worse mistake. The gate fails OPEN —
 *  a read error, a missing row or an unset kill switch all yield no wall —
 *  because a bug here would lock the whole userbase out.
 *
 *  Those two directions disagree, which is the trap: "the subscriptions read
 *  failed" degrades to tier 'free', and a naive gate would read that 'free' as
 *  grounds to wall a paying customer. So the wall requires a POSITIVELY
 *  CONFIRMED free tier — see wallTier below.
 *
 *  Admins get the top tier for their own account, bypassing Stripe, so they can
 *  reach every gated feature without a subscription — and so their profile
 *  shows Pro perks to everyone, not just themselves (looked up by the target
 *  user's own email, independent of who is viewing / which client is passed
 *  in). They still get a real gate, so an admin who is genuinely mid-trial
 *  still sees the countdown chip; tier 'pro' exempts them from the wall. */
export async function getEntitlements(
  supabase: SupabaseClient, userId: string,
): Promise<Entitlements> {
  const svc = createServiceClient()
  const [{ data: { user } }, { data: prof, error: profError }, { data: subs, error: subsError }] =
    await Promise.all([
      svc.auth.admin.getUserById(userId),
      svc.from('profiles')
        .select('comp_tier, trial_started_at, trial_ack_at')
        .eq('id', userId).maybeSingle(),
      supabase.from('subscriptions').select('tier, status').eq('user_id', userId),
    ])

  const now = new Date()
  const state = trialState(prof?.trial_started_at, prof?.trial_ack_at, now)

  // A failed subscriptions read means the tier is UNKNOWN, not free.
  const tierKnown = !subsError && !!subs
  const stripeTier: Tier = tierKnown ? tierFromSubscriptions(subs) : 'free'
  const tier: Tier = user && emailIsAdmin(user.email, parseAdminEmails(process.env.ADMIN_EMAILS))
    ? 'pro'
    : effectiveTier(prof?.comp_tier, stripeTier, state)

  if (profError || !prof) return { tier, gate: NO_GATE }

  // Only a positively-confirmed free tier may be walled. If we could not read
  // the subscriptions we do not know the tier, so we must not wall: substitute
  // a tier that can never satisfy shouldShowWall rather than the 'free' the
  // fail-closed path handed us.
  const wallTier: Tier = tierKnown ? tier : 'pro'

  return {
    tier,
    gate: {
      state,
      daysLeft: trialDaysLeft(prof.trial_started_at, now),
      showWall: shouldShowWall(state, wallTier, process.env.TRIAL_WALL_ENABLED === 'true'),
    },
  }
}

/** Effective tier only. Prefer getEntitlements() where the gate is also needed
 *  — it costs the same round trips. */
export async function getTier(supabase: SupabaseClient, userId: string): Promise<Tier> {
  return (await getEntitlements(supabase, userId)).tier
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

