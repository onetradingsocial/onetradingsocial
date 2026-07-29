export type Tier = 'free' | 'trader' | 'pro'
export type Interval = 'monthly' | 'annual'

export const TIER_RANK: Record<Tier, number> = { free: 0, trader: 1, pro: 2 }
export const JOURNAL_FREE_LIMIT = 30

const ACTIVE_STATUSES = new Set(['active', 'trialing'])

function isTier(t: string): t is Tier {
  return t === 'free' || t === 'trader' || t === 'pro'
}

/** Effective tier = highest-ranked tier among active/trialing subs, else free. */
export function tierFromSubscriptions(subs: { tier: string; status: string }[]): Tier {
  let best: Tier = 'free'
  for (const s of subs) {
    if (!ACTIVE_STATUSES.has(s.status)) continue
    if (isTier(s.tier) && TIER_RANK[s.tier] > TIER_RANK[best]) best = s.tier
  }
  return best
}

/** The higher-ranked of two tiers (used to combine comp grants with Stripe subs). */
export function higherTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}

/** A stored comp_tier value → Tier. Anything but 'trader'/'pro' means no comp. */
export function normalizeCompTier(v: string | null | undefined): Tier {
  return v === 'trader' || v === 'pro' ? v : 'free'
}

/* ── 14-day free Pro trial ──────────────────────────────────────────────── */

export const TRIAL_DAYS = 14
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000

/** none = never on a trial (also the fail-open value); active = inside the
 *  window; expired = past it and unanswered (the wall); resolved = answered. */
export type TrialState = 'none' | 'active' | 'expired' | 'resolved'

export function trialState(
  startedAt: string | null | undefined,
  ackAt: string | null | undefined,
  now: Date,
): TrialState {
  if (!startedAt) return 'none'
  const start = Date.parse(startedAt)
  if (Number.isNaN(start)) return 'none'
  if (ackAt) return 'resolved'
  return now.getTime() - start < TRIAL_MS ? 'active' : 'expired'
}

/** Whole days remaining, rounded up, clamped to [0, TRIAL_DAYS]. */
export function trialDaysLeft(startedAt: string | null | undefined, now: Date): number {
  if (!startedAt) return 0
  const start = Date.parse(startedAt)
  if (Number.isNaN(start)) return 0
  const remaining = start + TRIAL_MS - now.getTime()
  if (remaining <= 0) return 0
  return Math.min(TRIAL_DAYS, Math.ceil(remaining / (24 * 60 * 60 * 1000)))
}

/** Comp grant, Stripe subscription and trial combined — highest rank wins, so
 *  a trial never downgrades a paying or comped user. */
export function effectiveTier(
  compTier: string | null | undefined,
  stripeTier: Tier,
  trial: TrialState,
): Tier {
  const trialTier: Tier = trial === 'active' ? 'pro' : 'free'
  return higherTier(normalizeCompTier(compTier), higherTier(stripeTier, trialTier))
}

/** The end-of-trial wall. Every condition must hold, so admins, comped users
 *  and subscribers are exempt without any special-casing. */
export function shouldShowWall(state: TrialState, tier: Tier, enabled: boolean): boolean {
  return enabled && state === 'expired' && tier === 'free'
}

export type PlanEnv = {
  STRIPE_PRICE_TRADER_MONTHLY?: string
  STRIPE_PRICE_TRADER_ANNUAL?: string
  STRIPE_PRICE_PRO_MONTHLY?: string
  STRIPE_PRICE_PRO_ANNUAL?: string
}

type Plan = { tier: Tier; interval: Interval }

function priceMap(env: PlanEnv): Array<[string | undefined, Plan]> {
  return [
    [env.STRIPE_PRICE_TRADER_MONTHLY, { tier: 'trader', interval: 'monthly' }],
    [env.STRIPE_PRICE_TRADER_ANNUAL, { tier: 'trader', interval: 'annual' }],
    [env.STRIPE_PRICE_PRO_MONTHLY, { tier: 'pro', interval: 'monthly' }],
    [env.STRIPE_PRICE_PRO_ANNUAL, { tier: 'pro', interval: 'annual' }],
  ]
}

export function planForPrice(priceId: string, env: PlanEnv): Plan | null {
  for (const [id, plan] of priceMap(env)) if (id && id === priceId) return plan
  return null
}

export function priceForPlan(tier: Tier, interval: Interval, env: PlanEnv): string | null {
  for (const [id, plan] of priceMap(env)) {
    if (id && plan.tier === tier && plan.interval === interval) return id
  }
  return null
}

export type Feature =
  | 'journal_unlimited' | 'advanced_stats' | 'pro_badge' | 'custom_badge' | 'advanced_journal'
  | 'learning_intermediate' | 'premium_courses'
  | 'saved_traders' | 'creator_profile' | 'strategy_tracking' | 'mistake_tagging'
  | 'risk_tracking' | 'private_notes' | 'custom_templates' | 'export_journal'
  | 'weekly_review' | 'strategy_breakdown' | 'advanced_reporting' | 'monthly_report' | 'trading_rules'
  | 'ai_insights' | 'advanced_leaderboard_filters' | 'leaderboard_placement'
  | 'premium_challenges' | 'xp_boosts' | 'priority_support' | 'early_access'
  | 'mt5_import' | 'mt5_autosync'
  | 'crypto_import' | 'crypto_autosync'

/** Full pricing-matrix gate. Features not yet built are still mapped so the
 *  gate is ready when the feature ships. */
export const FEATURE_MIN_TIER: Record<Feature, Tier> = {
  // Enforced in v1 (features that exist):
  journal_unlimited: 'trader',
  advanced_journal: 'trader',
  advanced_stats: 'trader',
  learning_intermediate: 'trader',
  premium_courses: 'pro',
  pro_badge: 'pro',
  custom_badge: 'trader',
  mt5_import: 'trader',
  // Wired, enforced when built:
  saved_traders: 'trader',
  strategy_tracking: 'trader',
  mistake_tagging: 'trader',
  risk_tracking: 'trader',
  private_notes: 'trader',
  weekly_review: 'trader',
  trading_rules: 'trader',
  advanced_leaderboard_filters: 'trader',
  xp_boosts: 'trader',
  export_journal: 'trader',
  creator_profile: 'pro',
  custom_templates: 'pro',
  strategy_breakdown: 'pro',
  advanced_reporting: 'pro',
  monthly_report: 'pro',
  ai_insights: 'pro',
  leaderboard_placement: 'pro',
  premium_challenges: 'pro',
  priority_support: 'pro',
  early_access: 'pro',
  mt5_autosync: 'pro',
  crypto_import: 'pro',
  crypto_autosync: 'pro',
}

export function can(tier: Tier, feature: Feature): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURE_MIN_TIER[feature]]
}
