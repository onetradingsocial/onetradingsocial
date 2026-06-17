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
  const closed = trades.filter((t) => t.status === 'closed' && t.rMultiple != null)
  const open = trades.length - closed.length
  const rs = closed.map((t) => t.rMultiple as number)
  const wins = rs.filter((r) => r > EPS).length
  const losses = rs.filter((r) => r < -EPS).length
  const grossWin = rs.filter((r) => r > EPS).reduce((a, b) => a + b, 0)
  const grossLoss = Math.abs(rs.filter((r) => r < -EPS).reduce((a, b) => a + b, 0))
  const netPnl = closed.reduce((a, t) => a + (t.pnlAmount ?? 0), 0)

  const mistakeCounts: Record<string, number> = {}
  for (const t of closed) for (const tag of t.mistakeTags) mistakeCounts[tag] = (mistakeCounts[tag] ?? 0) + 1

  // streak: walk most-recent-first by tradedAt
  const byRecent = [...closed].sort((a, b) => b.tradedAt.localeCompare(a.tradedAt))
  let streak = 0
  for (const t of byRecent) {
    const r = t.rMultiple as number
    if (Math.abs(r) <= EPS) break
    const dir = r > 0 ? 1 : -1
    if (streak === 0 || Math.sign(streak) === dir) streak += dir
    else break
  }

  return {
    total: closed.length,
    open,
    wins,
    losses,
    winRate: closed.length ? wins / closed.length : 0,
    avgRr: closed.length ? rs.reduce((a, b) => a + b, 0) / closed.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    best: rs.length ? Math.max(...rs) : 0,
    worst: rs.length ? Math.min(...rs) : 0,
    currentStreak: streak,
    netPnl,
    mistakeCounts,
  }
}
