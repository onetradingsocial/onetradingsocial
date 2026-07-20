// Process-goal tracking (Sprint 4, row 24). Process goals reward behaviour, not
// profit. Pure progress calc so it's testable + shared.

export type GoalKind = 'journal_consistency' | 'rule_compliance' | 'max_risk' | 'weekly_reviews' | 'avoid_revenge'

export const GOAL_META: Record<GoalKind, { label: string; unit: string; hint: string }> = {
  journal_consistency: { label: 'Journal consistency', unit: '%', hint: 'Share of trading days with a logged trade' },
  rule_compliance: { label: 'Rule compliance', unit: '%', hint: 'Share of trades that followed all your rules' },
  max_risk: { label: 'Stay under max risk', unit: '%', hint: 'Keep risk per trade at or below this %' },
  weekly_reviews: { label: 'Weekly reviews', unit: ' / period', hint: 'Reviews completed in the window' },
  avoid_revenge: { label: 'Revenge-free streak', unit: ' days', hint: 'Consecutive days without a revenge-tagged trade' },
}

export type Goal = { id: number; kind: GoalKind; target: number; windowDays: number }

export type GoalInputs = {
  // Within each goal's window:
  tradingDays: number
  daysWithTrade: number
  totalTrades: number
  compliantTrades: number
  maxRiskUsed: number | null       // highest risk% seen
  weeklyReviews: number
  revengeFreeStreakDays: number
}

export type GoalProgress = { current: number; target: number; pct: number; met: boolean }

export function goalProgress(goal: Goal, x: GoalInputs): GoalProgress {
  let current = 0
  switch (goal.kind) {
    case 'journal_consistency':
      current = x.tradingDays > 0 ? Math.round((x.daysWithTrade / x.tradingDays) * 100) : 0
      break
    case 'rule_compliance':
      current = x.totalTrades > 0 ? Math.round((x.compliantTrades / x.totalTrades) * 100) : 0
      break
    case 'max_risk':
      // Progress = how far under the cap (100% when max used ≤ target).
      current = x.maxRiskUsed == null ? 100 : x.maxRiskUsed <= goal.target ? 100 : Math.max(0, Math.round((goal.target / x.maxRiskUsed) * 100))
      break
    case 'weekly_reviews':
      current = x.weeklyReviews
      break
    case 'avoid_revenge':
      current = x.revengeFreeStreakDays
      break
  }
  const met = goal.kind === 'max_risk' ? current >= 100 : current >= goal.target
  const pct = goal.kind === 'max_risk' ? current : Math.min(100, Math.round((current / goal.target) * 100))
  return { current, target: goal.target, pct, met }
}
