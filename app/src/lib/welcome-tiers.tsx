import type { ReactNode } from 'react'
import type { Tier } from '@/lib/entitlements'

/** Per-tier copy for the post-onboarding welcome popup.
 *
 *  Every string is verbatim from the client's standalone mockups
 *  (TradingSocial Welcome {Free,Trader,Pro Trader} (Standalone).html) — the three
 *  files are byte-identical apart from the eight fields modelled here, so they
 *  are one component with a config map rather than three components.
 *
 *  Kept separate from plans.ts, whose PAID_PLANS has no 'free' entry and serves
 *  the billing surfaces with different copy. */
export type WelcomeFeat = { t: string; d: string }

export type WelcomeCopy = {
  aria: string
  eyebrow: string
  em: string
  sub: string
  price: string
  cta: string
  /** Empty for 'free', whose CTA needs the username — resolved at render. */
  href: string
  icon: ReactNode
  feats: WelcomeFeat[]
}

/** Shown instead of the tier's own price while a no-card trial is active: a
 *  trialist holds Pro features but has paid nothing, so "A$50 / month · billed
 *  monthly" would be plainly false for them. */
export const TRIAL_PRICE = '14 days free · then choose a plan'

export const WELCOME_TIERS: Record<Tier, WelcomeCopy> = {
  free: {
    aria: 'Welcome to free',
    eyebrow: "You're on Free",
    em: 'Free',
    sub: 'Your trading profile is live. Log trades, follow traders, and start building your track record — no card required.',
    price: 'A$0 / month · free forever',
    cta: 'Explore your Profile',
    href: '',
    icon: (
      <>
        <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="2" />
        <path d="M5 20a7 7 0 0114 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    feats: [
      { t: 'Public trading profile', d: 'Your handle, stats and history, visible to the community' },
      { t: 'Basic trading journal', d: 'Manually log trades and tag how each one went' },
      { t: 'Basic stats dashboard', d: 'Win rate and P&L at a glance' },
      { t: 'Follow traders & newsfeed', d: 'See what disciplined traders are doing, in real time' },
      // Learn hidden for now — we are not financial advisors. `d` was
      // 'Level up as you journal and learn consistently'. Restore when compliant.
      { t: 'Earn XP & badges', d: 'Level up as you journal consistently' },
      { t: 'Public leaderboard access', d: 'See where you rank against the community' },
    ],
  },
  trader: {
    aria: 'Welcome to trader',
    eyebrow: "You're on Trader",
    em: 'Trader',
    // Learn hidden for now — we are not financial advisors. `sub` ended
    // '…deeper analytics, and the full learning hub — everything to sharpen your
    // edge.' Restore when compliant.
    sub: 'You just unlocked unlimited journaling, deeper analytics, and strategy tracking — everything to sharpen your edge.',
    price: 'A$30 / month · billed monthly',
    cta: 'Explore your Journal',
    href: '/journal',
    icon: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
    feats: [
      { t: 'Unlimited journal entries', d: 'No more 30-trade cap — log everything, forever' },
      { t: 'Advanced journal & full dashboard', d: 'Deeper performance breakdowns on every trade' },
      { t: 'Strategy tracking & mistake tagging', d: 'See exactly which setups and habits cost you' },
      { t: 'Weekly performance review', d: 'A standing check-in on risk and consistency' },
      { t: 'Advanced leaderboard filters', d: 'Compare yourself against traders like you' },
      // Learn hidden for now — we are not financial advisors. Restore
      // `{ t: 'Full beginner & intermediate courses', d: 'The entire learning hub, unlocked' },`
      // here when compliant.
    ],
  },
  pro: {
    aria: 'Welcome to pro',
    eyebrow: "You're on Pro Trader",
    em: 'Pro Trader',
    // Learn hidden for now — we are not financial advisors. `sub` read
    // '…advanced analytics, premium courses, a creator-style profile, and
    // competition eligibility.' Restore when compliant.
    sub: 'The full platform is yours — advanced analytics, monthly reports, a creator-style profile, and competition eligibility.',
    price: 'A$50 / month · billed monthly',
    cta: 'Explore Journal',
    href: '/journal',
    icon: <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
    feats: [
      { t: 'Full advanced analytics & reporting', d: 'Every metric serious traders track, in one view' },
      { t: 'Monthly trader report', d: 'A downloadable summary of your month, automatically' },
      { t: 'AI journal insights', d: 'Pattern detection on your habits — coming soon' },
      // Learn hidden for now — we are not financial advisors. Restore
      // `{ t: 'Premium courses & psychology modules', d: 'Advanced curriculum most traders never see' },`
      // here when compliant.
      { t: 'Creator-style profile & Pro badge', d: 'Stand out across leaderboards and feeds' },
      { t: 'Premium challenges & competitions', d: 'Eligible for prize competitions as they launch' },
    ],
  },
}
