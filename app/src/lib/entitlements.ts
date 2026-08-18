export type Tier = 'free' | 'trader' | 'pro'
export type Interval = 'monthly' | 'annual'

export const TIER_RANK: Record<Tier, number> = { free: 0, trader: 1, pro: 2 }
export const JOURNAL_FREE_LIMIT = 30

const ACTIVE_STATUSES = new Set(['active', 'trialing'])

/** Dunning grace window, in days, for a subscription Stripe has flipped to
 *  `past_due`.
 *
 *  WHY A GRACE PERIOD EXISTS AT ALL. `past_due` means the RENEWAL invoice
 *  failed — an expired card, a bank fraud hold, a temporary limit. The customer
 *  has done nothing wrong and Stripe is still retrying. Without grace the tier
 *  drops the instant the status flips, so paid features vanish mid-use with no
 *  warning. Terms §10 says access "may be unavailable" while a payment is
 *  outstanding, which permits that but does not require it; granting grace is
 *  strictly more generous than the contract promises, so the code and the terms
 *  agree either way.
 *
 *  WHY 14 DAYS.
 *   1. Stripe's default Smart Retries make their attempts across roughly the
 *      first week, so a fortnight covers essentially every recovery that is
 *      going to happen. A customer who updates their card within two weeks
 *      never experiences an outage at all.
 *   2. It is strictly SHORTER than Stripe's ~3-week full retry cycle, so access
 *      can never outlive the dunning process — and, critically, it still ends
 *      even if the Stripe subscription setting after retries are exhausted is
 *      "leave the subscription past_due", which would otherwise grant free
 *      service forever.
 *   3. Worst-case exposure is bounded at half a monthly period: A$15 on Trader,
 *      A$25 on Pro. Acceptable at any scale this product will see soon.
 *   4. It reuses the number already in the product (TRIAL_DAYS), so there is one
 *      "14 days" to explain rather than two.
 *
 *  WHY IT IS MEASURED FROM `updated_at`. The obvious candidate,
 *  `current_period_end`, does NOT work: Stripe advances the billing period when
 *  the renewal invoice is CREATED, not when it is paid, so a past_due
 *  subscription already has a period end a month in the future. Keying off it
 *  would hand out a whole free month. `subscriptions.updated_at` is bumped by
 *  the `subscriptions_touch_updated_at` trigger on the very UPDATE that writes
 *  `status='past_due'`, so it is the closest thing we hold to "when did dunning
 *  start". This is why the reconciliation cron must not rewrite rows that have
 *  not changed — a no-op UPDATE would still fire the trigger and silently
 *  restart the grace clock. See lib/server/billing-reconcile.ts. */
export const PAST_DUE_GRACE_DAYS = 14
const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000

/** The shape every tier decision needs. `updated_at` is optional so a caller
 *  that did not select it degrades to the pre-grace behaviour (past_due drops
 *  the tier immediately) rather than throwing or, worse, granting forever. */
export type SubRow = {
  tier: string
  status: string
  updated_at?: string | null
  current_period_end?: string | null
}

/** Type guard: validates that a string is a known tier using an explicit
 *  allow-list rather than other["in"], which walks the prototype chain and
 *  would incorrectly accept Object.prototype keys like 'toString'. */
export function isTier(t: string): t is Tier {
  return t === 'free' || t === 'trader' || t === 'pro'
}

/** Whether one subscription row currently entitles its owner to its tier.
 *
 *  Fails CLOSED in every ambiguous direction: an unknown status, a missing
 *  `updated_at` on a past_due row, or an unparseable timestamp all yield false.
 *  Note `unpaid` deliberately gets NO grace — Stripe only reaches `unpaid` once
 *  the retry schedule is exhausted, so it is the end of dunning, not the
 *  middle of it. Nor does `incomplete`, where the FIRST payment never
 *  succeeded and the customer has therefore never held the tier. */
export function subscriptionGrantsTier(s: SubRow, now: Date): boolean {
  if (ACTIVE_STATUSES.has(s.status)) return true
  if (s.status !== 'past_due') return false
  if (!s.updated_at) return false
  const since = Date.parse(s.updated_at)
  if (Number.isNaN(since)) return false
  return now.getTime() - since < PAST_DUE_GRACE_MS
}

/** Days of grace left on a past_due row, rounded up, clamped to
 *  [0, PAST_DUE_GRACE_DAYS]. 0 for any row that is not in grace. */
export function graceDaysLeft(s: SubRow, now: Date): number {
  if (s.status !== 'past_due' || !s.updated_at) return 0
  const since = Date.parse(s.updated_at)
  if (Number.isNaN(since)) return 0
  const remaining = since + PAST_DUE_GRACE_MS - now.getTime()
  if (remaining <= 0) return 0
  return Math.min(PAST_DUE_GRACE_DAYS, Math.ceil(remaining / (24 * 60 * 60 * 1000)))
}

/** Effective tier = highest-ranked tier among rows that currently entitle,
 *  else free. `now` defaults so existing call sites keep working; every server
 *  path passes the same clock it uses for the trial. */
export function tierFromSubscriptions(subs: SubRow[], now: Date = new Date()): Tier {
  let best: Tier = 'free'
  for (const s of subs) {
    if (!subscriptionGrantsTier(s, now)) continue
    if (isTier(s.tier) && TIER_RANK[s.tier] > TIER_RANK[best]) best = s.tier
  }
  return best
}

