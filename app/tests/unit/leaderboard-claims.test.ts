import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_PERF_SORT, MIN_RANKED_TRADES, PERF_SORTS, PERF_SORT_LABEL,
  effectiveMinTrades, isPerfSort, perfMetric, rankPerformance, resolveSort,
  aggregatePerformance, type PerfTrade,
} from '@/lib/leaderboard'
import { MIN_COHORT } from '@/lib/compare'
import { fmtMetric } from '@/app/leaderboard/_components/format'

/**
 * Audit follow-up B4. Four things the /leaderboard page got wrong, pinned so
 * that undoing any of them fails here rather than in front of a user.
 */

const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')

// ── 1 · the false claim about who is on the board ───────────────────────────

describe('leaderboard header copy (B4)', () => {
  const page = src('app/leaderboard/page.tsx')

  it('never tells the viewer that everyone ranked is a paying subscriber', () => {
    // Two separate reasons it was false. (a) An ACTIVE TRIAL grants pro
    // app-wide on purpose, so a trialist ranks without paying; the eligibility
    // check is a tier check, and tier is not payment. (b) On the day this was
    // written production held exactly one subscriptions row — trader,
    // canceled, period ended 2026-07-26 — so no name on the board belonged to
    // a subscriber at all.
    //
    // The rendered copy must not claim otherwise. Comments are stripped first
    // so the explanation of the old bug does not trip its own guard.
    const rendered = page
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(rendered).not.toMatch(/subscribed trader/i)
    expect(rendered).not.toMatch(/every name here is a/i)
    // Nor may it be re-stated in the other direction: no assertion about what
    // anyone has or has not paid.
    expect(rendered).not.toMatch(/paying (subscriber|member|trader)s\b/i)
  })

  it('states the eligibility rule, including the trial, instead', () => {
    expect(page).toMatch(/Trader level and above/i)
    expect(page).toMatch(/14-day\s*\n?\s*trial/i)
  })

  it('stays inside the bounds /verification sets', () => {
    // /verification is explicit that a statement can be altered before upload
    // and that account type is self-declared, so the board may not describe
    // self-reported numbers as anything but unverified.
    expect(page).toMatch(/not\s*\n?\s*verified/i)
    expect(page).toMatch(/\/verification/)
    // And it must not promise verification of the things that page lists as
    // unverifiable.
    expect(page).not.toMatch(/independently verified|fully verified|all verified/i)
  })
})

// ── 2 · the default sort ────────────────────────────────────────────────────

