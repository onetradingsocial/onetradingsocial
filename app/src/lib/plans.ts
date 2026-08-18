import type { Tier } from '@/lib/entitlements'

/** ISO code and display prefix for every price we quote. Owner-confirmed: the
 *  Stripe prices are in Australian dollars, so nothing on either property may
 *  show a bare `$` — an unqualified dollar sign in front of an Australian
 *  audience is a price representation we cannot stand behind.
 *
 *  Convention: `A$30/month`, backed by a spelled-out "Australian dollars (AUD)"
 *  line wherever a price block appears. `A$` sits BEFORE the number so it can
 *  never be misread as a bare `$` at a glance.
 *
 *  GST PLACEHOLDER — OWNER DECISION REQUIRED. Whether these amounts include GST
 *  depends on the operating entity's GST registration, which is not recorded
 *  anywhere in this repo. Once confirmed, add the GST line to every surface that
 *  imports CURRENCY_NOTE. Do NOT guess: ACL s48 requires the quoted figure to be
 *  the total payable. */
export const CURRENCY = 'AUD'
export const CUR = 'A$'
export const CURRENCY_NOTE = 'All prices are in Australian dollars (AUD).'

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
    monthly: 30, annual: 6, billedM: 'Billed monthly', billedA: 'A$72 first year, then A$300/yr',
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
    monthly: 50, annual: 10, billedM: 'Billed monthly', billedA: 'A$120 first year, then A$500/yr',
    feats: [
      { t: 'Automatic MT5 sync — hourly' },
      { t: 'Advanced analytics & reporting' },
      { t: 'Monthly downloadable reports' },
      // Learn hidden for now — we are not financial advisors. Restore
      // `{ t: 'Premium courses & psychology' },` here when compliant.
      { t: 'Creator profile & Pro badge' },
      { t: 'Premium challenges & competitions' },
    ],
  },
]
