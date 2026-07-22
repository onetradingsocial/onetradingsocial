// Referral programme (Backlog row 39).
//
// Rewards are earned on ACTIVATED referrals — a signup that never logs a trade
// is worth nothing, which removes the incentive to spam links. All rewards are
// non-cash by design; per the spec, no cash incentives until abuse controls are
// proven in the wild.

export type ReferralStatus = 'signed_up' | 'activated' | 'paid'

export type ReferralStats = {
  clicks: number
  signups: number
  activated: number   // referred user logged/imported a trade
  paid: number        // referred user converted to a paid plan
}

export type Reward = {
  id: string
  label: string
  detail: string
  needs: number       // activated referrals required
  earned: boolean
}

/** Ladder is intentionally shallow — reachable without spamming. */
export const REWARD_LADDER: Omit<Reward, 'earned'>[] = [
  { id: 'founder_badge', label: 'Founder badge', detail: 'A permanent badge on your profile', needs: 1 },
  { id: 'premium_month', label: '1 month of Trader', detail: 'Free premium time on us', needs: 3 },
  { id: 'early_access', label: 'Early feature access', detail: 'New features before everyone else', needs: 5 },
  { id: 'premium_quarter', label: '3 months of Pro', detail: 'Extended premium time', needs: 10 },
]

export function rewardsFor(activated: number): Reward[] {
  return REWARD_LADDER.map((r) => ({ ...r, earned: activated >= r.needs }))
}

/**
 * Free-Pro reward model (client, 2026-07-22): every activated referral earns the
 * referrer one month of Pro, free, capped at a full year. "Activated" keeps its
 * meaning — the referred trader logged their first trade — so signup spam earns
 * nothing. The earned months are redeemed through a $0 Stripe checkout that puts
 * a card on file and converts to monthly billing once the free time runs out.
 */
export const REFERRAL_MONTH_CAP = 12

export function earnedMonths(activated: number): number {
  return Math.max(0, Math.min(activated, REFERRAL_MONTH_CAP))
}

/** Next unearned reward, for the "x more to unlock" nudge. */
export function nextReward(activated: number): { reward: Reward; remaining: number } | null {
  const next = rewardsFor(activated).find((r) => !r.earned)
  return next ? { reward: next, remaining: next.needs - activated } : null
}

/**
 * Referral codes are derived from the username but salted with random chars so
 * they can't be guessed from a username alone (which would let someone forge
 * attribution for a user who never shared a link).
 */
export function makeReferralCode(username: string, rand: string): string {
  const base = username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'trader'
  return `${base}-${rand.toLowerCase().slice(0, 4)}`
}

/** Conversion rates for the referrer's dashboard. Guards divide-by-zero. */
export function conversionRates(s: ReferralStats): { clickToSignup: number; signupToActivated: number } {
  return {
    clickToSignup: s.clicks > 0 ? Math.round((s.signups / s.clicks) * 100) : 0,
    signupToActivated: s.signups > 0 ? Math.round((s.activated / s.signups) * 100) : 0,
  }
}