describe('default ranking metric (B4)', () => {
  it('is not money', () => {
    // Total P/L is a function of account size and position sizing: risking 1%
    // of $500k beats risking 1% of $2k on identical decisions. It is the wrong
    // headline for a product about process, and not a fair contest either.
    expect(DEFAULT_PERF_SORT).not.toBe('pnl')
  })

  it('is expectancy — the risk-normalised metric the rest of the app compares on', () => {
    expect(DEFAULT_PERF_SORT).toBe('expectancy')
  })

  it('orders the sort control process metrics first and P/L late', () => {
    // The list order is the page's implied ranking of what matters.
    expect(PERF_SORTS[0]).toBe(DEFAULT_PERF_SORT)
    expect(PERF_SORTS.indexOf('pnl')).toBeGreaterThan(PERF_SORTS.indexOf('expectancy'))
  })

  it('ranks the bigger account below the better trader on the default metric', () => {
    // Same decisions, 100x the account. Under P/L the whale wins; under the
    // default it does not.
    const t = (u: string, pnl: number, r: number): PerfTrade =>
      ({ user_id: u, pnl_amount: pnl, r_multiple: r, outcome: r > 0 ? 'win' : 'loss' })
    const aggs = [...aggregatePerformance([
      // whale: 5 trades, +0.2R average, enormous dollars
      t('whale', 50_000, 1), t('whale', -10_000, -0.2), t('whale', -10_000, -0.2),
      t('whale', -10_000, -0.2), t('whale', -10_000, -0.2),
      // craftsman: 5 trades, +0.8R average, small dollars
      t('craft', 80, 1), t('craft', 80, 1), t('craft', 80, 1), t('craft', 80, 1), t('craft', -20, -0.2),
    ]).values()]
    expect(rankPerformance(aggs, 'pnl', MIN_RANKED_TRADES)[0].userId).toBe('whale')
    expect(rankPerformance(aggs, DEFAULT_PERF_SORT, MIN_RANKED_TRADES)[0].userId).toBe('craft')
  })

  it('gives every offered sort a label, and no orphan labels', () => {
    // The page names the metric it ranked by and the one it discarded, so a
    // missing label would render "undefined" into user-facing copy.
    for (const k of PERF_SORTS) expect(PERF_SORT_LABEL[k]).toBeTruthy()
    expect(Object.keys(PERF_SORT_LABEL).sort()).toEqual([...PERF_SORTS].sort())
  })

  it('accepts only real sort keys from the query string', () => {
    expect(isPerfSort('expectancy')).toBe(true)
    expect(isPerfSort('pnl')).toBe(true)
    expect(isPerfSort('lucky')).toBe(false)
    expect(isPerfSort(undefined)).toBe(false)
    expect(isPerfSort('__proto__')).toBe(false)
  })

  it('reports profit factor honestly instead of as a sort artefact', () => {
    // perfKey collapses Infinity so the SORT terminates; the DISPLAY must not
    // inherit MAX_SAFE_INTEGER and print it as a number someone achieved.
    const wins = aggregatePerformance([
      { user_id: 'u', pnl_amount: 10, r_multiple: 1, outcome: 'win' },
    ]).get('u')!
    expect(perfMetric(wins, 'profitFactor')).toBe(Infinity)
    expect(fmtMetric('profitFactor', Infinity)).toBe('∞')
    expect(fmtMetric('profitFactor', Infinity)).not.toContain('9007199254740991')
  })

  it('formats every metric in its own units, without a locale', () => {
    // Locale-dependent strings in an SSR'd component are React #418. Only the
    // money branch may reach toLocaleString, via the existing fmtPL.
    expect(fmtMetric('expectancy', 0.4237)).toBe('0.42R')
    expect(fmtMetric('avgR', -1)).toBe('-1.00R')
    expect(fmtMetric('winRate', 0.666)).toBe('67%')
    expect(fmtMetric('consistency', 0.5)).toBe('50%')
    expect(fmtMetric('riskAdjusted', 1.5)).toBe('1.50')
    expect(fmtMetric('trades', 12)).toBe('12')
    expect(fmtMetric('pnl', 1972)).toContain('+$')
  })
})

// ── 3 · the sample floor ────────────────────────────────────────────────────

describe('minimum sample (B4)', () => {
  it('is a real floor, not "any sample"', () => {
    expect(MIN_RANKED_TRADES).toBeGreaterThan(1)
  })

  it('reuses the comparison feature\'s number rather than inventing one', () => {
    // lib/compare.ts suppresses a peer benchmark below MIN_COHORT peers, and
    // lib/server/compare.ts drops peers under 3 trades. Being named and
    // numbered on a public board is a louder claim than contributing to an
    // anonymous median, so the board takes the stricter of the two.
    expect(MIN_RANKED_TRADES).toBe(MIN_COHORT)
    expect(MIN_RANKED_TRADES).toBeGreaterThanOrEqual(3)
  })

  it('cannot be lowered by a hand-edited query string', () => {
    expect(effectiveMinTrades(0)).toBe(MIN_RANKED_TRADES)      // the old "Any sample"
    expect(effectiveMinTrades(-99)).toBe(MIN_RANKED_TRADES)
    expect(effectiveMinTrades(NaN)).toBe(MIN_RANKED_TRADES)
    expect(effectiveMinTrades(undefined)).toBe(MIN_RANKED_TRADES)
    expect(effectiveMinTrades(null)).toBe(MIN_RANKED_TRADES)
  })

  it('honours a stricter request', () => {
    expect(effectiveMinTrades(30)).toBe(30)
    expect(effectiveMinTrades(MIN_RANKED_TRADES)).toBe(MIN_RANKED_TRADES)
  })

  it('keeps a one-lucky-trade account off the board entirely', () => {
    const t = (u: string, pnl: number, r: number): PerfTrade =>
      ({ user_id: u, pnl_amount: pnl, r_multiple: r, outcome: 'win' })
    const aggs = [...aggregatePerformance([
      t('lucky', 999_999, 40),                                   // one moonshot
      t('grinder', 100, 1), t('grinder', 100, 1), t('grinder', 100, 1),
      t('grinder', 100, 1), t('grinder', 100, 1),                // five ordinary trades
    ]).values()]
    const ranked = rankPerformance(aggs, DEFAULT_PERF_SORT, effectiveMinTrades(0))
    expect(ranked.map((r) => r.userId)).toEqual(['grinder'])
    // Not merely demoted — absent. A rank it has not earned is not shown at all.
    expect(ranked.some((r) => r.userId === 'lucky')).toBe(false)
  })

  it('is applied where board rows are produced, not per call site', () => {
    // getPerformanceRanking feeds /leaderboard, the home dashboard and the
    // profile page. Clamping there is what makes "ranked" mean the same
    // minimum sample on all three; clamping only in the page would leave the
    // other two on the old any-sample definition.
    const ranking = src('lib/server/ranking.ts')
    expect(ranking).toMatch(/effectiveMinTrades\(minTrades\)/)
    expect(ranking).toMatch(/rankPerformance\(group, sort, floor\)/)
    expect(ranking).not.toMatch(/rankPerformance\(group, sort, minTrades\)/)
  })

  it('no longer offers an unbounded sample option in the control', () => {
    // Comments stripped: the source explains what "Any sample" used to do, and
    // that explanation must not be what keeps this test green or red.
    const controls = src('app/leaderboard/_components/LeaderboardControls.tsx')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(controls).not.toMatch(/Any sample/)
    expect(controls).not.toMatch(/key: '0'/)
  })
})

