import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { assembleFeed, tally } from '@/lib/feed'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'
import { type FeedItem } from './feed/_components/PostCard'
import { PostComposer } from './feed/_components/PostComposer'
import { WelcomeHero } from './feed/_components/WelcomeHero'
import { PerformanceRow } from './feed/_components/PerformanceRow'
import { LogTradeBanner } from './feed/_components/LogTradeBanner'
import { FeedTabs, type FeedTabItem } from './feed/_components/FeedTabs'
import { RightRail } from './feed/_components/RightRail'

const EMPTY = ['00000000-0000-0000-0000-000000000000']
const SELECT = 'id, body, created_at, author_id, author:profiles!posts_author_id_fkey(id, username, display_name, avatar_url)'

type RawAuthor = { id: string; username: string; display_name: string | null; avatar_url: string | null }
type RawPost = { id: string; body: string; created_at: string; author_id: string; author: RawAuthor | RawAuthor[] }

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('username, display_name').eq('id', user.id).single()
  const name = profile?.display_name || profile?.username || 'trader'

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

  const items: FeedTabItem[] = merged.map((p) => {
    const author = (Array.isArray(p.author) ? p.author[0] : p.author)
    const base: FeedItem = {
      id: p.id, body: p.body, created_at: p.created_at, author,
      likeCount: likeCount[p.id] ?? 0, commentCount: commentCount[p.id] ?? 0,
      viewerLiked: myLikeSet.has(p.id), isOwn: author.id === user.id,
    }
    return { ...base, fromFollowed: author.id === user.id || followingSet.has(author.id) }
  })

  // Performance (own trades)
  const { data: tradeRows } = await supabase.from('trades')
    .select('status, outcome, r_multiple, pnl_amount, traded_at').eq('user_id', user.id)
  const trades = tradeRows ?? []
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
        <WelcomeHero name={name} streak={metrics.currentStreak} race={suggested.slice(0, 3)} />
        <PerformanceRow metrics={metrics} spark={spark} />
        <LogTradeBanner />
        <PostComposer />
        <FeedTabs items={items} />
      </div>
      <RightRail suggested={suggested} />
    </main>
  )
}
