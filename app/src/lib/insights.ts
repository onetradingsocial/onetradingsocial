// Personalised insight cards (Sprint 4, row 22). Statistically grounded — each
// insight carries the sample size it was computed from, and we suppress claims
// below a minimum sample so noise doesn't masquerade as an edge.
import { sessionForUtcHour, SESSION_LABELS } from '@/lib/rules'

export type InsightTrade = {
  rMultiple: number | null
  pnlAmount: number | null
  tradedAt: string
  setupType: string | null
  strategyTags: string[]
  mistakeTags: string[]
}

export type Insight = {
  id: string
  tone: 'good' | 'bad' | 'neutral'
  text: string
  sample: number   // number of trades behind the claim
}

const EPS = 1e-9
const MIN_SAMPLE = 8       // don't surface an insight below this
const MIN_SUBGROUP = 4     // per-bucket minimum

const isWin = (r: number | null) => (r ?? 0) > EPS

export function generateInsights(tradesInput: InsightTrade[]): Insight[] {
  const closed = tradesInput.filter((t) => t.rMultiple != null)
  if (closed.length < MIN_SAMPLE) return []
  const asc = [...closed].sort((a, b) => a.tradedAt.localeCompare(b.tradedAt))
  const out: Insight[] = []

  // 1) Session edge: best vs worst session by win rate.
  const bySession = new Map<string, { w: number; n: number }>()
  for (const t of closed) {
    const s = SESSION_LABELS[sessionForUtcHour(new Date(t.tradedAt).getUTCHours())]
    const b = bySession.get(s) ?? { w: 0, n: 0 }
    b.n++; if (isWin(t.rMultiple)) b.w++
    bySession.set(s, b)
  }
  const sessions = [...bySession.entries()].filter(([, b]) => b.n >= MIN_SUBGROUP)
    .map(([s, b]) => ({ s, wr: b.w / b.n, n: b.n }))
    .sort((a, b) => b.wr - a.wr)
  if (sessions.length >= 2) {
    const best = sessions[0], worst = sessions[sessions.length - 1]
    const diff = Math.round((best.wr - worst.wr) * 100)
    if (diff >= 10) {
      out.push({
        id: 'session', tone: 'good', sample: best.n + worst.n,
        text: `Your ${best.s} trades win ${diff} points more often than ${worst.s} (${Math.round(best.wr * 100)}% vs ${Math.round(worst.wr * 100)}%).`,
      })
    }
  }

  // 2) Losing streaks: performance after 2 consecutive losses.
  let streak = 0, afterN = 0, afterWins = 0
  for (const t of asc) {
    if (streak >= 2) { afterN++; if (isWin(t.rMultiple)) afterWins++ }
    const r = t.rMultiple ?? 0
    if (r < -EPS) streak++
    else if (r > EPS) streak = 0
  }
  if (afterN >= MIN_SUBGROUP) {
    const wr = Math.round((afterWins / afterN) * 100)
    const base = Math.round((closed.filter((t) => isWin(t.rMultiple)).length / closed.length) * 100)
    if (wr < base - 8) {
      out.push({
        id: 'tilt', tone: 'bad', sample: afterN,
        text: `After two straight losses your win rate drops to ${wr}% (vs ${base}% overall) — consider stepping away.`,
      })
    }
  }

  // 3) Best setup by win rate (min subgroup).
  const bySetup = new Map<string, { w: number; n: number }>()
  for (const t of closed) {
    const keys = [t.setupType, ...t.strategyTags].filter(Boolean) as string[]
    for (const k of keys) {
      const b = bySetup.get(k) ?? { w: 0, n: 0 }
      b.n++; if (isWin(t.rMultiple)) b.w++
      bySetup.set(k, b)
    }
  }
  const setups = [...bySetup.entries()].filter(([, b]) => b.n >= MIN_SUBGROUP)
    .map(([k, b]) => ({ k, wr: b.w / b.n, n: b.n })).sort((a, b) => b.wr - a.wr)
  if (setups.length) {
    const top = setups[0]
    out.push({
      id: 'setup', tone: 'good', sample: top.n,
      text: `Your highest-performing setup is "${top.k}" — ${Math.round(top.wr * 100)}% win rate over ${top.n} trades.`,
    })
  }

  // 4) Cost of trades taken with a mistake tag (proxy for out-of-plan).
  const mistakeTrades = closed.filter((t) => t.mistakeTags.length > 0)
  if (mistakeTrades.length >= MIN_SUBGROUP) {
    const cost = mistakeTrades.reduce((s, t) => s + Math.min(0, t.rMultiple ?? 0), 0)
    if (cost < -1) {
      out.push({
        id: 'mistakes', tone: 'bad', sample: mistakeTrades.length,
        text: `Trades you tagged with a mistake cost you ${cost.toFixed(1)}R in losses across ${mistakeTrades.length} trades.`,
      })
    }
  }

  // 5) Average winner trend: recent half vs older half.
  const winners = asc.filter((t) => isWin(t.rMultiple))
  if (winners.length >= MIN_SAMPLE) {
    const mid = Math.floor(winners.length / 2)
    const older = winners.slice(0, mid), recent = winners.slice(mid)
    const avg = (xs: InsightTrade[]) => xs.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / xs.length
    const oAvg = avg(older), rAvg = avg(recent)
    if (rAvg < oAvg * 0.8) {
      out.push({
        id: 'avg_winner', tone: 'bad', sample: winners.length,
        text: `Your average winner is shrinking — ${rAvg.toFixed(1)}R lately vs ${oAvg.toFixed(1)}R earlier. Are you cutting winners short?`,
      })
    } else if (rAvg > oAvg * 1.2) {
      out.push({
        id: 'avg_winner', tone: 'good', sample: winners.length,
        text: `Your average winner is growing — ${rAvg.toFixed(1)}R lately vs ${oAvg.toFixed(1)}R earlier. Letting winners run is paying off.`,
      })
    }
  }

  return out
}
