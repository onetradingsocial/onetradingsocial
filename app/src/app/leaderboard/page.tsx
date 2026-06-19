import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPerformanceRanking } from '@/lib/server/ranking'
import type { Period, PerfSort } from '@/lib/leaderboard'
import { LeaderboardControls } from './_components/LeaderboardControls'
import { Podium } from './_components/Podium'
import { LeaderboardTable, type BoardRow } from './_components/LeaderboardTable'
import { YourStanding } from './_components/YourStanding'

const PERIOD_LABEL: Record<Period, string> = { day: 'today', week: 'this week', month: 'this month', all: 'all time' }

type Search = { period?: string; sort?: string }

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const period = (['day', 'week', 'month', 'all'].includes(sp.period ?? '') ? sp.period : 'week') as Period
  const sort = (['pnl', 'winRate', 'avgR', 'trades'].includes(sp.sort ?? '') ? sp.sort : 'pnl') as PerfSort

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const entries = await getPerformanceRanking(supabase, period, sort)
  const rows: BoardRow[] = entries.map((e) => ({
    rank: e.rank, userId: e.userId, username: e.username, displayName: e.displayName, avatarUrl: e.avatarUrl,
    pnl: e.pnl, winRate: e.winRate, avgR: e.avgR, trades: e.trades,
  }))
  const me = rows.find((r) => r.userId === user.id) ?? null
  const leader = rows[0] ?? null

  return (
    <main className="ts-page ts-feed lb-app">
      <div className="ts-feed-main lb-main">
        <header className="lb-head">
          <div className="tx">
            <h1 className="ts-h1">Leaderboard</h1>
            <p>Top-performing traders ranked by profit, win rate, and consistency. Track the best in real time, discover rising talent, and see how you stack up.</p>
          </div>
        </header>

        <LeaderboardControls period={period} sort={sort} />

        {rows.length > 0 && (
          <section>
            <div className="lb-section-h">
              <h2>Top performers</h2>
              <span className="lb-section-sub">{PERIOD_LABEL[period]}</span>
            </div>
            <Podium top={rows.slice(0, 3)} viewerId={user.id} />
          </section>
        )}

        <LeaderboardTable rows={rows} viewerId={user.id} />
      </div>

      <aside className="ts-feed-side">
        <YourStanding
          rank={me?.rank ?? null}
          total={rows.length}
          pnl={me?.pnl ?? 0}
          winRate={me?.winRate ?? 0}
          periodLabel={PERIOD_LABEL[period]}
          leaderPnl={leader?.pnl ?? null}
          leaderHandle={leader && leader.userId !== user.id ? leader.username : null}
        />
        <div className="ts-card ts-railcard">
          <div className="ts-rail-head"><h2 className="ts-h2">Daily quests</h2><span className="ts-soon">soon</span></div>
          <p className="faint mt-3" style={{ fontSize: 13 }}>Quests arrive with the XP phase.</p>
        </div>
      </aside>
    </main>
  )
}
