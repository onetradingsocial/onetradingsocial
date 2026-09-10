import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import {
  getPerformanceRanking, groupByCohort, COHORT_HEADING, COHORT_SUB, type VerifyFilter,
} from '@/lib/server/ranking'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { getXpRanking, getUserXp } from '@/lib/server/xp'
import type { Period as XpPeriod } from '@/lib/xp'
import {
  isPerfSort, resolveSort, effectiveMinTrades, perfMetric,
  DEFAULT_PERF_SORT, MIN_RANKED_TRADES, PERF_SORT_LABEL,
  type Period, type PerfSort,
} from '@/lib/leaderboard'
import { LeaderboardTabs } from './_components/LeaderboardTabs'
import { LeaderboardControls } from './_components/LeaderboardControls'
import { Podium } from './_components/Podium'
import { LeaderboardTable, type BoardRow } from './_components/LeaderboardTable'
import { XpTable, type XpRow } from './_components/XpTable'
import { YourStanding } from './_components/YourStanding'

export const metadata: Metadata = { title: 'Leaderboard — TradingSocial' }

const PERIOD_LABEL: Record<Period, string> = { day: 'today', week: 'this week', month: 'this month', all: 'all time' }

type Search = { cat?: string; period?: string; sort?: string; verify?: string; minTrades?: string }

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const cat = (['performance', 'xp'].includes(sp.cat ?? '') ? sp.cat : 'performance') as 'performance' | 'xp'
  const allowedPeriods = cat === 'xp' ? ['week', 'month', 'all'] : ['day', 'week', 'month', 'all']
  const period = (allowedPeriods.includes(sp.period ?? '') ? sp.period : 'week') as Period
  const requestedSort: PerfSort = isPerfSort(sp.sort) ? sp.sort : DEFAULT_PERF_SORT
  const verify = (['all', 'broker', 'statement', 'self', 'live', 'demo', 'prop'].includes(sp.verify ?? '') ? sp.verify : 'all') as VerifyFilter
  // effectiveMinTrades clamps to MIN_RANKED_TRADES, so a hand-edited
  // `?minTrades=0` (the option this control used to offer, labelled "Any
  // sample") raises the floor back rather than removing it. The server clamps
  // again inside getPerformanceRanking; this call exists so the SELECT shows
  // the value that was actually used.
  const minTrades = effectiveMinTrades(
    ['5', '10', '30', '50'].includes(sp.minTrades ?? '') ? Number(sp.minTrades) : MIN_RANKED_TRADES,
  )

  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  // Sorting beyond the default metric is Trader+. The coercion is unchanged;
  // what is new is that `resolveSort` reports it, so the page can say it
  // happened instead of quietly reordering the board under the viewer.
  const [tier, flags] = await Promise.all([getTier(supabase, user.id), getFeatureFlags()])
  const canAdvFilters = canFlag(flags, tier, 'advanced_leaderboard_filters')
  const canRank = canFlag(flags, tier, 'leaderboard_ranking')
  const { sort, coerced } = resolveSort(requestedSort, canAdvFilters)

  return (
    <main className="ts-page lb-app">
      <div className="lb-main">
        <header className="lb-head"><div className="tx">
          <h1 className="ts-h1">Leaderboard</h1>
          {/*
            What this paragraph used to say — "Ranking is for Trader and Pro
            members, so every name here is a subscribed trader" — was false
            twice over. Ranking eligibility is a TIER check, and the 14-day
            trial grants Pro app-wide on purpose (lib/entitlements resolveTier;
            leaderboardEligibleIds says so out loud), so an active trialist
            ranks without ever having paid. And on the day this was written the
            production `subscriptions` table held exactly one row — tier
            trader, status canceled, period ended 2026-07-26 — so there was no
            subscriber on the board to describe. The replacement states the
            eligibility rule, which is checkable, and claims nothing about
            anybody's payment status, which is not ours to assert.

            The verification sentence is bounded to match /verification, which
            is careful that a statement can be altered before upload, that
            account type is self-declared, and that we cannot tell whether an
            account is a trader's only account.
          */}
          <p>
            Ranked on public closed trades, grouped by how the numbers got here.
            Ranking is available at Trader level and above — which the 14-day
            trial also grants — so a name here means an eligible account, not a
            paying one. Self-reported rows are typed in by the trader and are
            not verified;{' '}
            <Link href="/verification">what we can and cannot check</Link>.
          </p>
        </div></header>

        {/*
          Personal progress is the first thing on the page, and on the main
          column rather than the rail. It used to sit in `.ts-feed-side`, which
          `globals.css` hides outright under 900px — so on a phone the page was
          other people's numbers and nothing else. For a product whose pitch is
          your own process, "how am I doing" cannot be the part that disappears
          first.
        */}
        <LeaderboardRail
          supabase={supabase} userId={user.id} cat={cat} period={period}
          sort={sort} minTrades={minTrades} canRank={canRank}
        />

        <LeaderboardTabs cat={cat} />
        <LeaderboardControls period={period} sort={sort} cat={cat} verify={verify} minTrades={String(minTrades)} canAdvFilters={canAdvFilters} />

        {cat === 'performance' && (
          <div className="lb-method">
            <p>
              Ranked by <b>{PERF_SORT_LABEL[sort]}</b> over public closed trades{' '}
              {PERIOD_LABEL[period]}, minimum sample <b>{minTrades} trades</b>.{' '}
              {minTrades === MIN_RANKED_TRADES
                ? `That is the floor: below ${MIN_RANKED_TRADES} trades there is not enough of a sample to rank an account honestly, so it is not ranked at all.`
                : `The board never ranks an account on fewer than ${MIN_RANKED_TRADES} trades.`}
            </p>
            {coerced && (
              <p className="lb-method-note">
                You asked for <b>{PERF_SORT_LABEL[requestedSort]}</b>. Sorting by anything
                other than {PERF_SORT_LABEL[DEFAULT_PERF_SORT]} needs Trader-level access,
                so the board below is sorted by {PERF_SORT_LABEL[DEFAULT_PERF_SORT]}{' '}
                instead — <Link href="/settings/billing">see plans</Link>.
              </p>
            )}
          </div>
        )}

        {cat === 'performance'
          ? <PerformanceBoard supabase={supabase} period={period} sort={sort} verify={verify} minTrades={minTrades} userId={user.id} />
          : <XpBoard supabase={supabase} period={period} userId={user.id} />}
      </div>
    </main>
  )
}

