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
import type { Period, PerfSort } from '@/lib/leaderboard'
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
  const requestedSort = (['pnl', 'winRate', 'avgR', 'trades', 'expectancy', 'profitFactor', 'consistency', 'riskAdjusted'].includes(sp.sort ?? '') ? sp.sort : 'pnl') as PerfSort
  const verify = (['all', 'broker', 'statement', 'self', 'live', 'demo', 'prop'].includes(sp.verify ?? '') ? sp.verify : 'all') as VerifyFilter
  const minTrades = (['0', '10', '30', '50'].includes(sp.minTrades ?? '') ? Number(sp.minTrades) : 0)

  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  // Advanced filters (sorting beyond P/L) are Trader+ — coerce to pnl for Free.
  const [tier, flags] = await Promise.all([getTier(supabase, user.id), getFeatureFlags()])
  const canAdvFilters = canFlag(flags, tier, 'advanced_leaderboard_filters')
  const canRank = canFlag(flags, tier, 'leaderboard_ranking')
  const sort: PerfSort = canAdvFilters ? requestedSort : 'pnl'

  return (
    <main className="ts-page ts-feed lb-app">
      <div className="ts-feed-main lb-main">
        <header className="lb-head"><div className="tx">
          <h1 className="ts-h1">Pro Leaderboard</h1>
          <p>Top-performing traders ranked by profit, win rate, consistency — and now XP. Ranking is for Trader and Pro members, so every name here is a subscribed trader putting their numbers on the line.</p>
        </div></header>

        <LeaderboardTabs cat={cat} />
        <LeaderboardControls period={period} sort={sort} cat={cat} verify={verify} minTrades={String(minTrades)} canAdvFilters={canAdvFilters} />

        {cat === 'performance'
          ? <PerformanceBoard supabase={supabase} period={period} sort={sort} verify={verify} minTrades={minTrades} userId={user.id} />
          : <XpBoard supabase={supabase} period={period} userId={user.id} />}
      </div>

      <aside className="ts-feed-side">
        <LeaderboardRail supabase={supabase} userId={user.id} cat={cat} period={period} canRank={canRank} />
      </aside>
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

async function LeaderboardRail({ supabase, userId, cat, period, canRank }: { supabase: Awaited<ReturnType<typeof createClient>>; userId: string; cat: 'performance' | 'xp'; period: Period; canRank: boolean }) {
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
  // Rank the rail to the SAME period as the board so the rank matches its period label.
  const board = await getPerformanceRanking(supabase, period)
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
      pnl={me?.pnl ?? 0}
      winRate={me?.winRate ?? 0}
      periodLabel={PERIOD_LABEL[period]}
      leaderPnl={leader?.pnl ?? null}
      leaderHandle={leader && leader.userId !== userId ? leader.username : null}
      canRank={canRank}
    />
  )
}
