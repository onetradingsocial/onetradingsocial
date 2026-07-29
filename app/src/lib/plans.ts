import type { Tier } from '@/lib/entitlements'

/** Paid plan copy shared by the signup welcome screen and the end-of-trial
 *  modal. Prices mirror settings/billing; `pip` is a bare tier name so each
 *  surface can compose its own CSS class. */
export type PaidPlan = {
  tier: Extract<Tier, 'trader' | 'pro'>
  name: string
  pip: string
  monthly: number
  annual: number
  billedM: string
  billedA: string
  feats: { t: string }[]
}

export const PAID_PLANS: PaidPlan[] = [
  {
    tier: 'trader', name: 'Trader', pip: 'trader',
    monthly: 30, annual: 6, billedM: 'Billed monthly', billedA: '$72 first year, then $300/yr',
    feats: [
      { t: 'Unlimited journal entries' },
      { t: 'Import MT5 history (statement upload)' },
      { t: 'Advanced stats & full dashboard' },
      { t: 'Strategy tracking & mistake tagging' },
      { t: 'Private (solo) profile option' },
      { t: 'Advanced leaderboard filters' },
    ],
  },
  {
    tier: 'pro', name: 'Pro Trader', pip: 'pro',
    monthly: 50, annual: 10, billedM: 'Billed monthly', billedA: '$120 first year, then $500/yr',
    feats: [
      { t: 'Automatic MT5 sync — hourly' },
      { t: 'Advanced analytics & reporting' },
      { t: 'Monthly downloadable reports' },
      { t: 'Premium courses & psychology' },
      { t: 'Creator profile & Pro badge' },
      { t: 'Premium challenges & competitions' },
    ],
  },
]