/**
 * The performance board, rendered as one section per verification cohort
 * (audit item 15, F5).
 *
 * Each cohort gets its own heading, its own podium and its own table with
 * ranks starting at 1, because they are separate rankings — see the header of
 * `lib/server/ranking.ts` for why. The podium is per cohort rather than one
 * podium over the whole board: a single gold ring above a mixed list is
 * precisely the "manual and broker-synced appear equivalent" problem, only
 * larger.
 *
 * When no broker-verified trader ranks, the empty state says so out loud
 * rather than leaving the reader to infer that everyone shown is verified.
 * Today that line renders on every load: production holds zero broker-sourced
 * trades and has never held one.
 */
async function PerformanceBoard({ supabase, period, sort, verify, minTrades, userId }: { supabase: Awaited<ReturnType<typeof createClient>>; period: Period; sort: PerfSort; verify: VerifyFilter; minTrades: number; userId: string }) {
  const entries = await getPerformanceRanking(supabase, period, sort, verify, minTrades)
  const groups = groupByCohort(entries)
  const toRow = (e: (typeof entries)[number]): BoardRow => ({
    rank: e.rank, userId: e.userId, username: e.username, displayName: e.displayName, avatarUrl: e.avatarUrl,
    pnl: e.pnl, winRate: e.winRate, avgR: e.avgR, trades: e.trades,
    expectancy: e.expectancy, profitFactor: e.profitFactor,
    verification: e.verification, accountType: e.accountType,
  })

  if (groups.length === 0) return <LeaderboardTable rows={[]} viewerId={userId} />

  const hasBroker = groups.some((g) => g.cohort === 'broker_connected')
  return (
    <>
      {verify === 'all' && !hasBroker && (
        <p className="lb-section-sub" style={{ margin: '0 0 14px' }}>
          No broker-verified traders rank {PERIOD_LABEL[period]}. Everything below is ranked
          separately by evidence quality — <Link href="/verification">how verification works</Link>.
        </p>
      )}
      {groups.map(({ cohort, rows }) => {
        const board = rows.map(toRow)
        return (
          <section key={cohort} style={{ marginBottom: 26 }}>
            <div className="lb-section-h">
              <h2>{COHORT_HEADING[cohort]}</h2>
              <span className="lb-section-sub">{PERIOD_LABEL[period]}</span>
            </div>
            <p className="lb-section-sub" style={{ margin: '0 0 12px' }}>{COHORT_SUB[cohort]}</p>
            <Podium top={board.slice(0, 3)} viewerId={userId} />
            <LeaderboardTable rows={board} viewerId={userId} title={COHORT_HEADING[cohort]} />
          </section>
        )
      })}
    </>
  )
}

