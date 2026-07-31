import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  tierFromSubscriptions, TIER_RANK,
  trialState, trialDaysLeft, effectiveTier, shouldShowWall, shouldShowWelcome,
  type Tier, type TrialState,
} from '@/lib/entitlements'
import { parseAdminEmails, emailIsAdmin } from '@/lib/admin'
import { createServiceClient } from '@/lib/supabase/service'

export type TrialGate = { state: TrialState; daysLeft: number; showWall: boolean }
export type WelcomeState = { show: boolean; tier: Tier }
export type Entitlements = { tier: Tier; gate: TrialGate; welcome: WelcomeState }

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
  const [
    { data: { user } },
    { data: prof, error: profError },
    { data: subs, error: subsError },
    { data: wel },
  ] =
    await Promise.all([
      svc.auth.admin.getUserById(userId),
      svc.from('profiles')
        .select('comp_tier, trial_started_at, trial_ack_at')
        .eq('id', userId).maybeSingle(),
      supabase.from('subscriptions').select('tier, status').eq('user_id', userId),
      // Deliberately its OWN query, not folded into the profiles select above.
      // welcome_tier_seen / onboarding_completed are the newest columns here
      // (Task 4); if a deploy ships the code before migration 0043 reaches a
      // given database, PostgREST returns 42703 for an unknown column and
      // fails the WHOLE select it's part of. If these two columns were in the
      // same query as comp_tier/trial_started_at/trial_ack_at, that failure
      // would null out `prof` and silently degrade every mid-trial and
      // admin-comped user's TIER to 'free' — including permanently, since
      // saveProfileSettings recomputes tier and would then null out paid
      // profile fields. Keeping it separate means a missing column can only
      // ever suppress the welcome popup, never touch tier or the trial gate.
      svc.from('profiles')
        .select('welcome_tier_seen, onboarding_completed')
        .eq('id', userId).maybeSingle(),
    ])

  const now = new Date()
  const state = trialState(prof?.trial_started_at, prof?.trial_ack_at, now)

  // A failed subscriptions read means the tier is UNKNOWN, not free.
  const tierKnown = !subsError && !!subs
  const stripeTier: Tier = tierKnown ? tierFromSubscriptions(subs) : 'free'
  const tier: Tier = user && emailIsAdmin(user.email, parseAdminEmails(process.env.ADMIN_EMAILS))
    ? 'pro'
    : effectiveTier(prof?.comp_tier, stripeTier, state)

  // Fails CLOSED (no popup) on a profiles read error: a spurious celebration is
  // worse than a missed one, and `tier` is already the fail-closed 'free' here.
  if (profError || !prof) return { tier, gate: NO_GATE, welcome: { show: false, tier } }

  // Only a positively-confirmed free tier may be walled. If we could not read
  // the subscriptions we do not know the tier, so we must not wall: substitute
  // a tier that can never satisfy shouldShowWall rather than the 'free' the
  // fail-closed path handed us.
  const wallTier: Tier = tierKnown ? tier : 'pro'
  const showWall = shouldShowWall(state, wallTier, process.env.TRIAL_WALL_ENABLED === 'true')

  return {
    tier,
    gate: {
      state,
      daysLeft: trialDaysLeft(prof.trial_started_at, now),
      showWall,
    },
    welcome: {
      // Gated on tierKnown for the same reason as wallTier above: a failed
      // subscriptions read degrades `tier` to 'free', and without this a
      // transient read failure would show a paying Pro customer a confetti
      // "Welcome to Free", then persist 'free' via ackWelcome and fire a
      // second spurious popup once the read recovers. This does not regress
      // fresh signups — a user with no subscriptions rows yields an empty
      // (truthy) array, so tierKnown is still true.
      //
      // Fed from `wel`, not `prof`: welcome_tier_seen/onboarding_completed
      // live in their own query (see above), so a null/errored `wel` must
      // fail CLOSED here — `wel?.onboarding_completed === true` is false for
      // a null `wel`, which alone suppresses the popup regardless of the
      // other arguments.
      // Kill switch. Deliberately opt-OUT (disabled only when explicitly set to
      // 'true'), unlike TRIAL_WALL_ENABLED which is opt-IN: the popup is already
      // live, so an opt-in flag would silently switch it off the moment this
      // deploys. Set WELCOME_POPUP_DISABLED=true in Vercel to suppress the popup
      // everywhere without reverting the deploy or touching the database.
      // Nothing is lost while disabled — welcome_tier_seen simply stops being
      // written, so users become eligible again when it is turned back on.
      show: process.env.WELCOME_POPUP_DISABLED !== 'true' && tierKnown && shouldShowWelcome(
        wel?.welcome_tier_seen,
        tier,
        state,
        showWall,
        wel?.onboarding_completed === true,
      ),
      tier,
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

