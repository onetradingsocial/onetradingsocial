// Trader comparison (Backlog row 36).
//
// Two comparisons, both privacy-preserving:
//   1. You vs your own past  — always available, nobody else involved.
//   2. You vs an anonymised peer benchmark — only ever aggregates, and only
//      when the cohort is large enough that no individual can be inferred.
//
// Deliberately NOT financial guidance: we report medians of logged behaviour,
// never "you should trade like X".

export const MIN_COHORT = 5   // never show a benchmark computed from fewer peers

export type PeriodStats = {
  trades: number
  winRate: number      // 0..1
  avgR: number
  profitFactor: number
}

/**
 * Deltas between two periods.
 *
 * The rate deltas are nullable and that is the whole point. `statsFor([])`
 * returns zeros — it has to return something — and subtracting a real previous
 * period from those zeros produced a *number*, which the UI then rendered with
 * an up arrow. A trader who took no trades at all in the current window, after
 * a window averaging −0.8R, was shown "▲ 0.80R" and told avg R had improved.
 * Absence is not improvement. Null means "there is nothing to compare", and the
 * card has to say so rather than paint a colour.
 *
 * `trades` stays a plain number: going from 5 trades to 0 is a real, measured
 * change in a count, not a rate computed over an empty denominator.
 */
export type CompareDeltas = {
  trades: number
  winRate: number | null
  avgR: number | null
  profitFactor: number | null
}

export type SelfComparison = {
  current: PeriodStats
  previous: PeriodStats
  /** true only when BOTH windows hold at least one R-bearing trade. */
  comparable: boolean
  deltas: CompareDeltas
}

export type PeerBenchmark = {
  cohortSize: number
  /** null when the cohort is too small to report without risking identification */
  median: PeriodStats | null
  /** viewer's percentile within the cohort, 0..100, null when suppressed */
  percentile: { winRate: number; avgR: number } | null
  cohortLabel: string
}

const EPS = 1e-9

export type CompareTrade = { rMultiple: number | null; tradedAt: string }

export function statsFor(trades: CompareTrade[]): PeriodStats {
  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r != null)
  if (rs.length === 0) return { trades: 0, winRate: 0, avgR: 0, profitFactor: 0 }
  const wins = rs.filter((r) => r > EPS)
  const grossWin = wins.reduce((a, b) => a + b, 0)
  const grossLoss = Math.abs(rs.filter((r) => r < -EPS).reduce((a, b) => a + b, 0))
  return {
    trades: rs.length,
    winRate: wins.length / rs.length,
    avgR: rs.reduce((a, b) => a + b, 0) / rs.length,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
  }
}

/** Split trades into the last `windowDays` vs the window before it. */
export function compareToSelf(trades: CompareTrade[], windowDays = 30, now = Date.now()): SelfComparison {
  const DAY = 864e5
  const curStart = now - windowDays * DAY
  const prevStart = now - 2 * windowDays * DAY
  const inRange = (t: CompareTrade, from: number, to: number) => {
    const ts = Date.parse(t.tradedAt)
    return ts >= from && ts < to
  }
  const current = statsFor(trades.filter((t) => inRange(t, curStart, now + DAY)))
  const previous = statsFor(trades.filter((t) => inRange(t, prevStart, curStart)))

  // A rate delta needs a denominator on both sides. With either window empty
  // the "previous" figure has nothing to be compared against and the
  // subtraction just reflects the other period back at the reader with its sign
  // flipped — the false improvement.
  const comparable = current.trades > 0 && previous.trades > 0
  const delta = (a: number, b: number): number | null => {
    if (!comparable) return null
    // An infinite profit factor (winners, no losers) minus a finite one is not
    // a quantity. It was already being reported as 0; it is now reported as
    // "no comparable value", which is what it is.
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    return a - b
  }

  return {
    current, previous, comparable,
    deltas: {
      trades: current.trades - previous.trades,
      winRate: delta(current.winRate, previous.winRate),
      avgR: delta(current.avgR, previous.avgR),
      profitFactor: delta(current.profitFactor, previous.profitFactor),
    },
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function percentileOf(value: number, population: number[]): number {
  if (population.length === 0) return 0
  const below = population.filter((p) => p < value).length
  return Math.round((below / population.length) * 100)
}

/**
 * Anonymised peer benchmark. `peers` are per-peer aggregate stats — never
 * individual trades, never usernames. Suppressed entirely below MIN_COHORT.
 */
export function benchmarkAgainstPeers(
  self: PeriodStats,
  peers: PeriodStats[],
  cohortLabel: string,
): PeerBenchmark {
  if (peers.length < MIN_COHORT) {
    return { cohortSize: peers.length, median: null, percentile: null, cohortLabel }
  }
  const finite = (xs: number[]) => xs.filter((x) => Number.isFinite(x))
  return {
    cohortSize: peers.length,
    median: {
      trades: Math.round(median(peers.map((p) => p.trades))),
      winRate: median(peers.map((p) => p.winRate)),
      avgR: median(peers.map((p) => p.avgR)),
      profitFactor: median(finite(peers.map((p) => p.profitFactor))),
    },
    percentile: {
      winRate: percentileOf(self.winRate, peers.map((p) => p.winRate)),
      avgR: percentileOf(self.avgR, peers.map((p) => p.avgR)),
    },
    cohortLabel,
  }
}
