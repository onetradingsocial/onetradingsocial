// Reusable campaign landing pages (Sprint 4, row 41). One template, many
// audiences — each with its own copy, proof points and CTA. Add an entry to
// launch a new /for/<slug> page.
export type Landing = {
  slug: string
  eyebrow: string
  headline: string
  sub: string
  points: { title: string; body: string }[]
  proof: string
  cta: string
}

export const LANDINGS: Record<string, Landing> = {
  forex: {
    slug: 'forex',
    eyebrow: 'For forex traders',
    headline: 'Prove your forex edge with verified numbers.',
    sub: 'Journal every pair, track pips and R, and build a track record that holds up — not screenshots.',
    points: [
      { title: 'Pip-accurate journaling', body: 'Log majors, minors and crosses with automatic pip and R calculation.' },
      { title: 'Session analytics', body: 'See whether your London or New York trades actually carry your account.' },
      { title: 'Verified track record', body: 'Connect MT5 and your closed trades sync automatically, tamper-proof.' },
    ],
    proof: 'Traders journaling forex on TradingSocial',
    cta: 'Start journaling forex free',
  },
  crypto: {
    slug: 'crypto',
    eyebrow: 'For crypto traders',
    headline: 'Bring discipline to your crypto trading.',
    sub: 'Track spot and perps, tag your setups, and see what your 3am entries really cost you.',
    points: [
      { title: 'Coins & perps', body: 'Journal BTC, ETH, alts and perpetuals with R-based risk tracking.' },
      { title: 'Mistake tracking', body: 'Tag FOMO and revenge trades and watch what they cost over time.' },
      { title: 'Emotional check-ins', body: 'Correlate how you felt with how you performed.' },
    ],
    proof: 'Crypto traders building verified records',
    cta: 'Start journaling crypto free',
  },
  futures: {
    slug: 'futures',
    eyebrow: 'For futures traders',
    headline: 'Journal your futures like a professional.',
    sub: 'Indices, commodities and micros — track contracts, R multiples and consistency in one place.',
    points: [
      { title: 'Contract-aware', body: 'Log ES, NQ, GC and micros with accurate risk and R.' },
      { title: 'Consistency scoring', body: 'The leaderboard rewards consistency and risk-adjusted return, not one lucky day.' },
      { title: 'Rule compliance', body: 'Set your rules and see the cost of breaking them.' },
    ],
    proof: 'Futures traders tracking their edge',
    cta: 'Start journaling futures free',
  },
  mt5: {
    slug: 'mt5',
    eyebrow: 'For MT5 users',
    headline: 'Your MT5 history, journaled and verified.',
    sub: 'Import a statement or connect your account — your closed trades flow in automatically.',
    points: [
      { title: 'One-click import', body: 'Upload an MT5 statement and your whole history lands in seconds.' },
      { title: 'Auto-sync', body: 'Connect once and new closed trades sync on their own, verified.' },
      { title: 'Locked execution data', body: 'Imported prices and results can\'t be edited — that\'s what makes them trustworthy.' },
    ],
    proof: 'Trades imported from MT5',
    cta: 'Connect MT5 free',
  },
  journal: {
    slug: 'journal',
    eyebrow: 'For trading-journal users',
    headline: 'The trading journal that actually gives feedback.',
    sub: 'Most journals are storage. This one turns your trades into weekly reviews, insights and goals.',
    points: [
      { title: 'Weekly review', body: 'Auto-generated: P&L, win rate, drawdown, best setup and your priciest mistake.' },
      { title: 'Personalised insights', body: 'Statistically-grounded patterns — with the sample size behind each one.' },
      { title: 'Process goals', body: 'Track journaling consistency and rule compliance, not just profit.' },
    ],
    proof: 'Traders journaling on TradingSocial',
    cta: 'Start your journal free',
  },
  'prop-firm': {
    slug: 'prop-firm',
    eyebrow: 'For prop-firm traders',
    headline: 'Pass the challenge. Respect the drawdown.',
    sub: 'Track your funded rules, watch your risk per trade, and prove your discipline.',
    points: [
      { title: 'Drawdown awareness', body: 'Most challenges fail on the daily drawdown rule — see every breach.' },
      { title: 'Account-type labels', body: 'Prop, live, demo and competition accounts are clearly labelled.' },
      { title: 'Rule compliance', body: 'Set max risk and session rules and get flagged when you break them.' },
    ],
    proof: 'Prop traders tracking their challenges',
    cta: 'Track your challenge free',
  },
  educators: {
    slug: 'educators',
    eyebrow: 'For trading educators',
    headline: 'Show your students a verified track record.',
    sub: 'Build a public, verified profile and a following around results that can be trusted.',
    points: [
      { title: 'Verified profile', body: 'Broker-synced trades carry a badge everywhere your profile appears.' },
      { title: 'Creator profile', body: 'Custom cover, tagline, CTA and pinned post for your audience.' },
      { title: 'Shareable cards', body: 'Branded performance cards for every platform.' },
    ],
    proof: 'Educators building verified profiles',
    cta: 'Build your profile free',
  },
}
