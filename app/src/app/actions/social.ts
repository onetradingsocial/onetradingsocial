'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { insertNotification, extractMentions } from '@/lib/notifications'
import { getUserXp } from '@/lib/server/xp'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'

export type SocialState = { error?: string; ok?: boolean }

const FAVORITE_GATE_ERROR = 'Favouriting traders is available on the Trader plan and above.'

export type CommentItem = {
  id: string; body: string; created_at: string; isOwn: boolean
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null }
}

export type AttachmentType = 'none' | 'trade' | 'images' | 'poll'

export type CreatePostInput = {
  body: string
  attachmentType: AttachmentType
  tradeId?: string | null
  pollOptions?: string[]
}

export async function createPost(input: CreatePostInput): Promise<{ postId?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const body = (input.body ?? '').trim()
  const type = input.attachmentType
  if (!body && type !== 'images' && type !== 'trade') return { error: 'Write something first.' }
  if (body.length > 2000) return { error: 'Post is too long (2000 max).' }

  if (type === 'trade') {
    if (!input.tradeId) return { error: 'No trade selected.' }
    const { data: t } = await supabase.from('trades').select('user_id').eq('id', input.tradeId).single()
    if (!t || t.user_id !== user.id) return { error: 'Trade not found.' }
  }

  let optionLabels: string[] = []
  if (type === 'poll') {
    optionLabels = (input.pollOptions ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 4)
    if (optionLabels.length < 2) return { error: 'A poll needs at least 2 options.' }
    if (optionLabels.some((l) => l.length > 100)) return { error: 'Poll options must be 100 characters or fewer.' }
    if (!body) return { error: 'Add a poll question.' }
  }

  const { data: post, error } = await supabase.from('posts').insert({
    author_id: user.id, body, attachment_type: type,
    trade_id: type === 'trade' ? input.tradeId : null,
  }).select('id').single()
  if (error || !post) return { error: error?.message ?? 'Could not create post.' }

  if (type === 'poll') {
    const { error: optErr } = await supabase.from('poll_options')
      .insert(optionLabels.map((label, ord) => ({ post_id: post.id, label, ord })))
    if (optErr) {
      await supabase.from('posts').delete().eq('id', post.id)
      return { error: 'Could not save the poll. Try again.' }
    }
  }

  const service = createServiceClient()

  // post_share: notify followers only for trade-share posts
  if (type === 'trade') {
    const { data: followers } = await supabase
      .from('follows').select('follower_id').eq('following_id', user.id)
    for (const f of followers ?? []) {
      await insertNotification({ supabase: service, userId: f.follower_id, actorId: user.id, type: 'post_share', entityId: post.id, entityType: 'post' })
    }
  }

  // mention scan for all post types
  const mentionedUsernames = extractMentions(body)
  if (mentionedUsernames.length > 0) {
    const { data: mentionedProfiles } = await supabase
      .from('profiles').select('id').in('username', mentionedUsernames)
    for (const p of mentionedProfiles ?? []) {
      await insertNotification({ supabase: service, userId: p.id, actorId: user.id, type: 'mention', entityId: post.id, entityType: 'post' })
    }
  }

  revalidatePath('/')
  return { postId: post.id }
}

