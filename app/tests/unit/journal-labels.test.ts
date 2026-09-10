import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Audit B1 — structural guards for the journal's captions.
 *
 * Every defect below was a *label*, not a formula: the arithmetic behind each
 * figure was verified correct against production and must not be touched. A
 * wrong caption cannot fail a type check and cannot fail a render test, so —
 * like `journal-filters.test.ts` and `admin-gate.test.ts` — the guard is the
 * source text. vitest runs in `node` here and nothing renders these components.
 *
 * Each case names the claim that was false, so a future reader can tell whether
 * they are looking at a guard or at bikeshedding.
 */

const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8')

const JOURNAL = src('app', 'journal', 'page.tsx')
const REPORT = src('app', 'journal', 'report', 'page.tsx')
const STATCARDS = src('app', 'journal', '_components', 'StatCards.tsx')
const RECENT = src('app', 'journal', '_components', 'RecentTrades.tsx')
const DONUT = src('app', 'journal', '_components', 'AssetDonut.tsx')
const WEEKLY = src('app', 'journal', '_components', 'WeeklyReviewCard.tsx')
const COMPARISON = src('app', 'journal', '_components', 'ComparisonCard.tsx')
const INSIGHTS = src('lib', 'insights.ts')
const STATS = src('lib', 'journal-stats.ts')

describe('equity curve caption (defect 3a)', () => {
  it('does not claim year-to-date', () => {
    // `equityCurve(closed)` has no year filter — it accumulates all closed
    // history. "YTD" was accurate only because production held no pre-2026
    // rows. The label moved; the series deliberately did not.
    expect(JOURNAL).not.toMatch(/>YTD</)
    expect(JOURNAL).toContain('all time · closed')
  })

  it('has no year filter in equityCurve to justify a YTD label', () => {
    const fn = STATS.slice(STATS.indexOf('export function equityCurve'))
      .slice(0, STATS.slice(STATS.indexOf('export function equityCurve')).indexOf('\n}') + 2)
    expect(fn).not.toMatch(/getFullYear/)
  })

  it('captions the report copy of the same series the same way', () => {
    expect(REPORT).toContain('Equity curve · all time · closed')
  })
})

describe('asset distribution caption (defect 3b)', () => {
  it('does not claim volume for a count', () => {
    // journal-stats computes pct = count / total. "by volume" means size
    // traded, which the app does not aggregate anywhere. Matched as rendered
    // text (`>by volume<`) so the comment recording the old label is allowed.
    expect(JOURNAL).not.toMatch(/>by volume</)
    expect(REPORT).not.toMatch(/>by volume</)
    expect(JOURNAL).toContain('by trade count')
  })

  it('says the distribution includes open trades', () => {
    // `dist` is built from `trades`, not `closed`, unlike the tile beside it.
    expect(JOURNAL).toMatch(/all trades incl\. open/)
    expect(REPORT).toMatch(/all trades incl\. open/)
  })

  it('computes the slice from a count, which is what the caption now says', () => {
    expect(STATS).toContain('pct: Math.round((count / total) * 100)')
  })
})

describe('two different counts both called "trades"', () => {
  it('names the closed-only tile as closed', () => {
    // metrics.total is closed.length. The donut centre beside it counts every
    // trade including open. Neither may say the bare word "trades" alone.
    expect(STATCARDS).toContain('label="Closed Trades"')
    expect(STATCARDS).not.toContain('label="Total Trades"')
  })

  it('names the donut centre as all trades', () => {
    expect(DONUT).toContain('ALL TRADES')
    expect(DONUT).not.toMatch(/>TRADES</)
  })

  it('names the report tile as closed too', () => {
    expect(REPORT).toContain('Closed trades')
    expect(REPORT).not.toContain('>Total trades<')
  })
})

describe('realised R is not planned R:R (defect 3c)', () => {
  it('does not label metrics.avgRr as R:R on the report', () => {
    // R:R reads as planned risk:reward. `metrics.avgRr` is the mean realised R
    // of closed trades — the same number the journal page calls "Avg R". A
    // genuine planned figure exists separately, in RiskTrackingCard.
    expect(REPORT).not.toMatch(/>Avg R:R</)
    expect(REPORT).toContain('Avg R realised')
  })

  it('keeps the planned figure distinctly named where it really is planned', () => {
    const risk = src('app', 'journal', '_components', 'RiskTrackingCard.tsx')
    expect(risk).toContain('Avg planned R:R')
    expect(risk).toContain('planned_rr')
  })
})

