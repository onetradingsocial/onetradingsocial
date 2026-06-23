import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { getPerformanceRanking } from '@/lib/server/ranking'
import { getXpRanking, getUserXp } from '@/lib/server/xp'
import type { Period as XpPeriod } from '@/lib/xp'
import type { Period, PerfSort } from '@/lib/leaderboard'
import { LeaderboardTabs } from './_components/LeaderboardTabs'
import { LeaderboardControls } from './_components/LeaderboardControls'
import { Podium } from './_components/Podium'
import { LeaderboardTable, type BoardRow } from './_components/LeaderboardTable'
import { XpTable, type XpRow } from './_components/XpTable'
import { YourStanding } from './_components/YourStanding'

const PERIOD_LABEL: Record<Period, string> = { day: 'today', week: 'this week', month: 'this month', all: 'all time' }

type Search = { cat?: string; period?: string; sort?: string }

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const cat = (['performance', 'xp'].includes(sp.cat ?? '') ? sp.cat : 'performance') as 'performance' | 'xp'
  const allowedPeriods = cat === 'xp' ? ['week', 'month', 'all'] : ['day', 'week', 'month', 'all']
  const period = (allowedPeriods.includes(sp.period ?? '') ? sp.period : 'week') as Period
  const sort = (['pnl', 'winRate', 'avgR', 'trades'].includes(sp.sort ?? '') ? sp.sort : 'pnl') as PerfSort

  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  return (
    <main className="ts-page ts-feed lb-app">
      <div className="ts-feed-main lb-main">
        <header className="lb-head"><div className="tx">
          <h1 className="ts-h1">Leaderboard</h1>
          <p>Top-performing traders ranked by profit, win rate, consistency — and now XP. Track the best in real time, discover rising talent, and see how you stack up.</p>
        </div></header>

        <LeaderboardTabs cat={cat} />
        <LeaderboardControls period={period} sort={sort} cat={cat} />

        {cat === 'performance'
          ? <PerformanceBoard supabase={supabase} period={period} sort={sort} userId={user.id} />
          : <XpBoard supabase={supabase} period={period} userId={user.id} />}
      </div>

      <aside className="ts-feed-side">
        <LeaderboardRail supabase={supabase} userId={user.id} cat={cat} period={period} />
      </aside>
    </main>
  )
}

async function PerformanceBoard({ supabase, period, sort, userId }: { supabase: Awaited<ReturnType<typeof createClient>>; period: Period; sort: PerfSort; userId: string }) {
  const entries = await getPerformanceRanking(supabase, period, sort)
  const rows: BoardRow[] = entries.map((e) => ({
    rank: e.rank, userId: e.userId, username: e.username, displayName: e.displayName, avatarUrl: e.avatarUrl,
    pnl: e.pnl, winRate: e.winRate, avgR: e.avgR, trades: e.trades,
  }))
  return (
    <>
      {rows.length > 0 && (
        <section>
          <div className="lb-section-h"><h2>Top performers</h2><span className="lb-section-sub">{PERIOD_LABEL[period]}</span></div>
          <Podium top={rows.slice(0, 3)} viewerId={userId} />
        </section>
      )}
      <LeaderboardTable rows={rows} viewerId={userId} />
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

async function LeaderboardRail({ supabase, userId, cat, period }: { supabase: Awaited<ReturnType<typeof createClient>>; userId: string; cat: 'performance' | 'xp'; period: Period }) {
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
  const leader = board[0] ?? null
  return (
    <YourStanding
      rank={me?.rank ?? null}
      total={board.length}
      pnl={me?.pnl ?? 0}
      winRate={me?.winRate ?? 0}
      periodLabel={PERIOD_LABEL[period]}
      leaderPnl={leader?.pnl ?? null}
      leaderHandle={leader && leader.userId !== userId ? leader.username : null}
    />
  )
}
