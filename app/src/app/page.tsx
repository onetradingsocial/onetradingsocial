import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { assembleFeed, tally } from '@/lib/feed'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { type FeedItem, type Attachment } from './feed/_components/PostCard'
import { type TradeCard } from './feed/_components/attachments/TradeAttachment'
import { type AttachmentType } from '@/app/actions/social'
import { PostComposer } from './feed/_components/PostComposer'
import { WelcomeHero } from './feed/_components/WelcomeHero'
import { PerformanceRow } from './feed/_components/PerformanceRow'
import { LogTradeBanner } from './feed/_components/LogTradeBanner'
import { FeedTabs, type FeedTabItem } from './feed/_components/FeedTabs'
import { RightRail } from './feed/_components/RightRail'
import { getPerformanceRanking } from '@/lib/server/ranking'
import { getUserXp } from '@/lib/server/xp'
import { DailyQuests } from './feed/_components/DailyQuests'

const EMPTY = ['00000000-0000-0000-0000-000000000000']
const SELECT = 'id, body, created_at, author_id, attachment_type, trade_id, author:profiles!posts_author_id_fkey(id, username, display_name, avatar_url)'

type RawAuthor = { id: string; username: string; display_name: string | null; avatar_url: string | null }
type RawPost = { id: string; body: string; created_at: string; author_id: string; attachment_type: AttachmentType; trade_id: string | null; author: RawAuthor | RawAuthor[] }

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('username, display_name').eq('id', user.id).single()
  const name = profile?.display_name || profile?.username || 'trader'

  // Leaderboard data (shared helper): week board for rail/race, all-time for the viewer's rank.
  const [weekBoard, allTimeBoard] = await Promise.all([
    getPerformanceRanking(supabase, 'week'),
    getPerformanceRanking(supabase, 'all'),
  ])
  const viewerRank = allTimeBoard.find((e) => e.userId === user.id)?.rank ?? null
  const leaders = weekBoard.slice(0, 5).map((e) => ({ rank: e.rank, username: e.username, display_name: e.displayName, avatar_url: e.avatarUrl, pnl: e.pnl }))
  const xp = await getUserXp(supabase, user.id)

  // Follows
  const { data: follows } = await supabase.from('follows').select('following_id').eq('follower_id', user.id)
  const followingIds = (follows ?? []).map((f) => f.following_id)
  const followingSet = new Set(followingIds)
  const authorIds = [user.id, ...followingIds]

  // Posts (followed + self, then fallback)
  const { data: primaryRaw } = await supabase.from('posts').select(SELECT)
    .in('author_id', authorIds).order('created_at', { ascending: false }).limit(30)
  let fallbackRaw: RawPost[] = []
  if ((primaryRaw?.length ?? 0) < 5) {
    const { data } = await supabase.from('posts').select(SELECT).order('created_at', { ascending: false }).limit(30)
    fallbackRaw = (data ?? []) as RawPost[]
  }
  const merged = assembleFeed((primaryRaw ?? []) as RawPost[], fallbackRaw, 30)
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

  const items: FeedTabItem[] = merged.map((p) => {
    const author = (Array.isArray(p.author) ? p.author[0] : p.author)
    const base: FeedItem = {
      id: p.id, body: p.body, created_at: p.created_at, author,
      likeCount: likeCount[p.id] ?? 0, commentCount: commentCount[p.id] ?? 0,
      viewerLiked: myLikeSet.has(p.id), isOwn: author.id === user.id,
      attachment: attachmentFor(p),
    }
    return { ...base, fromFollowed: author.id === user.id || followingSet.has(author.id) }
  })

  // Performance (own trades)
  const { data: tradeRows } = await supabase.from('trades')
    .select('id, instrument, market, setup_type, status, outcome, r_multiple, pnl_amount, traded_at')
    .eq('user_id', user.id).order('traded_at', { ascending: false })
  const trades = tradeRows ?? []
  const recentTrades = trades.slice(0, 4).map((t) => ({
    id: t.id, instrument: t.instrument, market: t.market,
    label: t.setup_type || (t.status === 'open' ? 'Open position' : 'Closed trade'),
    pnl: t.pnl_amount, status: t.status,
  }))
  const metrics = computeMetrics(trades.map((t): TradeForMetrics => ({
    status: t.status as 'open' | 'closed', outcome: t.outcome as TradeForMetrics['outcome'],
    rMultiple: t.r_multiple, pnlAmount: t.pnl_amount, tradedAt: t.traded_at, mistakeTags: [],
  })))
  let eq = 0
  const spark = trades.filter((t) => t.status === 'closed')
    .sort((a, b) => a.traded_at.localeCompare(b.traded_at))
    .map((t) => { eq += t.pnl_amount ?? 0; return eq })

  // Suggested traders
  let suggested: RawAuthor[] = []
  if (followingIds.length < 5) {
    const { data: sug } = await supabase.from('profiles')
      .select('id, username, display_name, avatar_url')
      .eq('is_public', true).eq('onboarding_completed', true).neq('id', user.id)
      .order('created_at', { ascending: false }).limit(8)
    suggested = (sug ?? []).filter((s) => !followingSet.has(s.id)).slice(0, 5)
  }

  return (
    <main className="ts-page ts-feed">
      <div className="ts-feed-main">
        <WelcomeHero name={name} streak={metrics.currentStreak} rank={viewerRank} total={allTimeBoard.length} race={leaders.slice(0, 3)} level={xp.level.level} xp={xp.totalXp} />
        <PerformanceRow metrics={metrics} spark={spark} />
        <LogTradeBanner />
        <DailyQuests quests={xp.daily} />
        <PostComposer />
        <FeedTabs items={items} />
      </div>
      <RightRail suggested={suggested} recentTrades={recentTrades} leaders={leaders} />
    </main>
  )
}
