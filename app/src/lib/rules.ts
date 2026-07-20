// Trading rules + compliance analysis (Sprint 3, rows 18/19). Pure functions
// so they can be unit-tested and shared by server + client.

export type TradingRules = {
  maxTradesPerDay: number | null
  minRr: number | null
  maxRiskPercent: number | null
  requireStop: boolean
  session: TradingSession | null
  noTradeAfterLosses: number | null
}

export type TradingSession = 'london' | 'newyork' | 'asia' | 'sydney'

export const SESSION_LABELS: Record<TradingSession, string> = {
  london: 'London', newyork: 'New York', asia: 'Asia (Tokyo)', sydney: 'Sydney',
}

export const EMPTY_RULES: TradingRules = {
  maxTradesPerDay: null, minRr: null, maxRiskPercent: null,
  requireStop: false, session: null, noTradeAfterLosses: null,
}

// Session by UTC hour (approximate market hours; overlaps resolve to the
// session whose core block the hour falls in).
export function sessionForUtcHour(h: number): TradingSession {
  if (h >= 7 && h < 12) return 'london'
  if (h >= 12 && h < 21) return 'newyork'
  if (h >= 0 && h < 7) return 'asia'
  return 'sydney' // 21–24
}

export type RuleTrade = {
  tradedAt: string
  plannedRr: number | null
  riskPercent: number | null
  hasStop: boolean
  rMultiple: number | null
  pnlAmount: number | null
}

export type Violation =
  | 'max_trades_per_day' | 'min_rr' | 'max_risk_percent' | 'require_stop' | 'session' | 'no_trade_after_losses'

export type ComplianceResult = {
  followed: number
  broken: number
  brokenByRule: Record<Violation, number>
  costOfBroken: number       // summed P/L of trades that broke ≥1 rule and lost
  compliantPnl: number
  nonCompliantPnl: number
  compliantWinRate: number
  nonCompliantWinRate: number
  compliantCount: number
  nonCompliantCount: number
}

const EPS = 1e-9

/** Evaluate each closed trade against the rule set. Order = chronological. */
export function analyzeCompliance(rulesInput: TradingRules, tradesInput: RuleTrade[]): ComplianceResult {
  const trades = [...tradesInput].sort((a, b) => a.tradedAt.localeCompare(b.tradedAt))
  const brokenByRule: Record<Violation, number> = {
    max_trades_per_day: 0, min_rr: 0, max_risk_percent: 0, require_stop: 0, session: 0, no_trade_after_losses: 0,
  }

  const perDay = new Map<string, number>()
  let consecutiveLosses = 0
  let followed = 0, broken = 0, costOfBroken = 0
  let compliantPnl = 0, nonCompliantPnl = 0
  let compliantWins = 0, nonCompliantWins = 0, compliantCount = 0, nonCompliantCount = 0

  for (const t of trades) {
    const day = t.tradedAt.slice(0, 10)
    const nth = (perDay.get(day) ?? 0) + 1
    perDay.set(day, nth)

    const v: Violation[] = []
    if (rulesInput.maxTradesPerDay != null && nth > rulesInput.maxTradesPerDay) v.push('max_trades_per_day')
    if (rulesInput.minRr != null && t.plannedRr != null && t.plannedRr < rulesInput.minRr) v.push('min_rr')
    if (rulesInput.maxRiskPercent != null && t.riskPercent != null && t.riskPercent > rulesInput.maxRiskPercent) v.push('max_risk_percent')
    if (rulesInput.requireStop && !t.hasStop) v.push('require_stop')
    if (rulesInput.session != null && sessionForUtcHour(new Date(t.tradedAt).getUTCHours()) !== rulesInput.session) v.push('session')
    if (rulesInput.noTradeAfterLosses != null && consecutiveLosses >= rulesInput.noTradeAfterLosses) v.push('no_trade_after_losses')

    const pnl = t.pnlAmount ?? 0
    const isWin = (t.rMultiple ?? 0) > EPS

    if (v.length === 0) {
      followed++; compliantCount++; compliantPnl += pnl; if (isWin) compliantWins++
    } else {
      broken++; nonCompliantCount++; nonCompliantPnl += pnl; if (isWin) nonCompliantWins++
      for (const rule of v) brokenByRule[rule]++
      if (pnl < 0) costOfBroken += pnl
    }

    // Update loss streak AFTER evaluating (the rule looks at prior losses).
    const r = t.rMultiple ?? 0
    if (r < -EPS) consecutiveLosses++
    else if (r > EPS) consecutiveLosses = 0
  }

  return {
    followed, broken, brokenByRule, costOfBroken,
    compliantPnl, nonCompliantPnl,
    compliantWinRate: compliantCount ? compliantWins / compliantCount : 0,
    nonCompliantWinRate: nonCompliantCount ? nonCompliantWins / nonCompliantCount : 0,
    compliantCount, nonCompliantCount,
  }
}

export function hasAnyRule(r: TradingRules): boolean {
  return r.maxTradesPerDay != null || r.minRr != null || r.maxRiskPercent != null ||
    r.requireStop || r.session != null || r.noTradeAfterLosses != null
}

export const VIOLATION_LABELS: Record<Violation, string> = {
  max_trades_per_day: 'Max trades/day',
  min_rr: 'Minimum R:R',
  max_risk_percent: 'Max risk %',
  require_stop: 'Stop-loss required',
  session: 'Session restriction',
  no_trade_after_losses: 'No trade after losses',
}
