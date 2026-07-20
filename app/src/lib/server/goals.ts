import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { goalProgress, type Goal, type GoalInputs } from '@/lib/goals'
import { analyzeCompliance, hasAnyRule, type TradingRules, type RuleTrade } from '@/lib/rules'
import type { GoalWithProgress } from '@/app/journal/_components/GoalsCard'

type TradeRow = {
  traded_at: string
  planned_rr: number | null
  risk_percent: number | null
  stop_price: number | null
  r_multiple: number | null
  status: string
  mistake_tags: string[] | null
}

const DAY = 864e5

// Distinct calendar days between two epochs (inclusive-ish), min 1.
function tradingDaysInWindow(windowDays: number): number {
  return Math.max(1, windowDays)
}

export async function getGoalsWithProgress(
  svc: SupabaseClient,
  userId: string,
  allTrades: TradeRow[],
  rules: TradingRules,
  now = Date.now(),
): Promise<GoalWithProgress[]> {
  const { data: goalRows } = await svc
    .from('process_goals').select('id, kind, target, window_days')
    .eq('user_id', userId).eq('active', true).order('created_at', { ascending: true })
  const goals: Goal[] = (goalRows ?? []).map((g) => ({ id: g.id, kind: g.kind, target: Number(g.target), windowDays: g.window_days }))
  if (goals.length === 0) return []

  // Weekly reviews are logged as analytics events; pull enough history to cover
  // the widest goal window.
  const maxWindow = Math.max(...goals.map((g) => g.windowDays))
  const since = new Date(now - maxWindow * DAY).toISOString()
  const { data: reviews } = await svc
    .from('analytics_events').select('created_at')
    .eq('user_id', userId).eq('event', 'weekly_review_viewed').gte('created_at', since)

  return goals.map((goal) => {
    const winStart = now - goal.windowDays * DAY
    const inWindow = allTrades.filter((t) => Date.parse(t.traded_at) >= winStart)
    const closed = inWindow.filter((t) => t.status === 'closed' && t.r_multiple != null)

    const daysWithTrade = new Set(inWindow.map((t) => t.traded_at.slice(0, 10))).size

    let compliantTrades = 0
    if (hasAnyRule(rules)) {
      const ruleTrades: RuleTrade[] = closed.map((t) => ({
        tradedAt: t.traded_at, plannedRr: t.planned_rr, riskPercent: t.risk_percent,
        hasStop: t.stop_price != null, rMultiple: t.r_multiple, pnlAmount: null,
      }))
      compliantTrades = analyzeCompliance(rules, ruleTrades).followed
    }

    const maxRiskUsed = inWindow.reduce<number | null>((m, t) => {
      if (t.risk_percent == null) return m
      return m == null ? t.risk_percent : Math.max(m, t.risk_percent)
    }, null)

    const weeklyReviews = (reviews ?? []).filter((r) => Date.parse(r.created_at) >= winStart).length

    // Revenge-free streak: days since the most recent revenge-tagged trade
    // (capped at the goal window).
    const revengeTrades = allTrades
      .filter((t) => (t.mistake_tags ?? []).some((m) => m.toLowerCase().includes('revenge')))
      .sort((a, b) => b.traded_at.localeCompare(a.traded_at))
    const lastRevenge = revengeTrades[0]
    const revengeFreeStreakDays = lastRevenge
      ? Math.floor((now - Date.parse(lastRevenge.traded_at)) / DAY)
      : goal.windowDays

    const inputs: GoalInputs = {
      tradingDays: tradingDaysInWindow(goal.windowDays),
      daysWithTrade,
      totalTrades: closed.length,
      compliantTrades,
      maxRiskUsed,
      weeklyReviews,
      revengeFreeStreakDays,
    }
    return { ...goal, progress: goalProgress(goal, inputs) }
  })
}