// ── 4 · the silent coercion ─────────────────────────────────────────────────

describe('sort coercion is disclosed (B4)', () => {
  it('leaves an entitled viewer\'s choice alone', () => {
    expect(resolveSort('winRate', true)).toEqual({ sort: 'winRate', coerced: false })
    expect(resolveSort(DEFAULT_PERF_SORT, true)).toEqual({ sort: DEFAULT_PERF_SORT, coerced: false })
  })

  it('reports the override when the viewer lacks the filters entitlement', () => {
    // The coercion itself is fine — the sort control is a Trader feature. What
    // was not fine was doing it in silence: a free viewer opening a shared
    // ?sort=winRate link got a differently ordered board and no explanation.
    expect(resolveSort('winRate', false)).toEqual({ sort: DEFAULT_PERF_SORT, coerced: true })
    expect(resolveSort('pnl', false)).toEqual({ sort: DEFAULT_PERF_SORT, coerced: true })
  })

  it('does not cry override when nothing was overridden', () => {
    // An unentitled viewer who asked for the default (or asked for nothing, in
    // which case the page has already defaulted) had no choice discarded.
    expect(resolveSort(DEFAULT_PERF_SORT, false)).toEqual({ sort: DEFAULT_PERF_SORT, coerced: false })
  })

  it('the page renders the disclosure and does not just drop the flag', () => {
    const page = src('app/leaderboard/page.tsx')
    expect(page).toMatch(/const \{ sort, coerced \} = resolveSort\(requestedSort, canAdvFilters\)/)
    expect(page).toMatch(/\{coerced && \(/)
    expect(page).toMatch(/You asked for/)
  })
})

// ── 5 · personal progress is first on the page ──────────────────────────────

describe('page hierarchy (B4)', () => {
  const page = src('app/leaderboard/page.tsx')

  it('puts the viewer\'s own standing in the main column, not the hidden rail', () => {
    // globals.css: `@media (max-width: 900px) { .ts-feed-side { display: none } }`.
    // While the standing card lived in that aside, the whole personal half of
    // the page vanished on a phone and the page became other people's numbers.
    expect(page).not.toMatch(/<aside className="ts-feed-side">/)
    expect(page).not.toMatch(/ts-feed-main/)
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    expect(css).toMatch(/\.ts-feed-side \{ display: none; \}/)
  })

  it('renders the standing above the board', () => {
    const standing = page.indexOf('<LeaderboardRail')
    const tabs = page.indexOf('<LeaderboardTabs')
    const board = page.indexOf('<PerformanceBoard')
    expect(standing).toBeGreaterThan(-1)
    expect(standing).toBeLessThan(tabs)
    expect(standing).toBeLessThan(board)
  })

  it('ranks the standing card on the same metric and sample as the board below it', () => {
    // Otherwise the card says #3 and the table under it says #9.
    expect(page).toMatch(/getPerformanceRanking\(supabase, period, sort, 'all', minTrades\)/)
  })
})