async function XpBoard({ supabase, period, userId }: { supabase: Awaited<ReturnType<typeof createClient>>; period: Period; userId: string }) {
  const entries = await getXpRanking(supabase, period as XpPeriod)
  const rows: XpRow[] = entries.map((e) => ({
    rank: e.rank, userId: e.userId, username: e.username, displayName: e.displayName, avatarUrl: e.avatarUrl, xp: e.xp, level: e.level,
  }))
  const podium: BoardRow[] = rows.slice(0, 3).map((r) => ({
    rank: r.rank, userId: r.userId, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl,
    pnl: r.xp, winRate: 0, avgR: 0, trades: r.level,
  }))
  return (
    <>
      {rows.length > 0 && (
        <section>
          <div className="lb-section-h"><h2>Top earners</h2><span className="lb-section-sub">{PERIOD_LABEL[period]}</span></div>
          <Podium top={podium} viewerId={userId} kind="xp" />
        </section>
      )}
      <XpTable rows={rows} viewerId={userId} />
    </>
  )
}

async function LeaderboardRail({ supabase, userId, cat, period, sort, minTrades, canRank }: { supabase: Awaited<ReturnType<typeof createClient>>; userId: string; cat: 'performance' | 'xp'; period: Period; sort: PerfSort; minTrades: number; canRank: boolean }) {
  if (cat === 'xp') {
    const xp = await getUserXp(supabase, userId)
    const pct = Math.round(xp.level.progress * 100)
    return (
      <div className="ts-card ts-railcard">
        <div className="ts-rail-head"><h2 className="ts-h2">Your XP</h2><Link href="/achievements" className="ts-link-sm">All</Link></div>
        <p className="ach-xp mt-3">Level {xp.level.level} · {xp.totalXp.toLocaleString()} XP</p>
        <div className="ach-bar mt-3"><i style={{ width: pct + '%' }} /></div>
        <p className="faint mt-3" style={{ fontSize: 13 }}>{xp.level.xpIntoLevel.toLocaleString()} / {xp.level.xpToNext.toLocaleString()} XP to level {xp.level.level + 1}</p>
      </div>
    )
  }
  // Rank the standing card to the SAME period, metric and sample floor as the
  // board it now sits above. It used to pass period only, so it silently used
  // the getPerformanceRanking defaults: with the default metric no longer Total
  // P/L, a rank computed on a different metric than the table underneath it
  // would be a number the page contradicts on the next scroll.
  const board = await getPerformanceRanking(supabase, period, sort, 'all', minTrades)
  const me = board.find((e) => e.userId === userId) ?? null
  // Ranks are per cohort now (item 15 F5), so "#3 of 40" has to be read within
  // the viewer's own cohort or the rail contradicts the table it sits beside.
  // Same for the gap-to-leader bar: comparing a self-reported P&L against a
  // broker-verified leader is the equivalence the split exists to remove.
  const cohortRows = me ? board.filter((e) => e.cohort === me.cohort) : []
  const leader = cohortRows[0] ?? null
  return (
    <YourStanding
      rank={me?.rank ?? null}
      total={cohortRows.length}
      cohortLabel={me ? COHORT_HEADING[me.cohort].toLowerCase() : null}
      metricLabel={PERF_SORT_LABEL[sort]}
      metric={me ? perfMetric(me, sort) : 0}
      leaderMetric={leader ? perfMetric(leader, sort) : null}
      sort={sort}
      pnl={me?.pnl ?? 0}
      winRate={me?.winRate ?? 0}
      periodLabel={PERIOD_LABEL[period]}
      leaderHandle={leader && leader.userId !== userId ? leader.username : null}
      minRankedTrades={minTrades}
      canRank={canRank}
    />
  )
}
