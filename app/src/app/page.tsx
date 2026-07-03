import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { assembleFeed, boostFavorites, tally } from '@/lib/feed'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { type FeedItem, type Attachment } from './feed/_components/PostCard'
import { type TradeCard } from './feed/_components/attachments/TradeAttachment'
import { type AttachmentType } from '@/app/actions/social'
import { type FeedTabItem } from './feed/_components/FeedTabs'
import { getPerformanceRanking } from '@/lib/server/ranking'
import { getUserXp } from '@/lib/server/xp'
import { HomeArena } from './feed/_components/home/HomeArena'
import { type HomeData } from './feed/_components/home/types'

const EMPTY = ['00000000-0000-0000-0000-000000000000']
const SELECT = 'id, body, created_at, author_id, attachment_type, trade_id, author:profiles!posts_author_id_fkey(id, username, display_name, avatar_url)'

type RawAuthor = { id: string; username: string; display_name: string | null; avatar_url: string | null }
type RawPost = { id: string; body: string; created_at: string; author_id: string; attachment_type: AttachmentType; trade_id: string | null; author: RawAuthor | RawAuthor[] }

export default async function Home() {
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
  ] = await Promise.all([
    supabase.from('profiles').select('username, display_name, avatar_url, onboarding_completed').eq('id', user.id).single(),
    getPerformanceRanking(supabase, 'week'),
    getUserXp(supabase, user.id),
    supabase.from('follows').select('following_id').eq('follower_id', user.id),
    supabase.from('trades')
      .select('id, instrument, market, setup_type, status, outcome, r_multiple, pnl_amount, traded_at')
      .eq('user_id', user.id).order('traded_at', { ascending: false }),
    supabase.from('favorites').select('favorite_id').eq('user_id', user.id),
  ])
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
  const { data: primaryRaw } = await supabase.from('posts').select(SELECT)
    .in('author_id', authorIds).order('created_at', { ascending: false }).limit(30)
  let fallbackRaw: RawPost[] = []
  if ((primaryRaw?.length ?? 0) < 5) {
    const { data } = await supabase.from('posts').select(SELECT).order('created_at', { ascending: false }).limit(30)
    fallbackRaw = (data ?? []) as RawPost[]
  }
  const merged = boostFavorites(assembleFeed((primaryRaw ?? []) as RawPost[], fallbackRaw, 30), favoriteSet)
  const postIds = merged.map((p) => p.id)
  const idFilter = postIds.length ? postIds : EMPTY

  const [{ data: likeRows }, { data: myLikes }, { data: commentRows }] = await Promise.all([
    supabase.from('likes').select('post_id').in('post_id', idFilter),
    supabase.from('likes').select('post_id').eq('user_id', user.id).in('post_id', idFilter),
    supabase.from('comments').select('post_id').in('post_id', idFilter),
  ])
  const likeCount = tally(likeRows, 'post_id')
  const commentCount = tally(commentRows, 'post_id')
  const myLikeSet = new Set((myLikes ?? []).map((r) => r.post_id))

  const tradeIds = merged.filter((p) => p.attachment_type === 'trade' && p.trade_id).map((p) => p.trade_id as string)
  const imagePostIds = merged.filter((p) => p.attachment_type === 'images').map((p) => p.id)
  const pollPostIds = merged.filter((p) => p.attachment_type === 'poll').map((p) => p.id)
  const F = (a: string[]) => (a.length ? a : EMPTY)

  const [{ data: tradeRowsAtt }, { data: imgRows }, { data: optRows }, { data: voteRows }, { data: myVoteRows }] = await Promise.all([
    supabase.from('trades').select('id, instrument, direction, entry_price, stop_price, target_price, exit_price, r_multiple, pnl_amount, realized_pips, status, screenshot_url, setup_type, strategy_tags').in('id', F(tradeIds)),
    supabase.from('post_images').select('post_id, url, ord').in('post_id', F(imagePostIds)).order('ord', { ascending: true }),
    supabase.from('poll_options').select('id, post_id, label, ord').in('post_id', F(pollPostIds)).order('ord', { ascending: true }),
    supabase.from('poll_votes').select('post_id, option_id').in('post_id', F(pollPostIds)),
    supabase.from('poll_votes').select('post_id, option_id').eq('user_id', user.id).in('post_id', F(pollPostIds)),
  ])
  const tradeById = new Map((tradeRowsAtt ?? []).map((t) => [t.id, t as unknown as TradeCard]))
  const imagesByPost = new Map<string, string[]>()
  for (const r of imgRows ?? []) imagesByPost.set(r.post_id, [...(imagesByPost.get(r.post_id) ?? []), r.url])
  const optionsByPost = new Map<string, { id: string; label: string }[]>()
  for (const r of optRows ?? []) optionsByPost.set(r.post_id, [...(optionsByPost.get(r.post_id) ?? []), { id: r.id, label: r.label }])
  const votesByPost = new Map<string, { option_id: string }[]>()
  for (const r of voteRows ?? []) votesByPost.set(r.post_id, [...(votesByPost.get(r.post_id) ?? []), { option_id: r.option_id }])
  const myVoteByPost = new Map((myVoteRows ?? []).map((r) => [r.post_id, r.option_id]))

  function attachmentFor(p: { id: string; attachment_type: AttachmentType; trade_id: string | null }): Attachment {
    if (p.attachment_type === 'trade' && p.trade_id) {
      const t = tradeById.get(p.trade_id)
      if (t) return { type: 'trade', trade: t }
    }
    if (p.attachment_type === 'images') return { type: 'images', images: imagesByPost.get(p.id) ?? [] }
    if (p.attachment_type === 'poll') return { type: 'poll', options: optionsByPost.get(p.id) ?? [], votes: votesByPost.get(p.id) ?? [], myVote: myVoteByPost.get(p.id) ?? null }
    return { type: 'none' }
  }

  const items: FeedTabItem[] = merged.flatMap((p) => {
    const author = (Array.isArray(p.author) ? p.author[0] : p.author)
    if (!author) return []   // skip posts whose author profile is missing/unreadable
    const base: FeedItem = {
      id: p.id, body: p.body, created_at: p.created_at, author,
      likeCount: likeCount[p.id] ?? 0, commentCount: commentCount[p.id] ?? 0,
      viewerLiked: myLikeSet.has(p.id), isOwn: author.id === user.id,
      attachment: attachmentFor(p),
    }
    return [{ ...base, fromFollowed: author.id === user.id || followingSet.has(author.id), fromFavorite: favoriteSet.has(author.id) }]
  })

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
    followingIds,
    series: { equity: eqSeries, winRate: wrSeries, avgRr: rrSeries, count: cntSeries },
  }

  return <HomeArena data={data} />
}
