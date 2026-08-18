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

/**
 * Upper bound on the self-reported `profiles.account_balance` (audit item 15,
 * F3). Enforced in `actions/account.ts` and again as a CHECK constraint in
 * migration 0053, because the column carries a client UPDATE grant.
 *
 * The number is derived, not chosen by taste, and it has two anchors:
 *
 *   UPPER — migration 0045 caps `trades.pnl_amount` at 1e12 and `r_multiple`
 *   at 1000. A risk-%-sized trade's P&L is `r_multiple × balance × risk%/100`,
 *   so with risk% at its practical ceiling of 100 a balance above 1e9 can
 *   produce a P&L that the pnl CHECK will reject — i.e. the user would be able
 *   to save a balance that then makes closing a trade fail with an opaque
 *   23514 they cannot act on. 1e9 × 1000 = 1e12 exactly, so the two bounds
 *   meet instead of contradicting each other.
 *
 *   LOWER — it must not reject a real account in ANY currency.
 *   `profiles.account_currency` is a free three-letter field and production
 *   already holds a PHP account. 1e9 VND is roughly USD 40k and 1e9 IDR is
 *   roughly USD 60k — both ordinary retail balances — so 1e9 sits above the
 *   realistic ceiling even in the weakest currencies in circulation.
 *   Production max today is 100,000.
 *
 * To be plain about what this is: a corruption floor, not an anti-fraud
 * control. Nothing here makes a self-declared balance true. What stops the
 * balance from rewriting a leaderboard is the removal of the retroactive
 * rescale in `saveAccount`, not this number.
 */
export const MAX_ACCOUNT_BALANCE = 1_000_000_000

/**
 * Validate a submitted account balance. Returns the number, or a message.
 *
 * Deliberately NOT a clamp. The previous code did
 * `Number.isFinite(n) && n >= 0 ? n : 0`, which turned a typo into a silent
 * write of zero — and, with the old retroactive rescale attached to it, a
 * silent rewrite of every risk-%-sized P&L the user had ever logged down to
 * $0. Refusing is the only safe direction for a field that other rows are
 * derived from.
 */
export function parseAccountBalance(value: unknown): { balance: number } | { error: string } {
  // Blank is not zero. `Number('')` is 0 and `Number(null)` is 0, so an empty
  // or missing field would otherwise sail through as a deliberate balance of
  // nothing — the same silent coercion this function exists to stop, wearing a
  // different hat. Someone clearing the box to edit the currency beside it
  // must not have their balance zeroed as a side effect.
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    return { error: 'Enter your account balance, or 0 if you would rather not state one.' }
  }
  const n = Number(value)
  if (!Number.isFinite(n)) return { error: 'Enter your account balance as a number.' }
  if (n < 0) return { error: 'Account balance cannot be negative.' }
  if (n > MAX_ACCOUNT_BALANCE) {
    return { error: `Account balance cannot exceed ${MAX_ACCOUNT_BALANCE.toLocaleString()}.` }
  }
  // Money, so two decimals. Stops a 15-decimal float from reaching the column
  // and re-emerging as a rounding difference in every derived risk_amount.
  return { balance: Math.round(n * 100) / 100 }
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
