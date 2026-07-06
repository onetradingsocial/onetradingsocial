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
  | 'journal_unlimited' | 'advanced_stats' | 'pro_badge'
  | 'learning_intermediate' | 'premium_courses'
  | 'saved_traders' | 'creator_profile' | 'strategy_tracking' | 'mistake_tagging'
  | 'risk_tracking' | 'private_notes' | 'custom_templates' | 'export_journal'
  | 'weekly_review' | 'strategy_breakdown' | 'advanced_reporting' | 'monthly_report'
  | 'ai_insights' | 'advanced_leaderboard_filters' | 'leaderboard_placement'
  | 'premium_challenges' | 'xp_boosts' | 'priority_support' | 'early_access'
  | 'mt5_import' | 'mt5_autosync'

/** Full pricing-matrix gate. Features not yet built are still mapped so the
 *  gate is ready when the feature ships. */
export const FEATURE_MIN_TIER: Record<Feature, Tier> = {
  // Enforced in v1 (features that exist):
  journal_unlimited: 'trader',
  advanced_stats: 'trader',
  learning_intermediate: 'trader',
  premium_courses: 'pro',
  pro_badge: 'pro',
  mt5_import: 'trader',
  // Wired, enforced when built:
  saved_traders: 'trader',
  strategy_tracking: 'trader',
  mistake_tagging: 'trader',
  risk_tracking: 'trader',
  private_notes: 'trader',
  weekly_review: 'trader',
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
}

export function can(tier: Tier, feature: Feature): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURE_MIN_TIER[feature]]
}