describe('the footer net tracks the visible rows (defect 1)', () => {
  it('no longer takes a month net it cannot filter', () => {
    // The prop and its two uses, not the comment that records why it went.
    expect(RECENT).not.toMatch(/monthNet: number/)
    expect(RECENT).not.toMatch(/monthNet >= 0/)
    expect(RECENT).not.toMatch(/\{\s*trades,\s*monthNet/)
    expect(JOURNAL).not.toMatch(/<RecentTrades[^>]*monthNet/)
    expect(src('app', 'demo', 'page.tsx')).not.toMatch(/<RecentTrades[^>]*monthNet/)
  })

  it('derives count and net from one shared definition of "shown"', () => {
    expect(RECENT).toContain('matchesTradeFilter')
    expect(RECENT).toContain('netOfTrades(shown)')
  })

  it('states the population the net is over, and the exclusions', () => {
    expect(RECENT).toContain('closed')
    expect(RECENT).toMatch(/excluded/)
  })
})

describe('profit factor tone follows the value (defect 2)', () => {
  it('is not hard-coded', () => {
    expect(STATCARDS).toContain('profitFactorTone')
    // The literal that painted 0.54 green.
    expect(STATCARDS).not.toContain('subTone="pos"')
  })

  it('carries an R unit marker and its sample size', () => {
    expect(STATCARDS).toContain('Profit factor ${pfText} (R)')
    expect(STATCARDS).toContain('R-scored closed trades')
    expect(STATCARDS).toContain('R-weighted, not money-weighted')
  })
})

describe('header win rate states its population', () => {
  it('gives a date range, a closed-only qualifier and an n', () => {
    expect(STATCARDS).toContain('of ${metrics.total} closed')
    expect(STATCARDS).toMatch(/All time · closed trades only · by outcome, n=\$\{metrics\.total\}/)
  })
})

describe('week trades tile', () => {
  it('says rolling 7 days and closed, not "logged this week"', () => {
    // periodSums counts over `Date.now() - 7 * 864e5` on the CLOSED list, so
    // "logged this week" was wrong twice: not a calendar week, and not logged.
    expect(STATCARDS).not.toContain('logged this week')
    expect(STATCARDS).toContain('trade date in last 7 days')
  })

  it('does not claim a close-date window the schema cannot support', () => {
    // JTrade carries `traded_at` and no closed-at column, and both periodSums
    // and weekSlice window on it. "Closed in the last 7 days" would exclude a
    // position opened a month ago and closed yesterday while claiming to
    // include it, so neither surface may say it.
    expect(STATS).not.toMatch(/closed_at|exited_at/)
    expect(STATCARDS).not.toMatch(/closed in the last 7 days/)
    expect(WEEKLY).not.toMatch(/closed in the last 7 days/)
    expect(WEEKLY).toContain('by trade date')
  })
})

describe('the insight base no longer claims totality (insights.ts)', () => {
  it('drops the word "overall"', () => {
    // The base is a win rate over R-bearing closed trades, counted by the sign
    // of R — a smaller sample than the header's, which counts every closed
    // trade by outcome. Calling it "overall" claimed the whole journal.
    expect(INSIGHTS).not.toContain('% overall')
  })

  it('names its denominator and its size', () => {
    expect(INSIGHTS).toContain('R-scored closed trades in your history')
    expect(INSIGHTS).toContain('${closed.length}')
  })
})

describe('comparison card states its R-bearing denominator', () => {
  it('says the win rate is counted by the sign of R', () => {
    expect(COMPARISON).toContain('by sign of R')
    expect(COMPARISON).toContain('R-scored, closed')
  })

  it('explains why it can differ from the header win rate', () => {
    // JSX wraps the sentence across lines, so allow the whitespace.
    expect(COMPARISON).toMatch(/can differ\s+from the one at the top of the page/)
  })
})

describe('weekly review no-data state (P0)', () => {
  it('renders a not-enough-data state instead of zeroed tiles', () => {
    expect(WEEKLY).toContain('Not enough data')
    expect(WEEKLY).toContain('emptyReason')
  })

  it('routes every delta through compareWeeks rather than raw subtraction', () => {
    // The false improvement was `thisWeek.netPnl - lastWeek.netPnl` computed
    // in the component, where an empty week is a pile of zeros.
    expect(WEEKLY).toContain('compareWeeks')
    expect(WEEKLY).not.toContain('thisWeek.netPnl - lastWeek.netPnl')
    expect(WEEKLY).not.toContain('thisWeek.total - lastWeek.total')
    expect(WEEKLY).not.toContain('(thisWeek.winRate - lastWeek.winRate)')
  })

  it('offers reviewing past trades, and the anchor it points at exists', () => {
    expect(WEEKLY).toContain('Review your past trades')
    expect(WEEKLY).toContain('href="#recent-trades"')
    expect(JOURNAL).toContain('id="recent-trades"')
  })

  it('offers recording a deliberate no-trade period', () => {
    expect(WEEKLY).toMatch(/Sat out on purpose/)
  })
})

describe('report provenance', () => {
  it('states the date range the report actually covers', () => {
    expect(REPORT).toContain('Covers {coverage}')
  })

  it('gives every headline tile a provenance line', () => {
    // Five tiles, five `.n` notes.
    expect(REPORT.match(/className="n"/g) ?? []).toHaveLength(5)
  })
})
