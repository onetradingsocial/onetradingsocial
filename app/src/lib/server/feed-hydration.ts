import { tally } from '@/lib/feed'
import type { createClient } from '@/lib/supabase/server'
import type { FeedItem, Attachment } from '@/app/feed/_components/PostCard'
import type { TradeCard } from '@/app/feed/_components/attachments/TradeAttachment'
import type { AttachmentType } from '@/app/actions/social'
import type { FeedTabItem } from '@/app/feed/_components/FeedTabs'

type Supabase = Awaited<ReturnType<typeof createClient>>

const EMPTY = ['00000000-0000-0000-0000-000000000000']

export const FEED_POST_SELECT =
  'id, body, created_at, author_id, attachment_type, trade_id, author:profiles!posts_author_id_fkey(id, username, display_name, avatar_url)'

export type RawAuthor = { id: string; username: string; display_name: string | null; avatar_url: string | null }
export type RawPost = {
  id: string
  body: string
  created_at: string
  author_id: string
  attachment_type: AttachmentType
  trade_id: string | null
  author: RawAuthor | RawAuthor[]
}

/**
 * Hydrate raw post rows into fully-populated feed items: like/comment counts,
 * the viewer's own likes, and attachment payloads (trade card, images, poll).
 * Shared between the home page's initial feed and the load-more server action.
 */
export async function hydrateFeedPosts(
  supabase: Supabase,
  viewerId: string,
  posts: RawPost[],
  followingSet: Set<string>,
  favoriteSet: Set<string>,
): Promise<FeedTabItem[]> {
  const postIds = posts.map((p) => p.id)
  const idFilter = postIds.length ? postIds : EMPTY

  const [{ data: likeRows }, { data: myLikes }, { data: commentRows }] = await Promise.all([
    supabase.from('likes').select('post_id').in('post_id', idFilter),
    supabase.from('likes').select('post_id').eq('user_id', viewerId).in('post_id', idFilter),
    supabase.from('comments').select('post_id').in('post_id', idFilter),
  ])
  const likeCount = tally(likeRows, 'post_id')
  const commentCount = tally(commentRows, 'post_id')
  const myLikeSet = new Set((myLikes ?? []).map((r) => r.post_id))

  const tradeIds = posts.filter((p) => p.attachment_type === 'trade' && p.trade_id).map((p) => p.trade_id as string)
  const imagePostIds = posts.filter((p) => p.attachment_type === 'images').map((p) => p.id)
  const pollPostIds = posts.filter((p) => p.attachment_type === 'poll').map((p) => p.id)
  const F = (a: string[]) => (a.length ? a : EMPTY)

  const [{ data: tradeRowsAtt }, { data: imgRows }, { data: optRows }, { data: voteRows }, { data: myVoteRows }] = await Promise.all([
    supabase.from('trades').select('id, instrument, direction, entry_price, stop_price, target_price, exit_price, r_multiple, pnl_amount, realized_pips, status, screenshot_url, setup_type, strategy_tags').in('id', F(tradeIds)),
    supabase.from('post_images').select('post_id, url, ord').in('post_id', F(imagePostIds)).order('ord', { ascending: true }),
    supabase.from('poll_options').select('id, post_id, label, ord').in('post_id', F(pollPostIds)).order('ord', { ascending: true }),
    supabase.from('poll_votes').select('post_id, option_id').in('post_id', F(pollPostIds)),
    supabase.from('poll_votes').select('post_id, option_id').eq('user_id', viewerId).in('post_id', F(pollPostIds)),
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

  return posts.flatMap((p) => {
    const author = (Array.isArray(p.author) ? p.author[0] : p.author)
    if (!author) return []   // skip posts whose author profile is missing/unreadable
    const base: FeedItem = {
      id: p.id, body: p.body, created_at: p.created_at, author,
      likeCount: likeCount[p.id] ?? 0, commentCount: commentCount[p.id] ?? 0,
      viewerLiked: myLikeSet.has(p.id), isOwn: author.id === viewerId,
      attachment: attachmentFor(p),
    }
    return [{ ...base, fromFollowed: author.id === viewerId || followingSet.has(author.id), fromFavorite: favoriteSet.has(author.id) }]
  })
}
