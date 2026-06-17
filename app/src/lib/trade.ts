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
