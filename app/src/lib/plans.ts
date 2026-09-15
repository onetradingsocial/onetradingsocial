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
 *  GST — RESOLVED 2026-09-15, owner-confirmed. The operating entity is **not
 *  registered for GST**, so no GST is charged and the figures below are the
 *  total amount payable exactly as written. A$30 is A$30.
 *
 *  This had been an open placeholder since the prices were first written, and
 *  it stopped being safe to leave open when the trial moved to Stripe: until
 *  then the figure was a quote a user clicked through several screens to
 *  accept, each one a chance to state the real total. With a card captured at
 *  signup and the charge automatic on day 14, the quoted figure becomes the
 *  authority for a debit nobody re-confirms — so a wrong one is money leaving
 *  an account at an amount the customer was never shown. ACL s48 requires the
 *  quoted figure to be the total payable, and now it demonstrably is.
 *
 *  IF THE ENTITY EVER REGISTERS, this is the first thing that must change, and
 *  it is not a copy change alone. ACL s48 forbids adding 10% at checkout for a
 *  consumer audience, so A$30 would NOT become A$33 — it would stay A$30 and
 *  net A$27.27 unless the prices are deliberately raised. Registering is a
 *  repricing decision wearing a compliance hat. Sales to non-residents are
 *  generally GST-free exports, so it would also mean location logic (Stripe
 *  Tax) rather than one flat rate.
 *
 *  Not advice — the registration position is the owner's, confirmed above. */
export const CURRENCY = 'AUD'
export const CUR = 'A$'
export const CURRENCY_NOTE = 'All prices are in Australian dollars (AUD).'

/** The GST position, for any surface that quotes a price. Pairs with
 *  CURRENCY_NOTE; kept separate so a surface can carry the currency line
 *  without the tax line, and so a future registration changes one constant. */
export const GST_NOTE = 'No GST is charged — the price shown is the total amount payable.'

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
