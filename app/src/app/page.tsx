import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { assembleFeed, boostFavorites } from '@/lib/feed'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { FEED_POST_SELECT, hydrateFeedPosts, type RawPost } from '@/lib/server/feed-hydration'
import { getPerformanceRanking } from '@/lib/server/ranking'
import { getUserXp } from '@/lib/server/xp'
import { getTier } from '@/lib/server/entitlements'
import { canFlag } from '@/lib/feature-flags'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { HomeArena } from './feed/_components/home/HomeArena'
import { type HomeData } from './feed/_components/home/types'
import { RedditPixel } from './_components/RedditPixel'
import { MetaPixel } from './_components/MetaPixel'
import { OnboardingChecklist, type ChecklistItem } from './_components/OnboardingChecklist'
import { MicroSurvey } from './_components/MicroSurvey'
import { createServiceClient } from '@/lib/supabase/service'

const FEED_INITIAL_LIMIT = 30

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ signup?: string; cid?: string }>
}) {
  const sp = await searchParams
  const justSignedUp = sp.signup === '1'
  const conversionId = sp.cid
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  // Stage A — everything keyed only on the viewer. These are mutually
  // independent, so run them as one parallel batch rather than a serial
  // waterfall of remote round-trips. (week board: rail/race; all-time: viewer rank.)
  const [
    { data: profile },
    weekBoard,
    xp,
    { data: follows },
    { data: ownTradeRows },
    { data: favRows },
    tier,
    flags,
  ] = await Promise.all([
    supabase.from('profiles').select('username, display_name, avatar_url, onboarding_completed, main_markets, created_at').eq('id', user.id).single(),
    getPerformanceRanking(supabase, 'week'),
    getUserXp(supabase, user.id),
    supabase.from('follows').select('following_id').eq('follower_id', user.id),
    supabase.from('trades')
      .select('id, instrument, market, setup_type, status, outcome, r_multiple, pnl_amount, traded_at, strategy_tags')
      .eq('user_id', user.id).order('traded_at', { ascending: false }),
    supabase.from('favorites').select('favorite_id').eq('user_id', user.id),
    getTier(supabase, user.id),
    getFeatureFlags(),
  ])
  const advancedStats = canFlag(flags, tier, 'advanced_stats')
  // Funnel guard: anyone who hasn't finished onboarding resumes it here.
  // Middleware also enforces this, but a null profile read there fails open,
  // so the home route (where login lands) gates deterministically too.
  if (!profile?.onboarding_completed) redirect('/onboarding')
  const name = profile?.display_name || profile?.username || 'trader'
  const viewerRank = weekBoard.find((e) => e.userId === user.id)?.rank ?? null
  const weekLeaders = weekBoard.slice(0, 5).map((e) => ({
    rank: e.rank, userId: e.userId, username: e.username, displayName: e.displayName,
    avatarUrl: e.avatarUrl, pnl: e.pnl, winRate: e.winRate, trades: e.trades,
  }))
  const followingIds = (follows ?? []).map((f) => f.following_id)
  const followingSet = new Set(followingIds)
  const authorIds = [user.id, ...followingIds]
  const favoriteSet = new Set((favRows ?? []).map((f) => f.favorite_id))

  // Stage B — posts keyed on the follow graph.
  const { data: primaryRaw } = await supabase.from('posts').select(FEED_POST_SELECT)
    .in('author_id', authorIds).order('created_at', { ascending: false }).limit(FEED_INITIAL_LIMIT)
  let fallbackRaw: RawPost[] = []
  if ((primaryRaw?.length ?? 0) < 5) {
    const { data } = await supabase.from('posts').select(FEED_POST_SELECT).order('created_at', { ascending: false }).limit(FEED_INITIAL_LIMIT)
    fallbackRaw = (data ?? []) as RawPost[]
  }
  const merged = boostFavorites(assembleFeed((primaryRaw ?? []) as RawPost[], fallbackRaw, FEED_INITIAL_LIMIT), favoriteSet)
  const items = await hydrateFeedPosts(supabase, user.id, merged, followingSet, favoriteSet)

  // Performance (own trades) — fetched in Stage A.
  const trades = ownTradeRows ?? []
  const recentTrades = trades.slice(0, 4).map((t) => ({
    id: t.id, instrument: t.instrument, market: t.market,
    label: t.setup_type || (t.status === 'open' ? 'Open position' : 'Closed trade'),
    pnl: t.pnl_amount, status: t.status,
  }))
  const metrics = computeMetrics(trades.map((t): TradeForMetrics => ({
    status: t.status as 'open' | 'closed', outcome: t.outcome as TradeForMetrics['outcome'],
    rMultiple: t.r_multiple, pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: [],
  })))
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const loggedToday = trades.filter((t) => Date.parse(t.traded_at) >= todayStart.getTime()).length

  // Real sparkline series, oldest→newest closed trades.
  const closed = trades
    .filter((t) => t.status === 'closed' && t.r_multiple != null)
    .sort((a, b) => a.traded_at.localeCompare(b.traded_at))
  let cumPnl = 0, cumR = 0, cumWins = 0
  const eqSeries: number[] = [], wrSeries: number[] = [], rrSeries: number[] = [], cntSeries: number[] = []
  closed.forEach((t, i) => {
    cumPnl += t.pnl_amount ?? 0
    cumR += t.r_multiple as number
    if ((t.r_multiple as number) > 0) cumWins += 1
    eqSeries.push(cumPnl)
    wrSeries.push(cumWins / (i + 1))
    rrSeries.push(cumR / (i + 1))
    cntSeries.push(i + 1)
  })

  const data: HomeData = {
    userId: user.id,
    name,
    handle: profile?.username ? `@${profile.username}` : '@trader',
    selfAvatar: profile?.avatar_url ?? null,
    level: xp.level.level,
    xp: xp.totalXp,
    streak: metrics.currentStreak,
    viewerRank,
    totalRanked: weekBoard.length,
    loggedToday,
    tradeCount: trades.length,
    metrics: {
      winRate: metrics.winRate, avgRr: metrics.avgRr, netPnl: metrics.netPnl,
      total: metrics.total, open: metrics.open, currentStreak: metrics.currentStreak,
    },
    weekLeaders,
    recentTrades,
    quests: xp.daily.map((q) => ({ id: q.id, label: q.label, current: q.current, target: q.target, done: q.done })),
    feedItems: items,
    feedHasMore: merged.length >= FEED_INITIAL_LIMIT,
    followingIds,
    series: { equity: eqSeries, winRate: wrSeries, avgRr: rrSeries, count: cntSeries },
    advancedStats,
  }

  // Onboarding checklist (row 14): computed from real data, shown until done.
  const [{ count: lessonCount }, { count: reviewViews }] = await Promise.all([
    supabase.from('lesson_completions').select('lesson_id', { count: 'exact', head: true }).eq('user_id', user.id),
    createServiceClient().from('analytics_events').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('event', 'weekly_review_viewed'),
  ])
  const checklist: ChecklistItem[] = [
    { key: 'photo', label: 'Add a profile photo', done: !!profile?.avatar_url, href: '/settings' },
    { key: 'markets', label: 'Pick your markets', done: (profile?.main_markets ?? []).length > 0, href: '/settings' },
    { key: 'trade', label: 'Log or import your first trade', done: trades.length > 0, href: '/journal' },
    { key: 'strategy', label: 'Tag your first strategy', done: trades.some((t) => (t.strategy_tags ?? []).length > 0 || t.setup_type), href: '/journal' },
    { key: 'review', label: 'Read your weekly review', done: (reviewViews ?? 0) > 0, href: '/journal' },
    { key: 'follows', label: 'Follow 3 traders', done: followingIds.length >= 3, href: '/leaderboard' },
    { key: 'lesson', label: 'Finish your first lesson', done: (lessonCount ?? 0) > 0, href: '/learn' },
  ]

  const dayOld = profile?.created_at ? (Date.now() - Date.parse(profile.created_at)) / 864e5 : 0

  return (
    <>
      <OnboardingChecklist items={checklist} />
      {dayOld >= 7 && (
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <MicroSurvey
            surveyKey="day_7"
            question="What's stopping you from using TradingSocial more often?"
            options={['Nothing — I use it daily', 'Takes too long to log trades', 'Missing a feature I need', 'Not sure what it does for me']}
          />
        </div>
      )}
      <HomeArena data={data} />
      {justSignedUp && (
        // MetaPixel must render before RedditPixel: both gate on ?signup=1 and
        // effects run in document order — RedditPixel strips the param when done.
        <MetaPixel
          event="CompleteRegistration"
          email={user.email}
          externalId={user.id}
          requireParam="signup"
        />
      )}
      {justSignedUp && (
        <RedditPixel
          event="SignUp"
          email={user.email}
          externalId={user.id}
          conversionId={conversionId}
          requireParam="signup"
        />
      )}
    </>
  )
}
