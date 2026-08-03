export const DIRECTIONS = ['long', 'short'] as const
export type Direction = (typeof DIRECTIONS)[number]

export const SIZING_MODES = ['risk_percent', 'lots'] as const
export type SizingMode = (typeof SIZING_MODES)[number]

export const OUTCOMES = ['open', 'win', 'loss', 'breakeven'] as const
export type Outcome = (typeof OUTCOMES)[number]

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const
export type Confidence = (typeof CONFIDENCE_LEVELS)[number]

export const EMOTIONS = ['calm', 'focused', 'excited', 'anxious'] as const
export type Emotion = (typeof EMOTIONS)[number]

export const SETUP_PRESETS = ['Breakout', 'Retest', 'Trend Continuation', 'News Play'] as const

export const MISTAKE_TAGS = [
  'Entered too early', 'FOMO', 'No stop loss', 'Moved stop loss', 'Overleveraged',
  'Revenge traded', 'Ignored plan', 'Low-quality setup', 'Exited too early', 'Held too long',
] as const

const EPS = 1e-9

function sign(d: Direction): number {
  return d === 'long' ? 1 : -1
}

export type OpenInput = {
  direction: Direction
  entry: number
  stop: number
  target?: number | null
  pipSize: number
  sizingMode: SizingMode
  riskPercent?: number | null
  lots?: number | null
  accountBalance: number
  pipValuePerLot?: number | null
}

export type OpenComputed = {
  slPips: number
  tpPips: number | null
  plannedRr: number | null
  riskAmount: number
  estPnl: number | null
}

export function computeOpen(input: OpenInput): OpenComputed | { error: string } {
  const { entry, stop, target, pipSize, direction } = input
  if (Math.abs(entry - stop) < EPS) return { error: 'Stop cannot equal entry.' }

  const slPips = Math.abs(entry - stop) / pipSize
  const tpPips = target != null ? Math.abs(target - entry) / pipSize : null
  const plannedRr = target != null ? Math.abs(target - entry) / Math.abs(entry - stop) : null

  let riskAmount = 0
  if (input.sizingMode === 'risk_percent') {
    riskAmount = input.accountBalance * ((input.riskPercent ?? 0) / 100)
  } else {
    const pv = input.pipValuePerLot ?? 0
    riskAmount = slPips * pv * (input.lots ?? 0)
  }

  const estPnl = plannedRr != null ? riskAmount * plannedRr : null
  void direction // direction does not affect planned magnitudes
  return { slPips, tpPips, plannedRr, riskAmount, estPnl }
}

export type CloseInput = {
  direction: Direction
  entry: number
  stop: number
  exit: number
  pipSize: number
  riskAmount: number
}

export type CloseComputed = {
  realizedPips: number
  rMultiple: number
  pnlAmount: number
  outcome: Exclude<Outcome, 'open'>
}

export function computeClose(input: CloseInput): CloseComputed {
  const { direction, entry, stop, exit, pipSize, riskAmount } = input
  const slPips = Math.abs(entry - stop) / pipSize
  const realizedPips = ((exit - entry) * sign(direction)) / pipSize
  const rMultiple = realizedPips / slPips
  const pnlAmount = rMultiple * riskAmount
  const outcome = rMultiple > EPS ? 'win' : rMultiple < -EPS ? 'loss' : 'breakeven'
  return { realizedPips, rMultiple, pnlAmount, outcome }
}

export type TradeForMetrics = {
  status: 'open' | 'closed'
  outcome: Outcome
  rMultiple: number | null
  pnlAmount: number | null
  tradedAt: string
  mistakeTags: string[]
}

/** One definition of a stat-bearing trade, shared with `@/lib/leaderboard`.
 *
 *  A trade counts as soon as it is CLOSED. Stop-less quick entries carry an
 *  outcome and a P/L but no r_multiple, so gating on `rMultiple != null` erased
 *  them from every journal/profile stat while the leaderboard — which counts by
 *  `outcome` — still saw them: the same two trades read "0 trades, 0%" on one
 *  page and "2 trades, 100%" on the other. Win/loss therefore comes from
 *  `outcome`, the one field every closed trade has. Only genuinely
 *  R-denominated figures (avg R, profit factor, best/worst R) look at
 *  rMultiple, and they skip the nulls rather than counting them as zero. */
export const isClosed = (t: { status?: string | null }): boolean => t.status === 'closed'
export const isWin = (t: { outcome?: string | null }): boolean => t.outcome === 'win'
export const isLoss = (t: { outcome?: string | null }): boolean => t.outcome === 'loss'

/** The R values that actually exist — the only input an R metric may use. */
export const rValues = (rs: (number | null | undefined)[]): number[] =>
  rs.filter((r): r is number => r != null)

export type Metrics = {
  total: number          // closed trades
  open: number
  wins: number
  losses: number
  winRate: number
  avgRr: number
  profitFactor: number
  best: number
  worst: number
  currentStreak: number  // +n win run / -n loss run, by most recent closed
  netPnl: number
  mistakeCounts: Record<string, number>
}

export function computeMetrics(trades: TradeForMetrics[]): Metrics {
  const closed = trades.filter(isClosed)
  const open = trades.filter((t) => t.status === 'open').length
  const rs = rValues(closed.map((t) => t.rMultiple))
  const wins = closed.filter(isWin).length
  const losses = closed.filter(isLoss).length
  const grossWin = rs.filter((r) => r > EPS).reduce((a, b) => a + b, 0)
  const grossLoss = Math.abs(rs.filter((r) => r < -EPS).reduce((a, b) => a + b, 0))
  const netPnl = closed.reduce((a, t) => a + (t.pnlAmount ?? 0), 0)

  const mistakeCounts: Record<string, number> = {}
  for (const t of closed) for (const tag of t.mistakeTags) mistakeCounts[tag] = (mistakeCounts[tag] ?? 0) + 1

  // streak: walk most-recent-first by tradedAt. Driven by outcome, not R, so a
  // stop-less closed trade extends (or ends) the run like any other.
  const byRecent = [...closed].sort((a, b) => b.tradedAt.localeCompare(a.tradedAt))
  let streak = 0
  for (const t of byRecent) {
    const dir = isWin(t) ? 1 : isLoss(t) ? -1 : 0
    if (dir === 0) break
    if (streak === 0 || Math.sign(streak) === dir) streak += dir
    else break
  }

  return {
    total: closed.length,
    open,
    wins,
    losses,
    winRate: closed.length ? wins / closed.length : 0,
    // R metrics average over the trades that HAVE an R — dividing by every
    // closed trade would drag a stop-less journal's avg R towards zero.
    avgRr: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    best: rs.length ? Math.max(...rs) : 0,
    worst: rs.length ? Math.min(...rs) : 0,
    currentStreak: streak,
    netPnl,
    mistakeCounts,
  }
}