export async function attachPostImages(postId: string, urls: string[]): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const prefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`
  const rows = urls.filter((u) => u.startsWith(prefix)).slice(0, 4).map((url, ord) => ({ post_id: postId, url, ord }))
  if (rows.length === 0) return { error: 'No valid images.' }
  // ownership enforced by RLS (post_images_insert checks post author)
  const { error } = await supabase.from('post_images').insert(rows)
  if (error) return { error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function votePoll(postId: string, optionId: string): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const { data: opt } = await supabase.from('poll_options').select('id').eq('id', optionId).eq('post_id', postId).maybeSingle()
  if (!opt) return { error: 'Invalid option.' }
  await supabase.from('poll_votes').upsert(
    { post_id: postId, user_id: user.id, option_id: optionId },
    { onConflict: 'post_id,user_id' },
  )
  revalidatePath('/')
  return { ok: true }
}

export async function getPickableTrades(): Promise<{ id: string; instrument: string; direction: string; r_multiple: number | null; pnl_amount: number | null; status: string; traded_at: string }[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase.from('trades')
    .select('id, instrument, direction, r_multiple, pnl_amount, status, traded_at')
    .eq('user_id', user.id).order('traded_at', { ascending: false }).limit(20)
  return data ?? []
}

export async function deletePost(postId: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  await supabase.from('posts').delete().eq('id', postId).eq('author_id', user.id)
  revalidatePath('/')
  return { ok: true }
}

export async function toggleLike(postId: string): Promise<{ liked: boolean; count: number } | SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const { data: existing } = await supabase.from('likes')
    .select('post_id').eq('post_id', postId).eq('user_id', user.id).maybeSingle()
  if (existing) {
    await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', user.id)
  } else {
    await supabase.from('likes').upsert(
      { post_id: postId, user_id: user.id },
      { onConflict: 'post_id,user_id', ignoreDuplicates: true },
    )
  }
  // fire notification only when liking (not unliking)
  if (!existing) {
    const { data: post } = await supabase.from('posts').select('author_id').eq('id', postId).maybeSingle()
    if (post?.author_id) {
      const service = createServiceClient()
      await insertNotification({ supabase: service, userId: post.author_id, actorId: user.id, type: 'like', entityId: postId, entityType: 'post' })
    }
  }
  const [{ count }, { data: nowLiked }] = await Promise.all([
    supabase.from('likes').select('*', { count: 'exact', head: true }).eq('post_id', postId),
    supabase.from('likes').select('post_id').eq('post_id', postId).eq('user_id', user.id).maybeSingle(),
  ])
  return { liked: !!nowLiked, count: count ?? 0 }
}

export async function getComments(postId: string): Promise<CommentItem[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase.from('comments')
    .select('id, body, created_at, author_id, author:profiles!comments_author_id_fkey(username, display_name, avatar_url)')
    .eq('post_id', postId).order('created_at', { ascending: true })
  return (data ?? []).map((c) => {
    const author = (Array.isArray(c.author) ? c.author[0] : c.author) as { username: string; display_name: string | null; avatar_url: string | null }
    return { id: c.id, body: c.body, created_at: c.created_at, isOwn: c.author_id === user?.id, author: { id: c.author_id, ...author } }
  })
}

export async function addComment(postId: string, body: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const text = body.trim()
  if (!text) return { error: 'Comment is empty.' }
  if (text.length > 1000) return { error: 'Comment too long.' }
  const { error } = await supabase.from('comments').insert({ post_id: postId, author_id: user.id, body: text })
  if (error) { console.error('addComment', error.message); return { error: 'Could not post your comment. Try again.' } }
  // notify post author
  const { data: post } = await supabase.from('posts').select('author_id').eq('id', postId).maybeSingle()
  const service = createServiceClient()
  if (post?.author_id) {
    await insertNotification({ supabase: service, userId: post.author_id, actorId: user.id, type: 'comment', entityId: postId, entityType: 'post' })
  }
  // notify @mentions
  const mentionedUsernames = extractMentions(text)
  if (mentionedUsernames.length > 0) {
    const { data: mentionedProfiles } = await supabase
      .from('profiles').select('id').in('username', mentionedUsernames)
    for (const p of mentionedProfiles ?? []) {
      await insertNotification({ supabase: service, userId: p.id, actorId: user.id, type: 'mention', entityId: postId, entityType: 'post' })
    }
  }
  return { ok: true }
}

export async function deleteComment(commentId: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  await supabase.from('comments').delete().eq('id', commentId).eq('author_id', user.id)
  return { ok: true }
}

export async function follow(targetId: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (targetId === user.id) return { error: "You can't follow yourself." }
  await supabase.from('follows').upsert(
    { follower_id: user.id, following_id: targetId },
    { onConflict: 'follower_id,following_id', ignoreDuplicates: true },
  )
  const service = createServiceClient()
  await insertNotification({ supabase: service, userId: targetId, actorId: user.id, type: 'follow' })
  revalidatePath('/')
  return { ok: true }
}

export async function unfollow(targetId: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', targetId)
  revalidatePath('/')
  return { ok: true }
}

export async function favorite(targetId: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (targetId === user.id) return { error: "You can't favourite yourself." }
  const tier = await getTier(supabase, user.id)
  if (!canFlag(await getFeatureFlags(), tier, 'saved_traders')) return { error: FAVORITE_GATE_ERROR }
  const { error } = await supabase.from('favorites').upsert(
    { user_id: user.id, favorite_id: targetId },
    { onConflict: 'user_id,favorite_id', ignoreDuplicates: true },
  )
  if (error) { console.error('favorite', error.message); return { error: 'Could not favourite. Try again.' } }
  // Star implies follow. Deliberately no notification for the favourite itself
  // (favourites are private); the follow upsert is silent too to avoid
  // re-notifying users who were already followed.
  await supabase.from('follows').upsert(
    { follower_id: user.id, following_id: targetId },
    { onConflict: 'follower_id,following_id', ignoreDuplicates: true },
  )
  revalidatePath('/')
  return { ok: true }
}

export async function unfavorite(targetId: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  await supabase.from('favorites').delete().eq('user_id', user.id).eq('favorite_id', targetId)
  revalidatePath('/')
  return { ok: true }
}

export type TraderCardData = {
  username: string; displayName: string | null; avatarUrl: string | null
  winRate: number; trades: number; level: number
  viewerFollows: boolean; viewerFavorited: boolean; canFavorite: boolean; isSelf: boolean
}

export async function getTraderCardData(userId: string): Promise<TraderCardData | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const [{ data: profile }, { data: closed }, xp, { data: vf }, { data: vfav }, tier] = await Promise.all([
    supabase.from('profiles').select('username, display_name, avatar_url').eq('id', userId).maybeSingle(),
    supabase.from('trades').select('r_multiple').eq('user_id', userId).eq('is_public', true).eq('status', 'closed'),
    getUserXp(supabase, userId),
    supabase.from('follows').select('follower_id').eq('follower_id', user.id).eq('following_id', userId).maybeSingle(),
    supabase.from('favorites').select('user_id').eq('user_id', user.id).eq('favorite_id', userId).maybeSingle(),
    getTier(supabase, user.id),
  ])
  if (!profile) return null
  const trades = closed ?? []
  const wins = trades.filter((t) => (t.r_multiple ?? 0) > 0).length
  return {
    username: profile.username, displayName: profile.display_name, avatarUrl: profile.avatar_url,
    winRate: trades.length ? wins / trades.length : 0, trades: trades.length, level: xp.level.level,
    viewerFollows: !!vf, viewerFavorited: !!vfav,
    canFavorite: canFlag(await getFeatureFlags(), tier, 'saved_traders'),
    isSelf: userId === user.id,
  }
}
