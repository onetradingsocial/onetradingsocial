'use server'

import { createClient } from '@/lib/supabase/server'
import { assembleFeed } from '@/lib/feed'
import { FEED_POST_SELECT, hydrateFeedPosts, type RawPost } from '@/lib/server/feed-hydration'
import type { FeedTabItem } from '@/app/feed/_components/FeedTabs'

const FEED_PAGE_SIZE = 20

export type FeedPage = { items: FeedTabItem[]; hasMore: boolean }

/**
 * Fetch the next page of the home feed: posts strictly older than `cursor`
 * (an ISO created_at timestamp). Mirrors the initial feed's shape — follow
 * graph first, global fallback fill — so scrolling continues seamlessly.
 */
export async function loadOlderFeed(cursor: string): Promise<FeedPage> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { items: [], hasMore: false }
  if (!cursor || Number.isNaN(Date.parse(cursor))) return { items: [], hasMore: false }

  const [{ data: follows }, { data: favRows }] = await Promise.all([
    supabase.from('follows').select('following_id').eq('follower_id', user.id),
    supabase.from('favorites').select('favorite_id').eq('user_id', user.id),
  ])
  const followingIds = (follows ?? []).map((f) => f.following_id)
  const followingSet = new Set(followingIds)
  const favoriteSet = new Set((favRows ?? []).map((f) => f.favorite_id))
  const authorIds = [user.id, ...followingIds]

  // Over-fetch by one to detect whether another page exists.
  const fetchLimit = FEED_PAGE_SIZE + 1
  const { data: primaryRaw } = await supabase.from('posts').select(FEED_POST_SELECT)
    .in('author_id', authorIds).lt('created_at', cursor)
    .order('created_at', { ascending: false }).limit(fetchLimit)
  let fallbackRaw: RawPost[] = []
  if ((primaryRaw?.length ?? 0) < fetchLimit) {
    const { data } = await supabase.from('posts').select(FEED_POST_SELECT)
      .lt('created_at', cursor)
      .order('created_at', { ascending: false }).limit(fetchLimit)
    fallbackRaw = (data ?? []) as RawPost[]
  }
  const merged = assembleFeed((primaryRaw ?? []) as RawPost[], fallbackRaw, fetchLimit)
  const hasMore = merged.length > FEED_PAGE_SIZE
  const page = merged.slice(0, FEED_PAGE_SIZE)

  const items = await hydrateFeedPosts(supabase, user.id, page, followingSet, favoriteSet)
  return { items, hasMore }
}