/** Display rank for the billing UI, highest first:
 *    2 — currently entitling (active / trialing / past_due inside grace)
 *    1 — in trouble but recoverable (past_due out of grace, unpaid, incomplete)
 *    0 — over (canceled, incomplete_expired, anything unknown)
 *
 *  Tier alone is NOT enough. `getSubscription` used to sort on tier only, so a
 *  user who cancelled Pro and then bought Trader had their billing page driven
 *  by the dead Pro row: wrong status, wrong renewal date, wrong "your plan"
 *  marker, and a Checkout button for the plan they already hold. */
export function subStatusRank(s: SubRow, now: Date): number {
  if (subscriptionGrantsTier(s, now)) return 2
  if (s.status === 'past_due' || s.status === 'unpaid' || s.status === 'incomplete') return 1
  return 0
}

/** The row the billing UI should describe: entitling rows first, then higher
 *  tier, then the later period end. Pure and total — returns null for [].
 *
 *  Sorting a COPY, and using a fully deterministic comparator, so the result
 *  cannot depend on the order PostgREST happened to return rows in. */
export function pickCurrentSubscription<T extends SubRow>(rows: T[], now: Date): T | null {
  if (rows.length === 0) return null
  const end = (r: SubRow) => {
    if (!r.current_period_end) return -Infinity
    const t = Date.parse(r.current_period_end)
    return Number.isNaN(t) ? -Infinity : t
  }
  return [...rows].sort((a, b) => {
    const byStatus = subStatusRank(b, now) - subStatusRank(a, now)
    if (byStatus !== 0) return byStatus
    const byTier = (TIER_RANK[b.tier as Tier] ?? -1) - (TIER_RANK[a.tier as Tier] ?? -1)
    if (byTier !== 0) return byTier
    return end(b) - end(a)
  })[0]
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

export type TierInput = {
  /** Admin emails outrank every other grant (see getEntitlements). */
  isAdmin?: boolean
  compTier?: string | null
  /** Rows for THIS user only. Pass [] when the read failed — see getEntitlements
   *  on why an unknown subscription must not be treated as a paid one. Select
   *  `updated_at` alongside tier/status or past_due rows get no grace. */
  subs: SubRow[]
  trialStartedAt?: string | null
  trialAckAt?: string | null
}

/** The whole tier precedence in one pure function, so the single-user path
 *  (getEntitlements) and the bulk path (getTierMap) can never drift apart. */
export function resolveTier(input: TierInput, now: Date): Tier {
  if (input.isAdmin) return 'pro'
  return effectiveTier(
    input.compTier,
    tierFromSubscriptions(input.subs, now),
    trialState(input.trialStartedAt, input.trialAckAt, now),
  )
}

/** Whether a newly live subscription should also answer the end-of-trial modal.
 *
 *  A paid subscription IS an answer, so a subscriber who later churns is never
 *  re-walled. But only once the trial has actually run out: acking mid-trial
 *  would flip the state to 'resolved', which drops the trial's 'pro' grant, so
 *  someone who buys Trader on day 2 would be silently downgraded from the Pro
 *  they were promised for 14 days. The 14 days are a deliberate gift. */
export function shouldAckTrialOnSubscription(
  startedAt: string | null | undefined,
  ackAt: string | null | undefined,
  now: Date,
): boolean {
  return trialState(startedAt, ackAt, now) === 'expired'
}

/** The end-of-trial wall. Every condition must hold, so admins, comped users
 *  and subscribers are exempt without any special-casing. */
export function shouldShowWall(state: TrialState, tier: Tier, enabled: boolean): boolean {
  return enabled && state === 'expired' && tier === 'free'
}

/** Whether to show the tier welcome popup.
 *
 *  `seen` is profiles.welcome_tier_seen — the last tier we celebrated, NULL for
 *  a user who has never seen it. A mismatch against the effective tier means
 *  either "never celebrated" or "tier changed", which are the same event as far
 *  as this popup is concerned.
 *
 *  Three suppressions, each earning its place:
 *    * !onboarded — the root layout also wraps /welcome and /onboarding, so
 *      without this the popup lands on top of the signup flow it is meant to
 *      follow.
 *    * showWall — never compete with the non-escapable end-of-trial wall.
 *    * trial 'expired' AND tier 'free' — trial expiry IS mechanically a
 *      pro->free change, so a naive tier diff would fire a confetti "Welcome
 *      to Free" at exactly the moment the user lost Pro. This is narrowed to
 *      require tier === 'free' (rather than suppressing on 'expired' alone)
 *      because TRIAL_WALL_ENABLED can be unset in production, in which case
 *      nothing but the Stripe webhook ever writes trial_ack_at — and that
 *      webhook only fires for users who actually subscribe. A user whose
 *      trial expires unresolved and who never subscribes stays 'expired'
 *      indefinitely, so an unconditional suppression would also permanently
 *      hide a genuine later upgrade (e.g. an admin comp grant) for that user.
 *      Requiring tier === 'free' still blocks only the drop it was written
 *      for, and can never collide with the wall since shouldShowWall already
 *      requires tier === 'free' to fire in the first place. */
export function shouldShowWelcome(
  seen: string | null | undefined,
  tier: Tier,
  trial: TrialState,
  showWall: boolean,
  onboarded: boolean,
): boolean {
  if (!onboarded) return false
  if (showWall) return false
  if (trial === 'expired' && tier === 'free') return false
  return seen !== tier
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
  | 'ai_insights' | 'advanced_leaderboard_filters' | 'leaderboard_placement' | 'leaderboard_ranking'
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
  // Who may RANK at all. Distinct from leaderboard_placement, which is the
  // opposite control: the perk of hiding yourself from a board you qualify for.
  leaderboard_ranking: 'trader',
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
