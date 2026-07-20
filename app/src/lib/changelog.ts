// Product changelog (Sprint 3, row 30). Edit this list to publish an entry —
// what changed, why, when. Newest first. Ties back to the feature board.
export type ChangelogEntry = {
  date: string        // ISO date
  version?: string
  title: string
  what: string[]
  why?: string
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-07-16',
    title: 'Feedback engine',
    what: [
      'Weekly review now shows profit factor, drawdown, best strategy/session and your most expensive mistake.',
      'Set trading rules (max trades, min R:R, session, max risk) and see what breaking them costs.',
      'Mistake analysis: frequency, cost and whether each mistake is trending up or down.',
      'Leaderboard ranks by expectancy, profit factor, consistency and risk-adjusted return — with minimum sample sizes.',
      'Public feature board: suggest, vote and track what we build next.',
      'Report tools for suspicious performance, impersonation and manipulated screenshots.',
    ],
    why: 'Raw trade data is only useful if it turns into feedback you can act on.',
  },
  {
    date: '2026-07-16',
    title: 'Activation & onboarding',
    what: [
      'Quick trade entry — log a trade in under a minute, stop optional.',
      'Guided onboarding with a data-connection step and your first personalised insight.',
      'Onboarding checklist and a browsable demo journal before you connect anything.',
      'Richer empty states so a fresh journal shows you what it will become.',
    ],
    why: 'The first session should prove the product’s value fast.',
  },
  {
    date: '2026-07-15',
    title: 'Verification & trust',
    what: [
      'Every trade now carries a verification level: broker-connected, statement-imported or self-reported.',
      'Account-type labels (live, demo, prop, competition) shown across the app.',
      'Immutable audit trail on trades; imported execution data is locked.',
      'A public methodology page explaining exactly what we can and cannot verify.',
    ],
    why: 'Verified results are what make a trading track record worth trusting.',
  },
]
