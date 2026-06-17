import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { assembleFeed, tally } from '@/lib/feed'
import { PostComposer } from './feed/_components/PostComposer'
import { PostCard, type FeedItem } from './feed/_components/PostCard'
import { SuggestedTraders } from './feed/_components/SuggestedTraders'

const EMPTY = ['00000000-0000-0000-0000-000000000000']

type RawPost = {
  id: string; body: string; created_at: string; author_id: string
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null } | { id: string; username: string; display_name: string | null; avatar_url: string | null }[]
}

const SELECT = 'id, body, created_at, author_id, author:profiles!posts_author_id_fkey(id, username, display_name, avatar_url)'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: follows } = await supabase.from('follows').select('following_id').eq('follower_id', user.id)
  const followingIds = (follows ?? []).map((f) => f.following_id)
  const authorIds = [user.id, ...followingIds]

  const { data: primaryRaw } = await supabase.from('posts').select(SELECT)
    .in('author_id', authorIds).order('created_at', { ascending: false }).limit(30)

  let fallbackRaw: RawPost[] = []
  if ((primaryRaw?.length ?? 0) < 5) {
    const { data } = await supabase.from('posts').select(SELECT)
      .order('created_at', { ascending: false }).limit(30)
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

  const items: FeedItem[] = merged.map((p) => {
    const author = (Array.isArray(p.author) ? p.author[0] : p.author)
    return {
      id: p.id, body: p.body, created_at: p.created_at, author,
      likeCount: likeCount[p.id] ?? 0, commentCount: commentCount[p.id] ?? 0,
      viewerLiked: myLikeSet.has(p.id), isOwn: author.id === user.id,
    }
  })

  let suggested: { id: string; username: string; display_name: string | null; avatar_url: string | null }[] = []
  if (followingIds.length < 3) {
    const { data: sug } = await supabase.from('profiles')
      .select('id, username, display_name, avatar_url')
      .eq('is_public', true).eq('onboarding_completed', true).neq('id', user.id)
      .order('created_at', { ascending: false }).limit(8)
    suggested = (sug ?? []).filter((s) => !followingIds.includes(s.id)).slice(0, 5)
  }

  return (
    <main className="ts-page ts-feed">
      <div className="ts-feed-main">
        <PostComposer />
        {items.length === 0
          ? <p className="faint" style={{ textAlign: 'center', padding: 40 }}>No posts yet. Be the first to share.</p>
          : items.map((p) => <PostCard key={p.id} post={p} />)}
      </div>
      <aside className="ts-feed-side">
        <SuggestedTraders traders={suggested} />
      </aside>
    </main>
  )
}
