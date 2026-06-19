import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPerformanceRanking } from '@/lib/server/ranking'
import { rankConsistency, rankFollowers, windowStart, type Period, type PerfSort } from '@/lib/leaderboard'
import { LeaderboardTabs } from './_components/LeaderboardTabs'
import { LeaderboardControls } from './_components/LeaderboardControls'
import { Podium } from './_components/Podium'
import { LeaderboardTable, type BoardRow } from './_components/LeaderboardTable'
import { RankCard } from './_components/RankCard'

const fmtPnl = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(0)}`
const maxAbs = (xs: number[]) => Math.max(1, ...xs.map((x) => Math.abs(x)))

type Search = { cat?: string; period?: string; sort?: string }

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const cat = (['performance', 'consistency', 'followed'].includes(sp.cat ?? '') ? sp.cat : 'performance') as string
  const period = (['week', 'month', 'all'].includes(sp.period ?? '') ? sp.period : 'week') as Period
  const sort = (['pnl', 'winRate', 'avgR', 'trades'].includes(sp.sort ?? '') ? sp.sort : 'pnl') as PerfSort

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Viewer's all-time rank (rank card).
  const allTime = await getPerformanceRanking(supabase, 'all')
  const viewerRank = allTime.find((e) => e.userId === user.id)?.rank ?? null

  let rows: BoardRow[] = []
  if (cat === 'performance') {
    const entries = await getPerformanceRanking(supabase, period, sort)
    const cap = maxAbs(entries.map((e) => e.pnl))
    rows = entries.map((e) => ({
      rank: e.rank, userId: e.userId, username: e.username, displayName: e.displayName, avatarUrl: e.avatarUrl,
      headline: fmtPnl(e.pnl), barPct: Math.round((Math.abs(e.pnl) / cap) * 100),
      winRate: e.winRate, avgR: e.avgR, trades: e.trades,
    }))
  } else if (cat === 'consistency') {
    const cutoff = windowStart(period, Date.now())
    let q = supabase.from('trades').select('user_id, traded_at').eq('is_public', true).eq('status', 'closed')
    if (cutoff) q = q.gte('traded_at', cutoff)
    const { data: trs } = await q
    const ranked = rankConsistency((trs ?? []) as { user_id: string }[])
    rows = await joinProfiles(supabase, ranked, (n) => `${n} trades`)
  } else {
    const { data: follows } = await supabase.from('follows').select('following_id')
    const ranked = rankFollowers((follows ?? []) as { following_id: string }[])
    rows = await joinProfiles(supabase, ranked, (n) => `${n} followers`)
  }

  const top3 = rows.slice(0, 3)

  return (
    <main className="ts-page ts-feed">
      <div className="ts-feed-main">
        <header className="ts-lbhead">
          <h1 className="ts-h1">Leaderboard</h1>
          <p className="muted">Top traders ranked by performance, consistency, and following — updated live.</p>
        </header>
        <LeaderboardTabs active={cat} />
        <LeaderboardControls cat={cat} period={period} sort={sort} />
        <Podium top={top3} viewerId={user.id} />
        <LeaderboardTable rows={rows} viewerId={user.id} />
      </div>
      <aside className="ts-feed-side">
        <RankCard rank={viewerRank} total={allTime.length} />
        <div className="ts-card ts-railcard">
          <div className="ts-rail-head"><h2 className="ts-h2">Daily quests</h2><span className="ts-soon">soon</span></div>
          <p className="faint mt-3" style={{ fontSize: 13 }}>Quests arrive with the XP phase.</p>
        </div>
        <div className="ts-card ts-railcard">
          <div className="ts-rail-head"><h2 className="ts-h2">Top movers</h2><span className="ts-soon">soon</span></div>
          <p className="faint mt-3" style={{ fontSize: 13 }}>Biggest weekly climbers, coming soon.</p>
        </div>
      </aside>
    </main>
  )
}

// Shared profile join for the count-based categories (consistency, followed).
// `ranked` arrives sorted desc by count. We filter to visible profiles FIRST, then
// re-derive dense ranks over the visible set so hidden users never create rank gaps
// (matching the performance path) — keeping every surface gapless.
async function joinProfiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ranked: { userId: string; count: number; rank: number }[],
  headline: (count: number) => string,
): Promise<BoardRow[]> {
  if (ranked.length === 0) return []
  const { data: profs } = await supabase
    .from('profiles').select('id, username, display_name, avatar_url')
    .in('id', ranked.map((r) => r.userId)).eq('is_public', true).eq('onboarding_completed', true)
  const pmap = new Map((profs ?? []).map((p) => [p.id, p]))
  const visible = ranked.filter((r) => pmap.has(r.userId))
  const cap = Math.max(1, visible[0]?.count ?? 1)
  let rank = 0
  let prev: number | null = null
  return visible.map((r) => {
    if (prev === null || r.count !== prev) { rank += 1; prev = r.count } // dense rank over visible only
    const p = pmap.get(r.userId)!
    return {
      rank, userId: r.userId, username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url,
      headline: headline(r.count), barPct: Math.round((r.count / cap) * 100),
      winRate: null, avgR: null, trades: r.count,
    }
  })
}
