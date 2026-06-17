'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type SocialState = { error?: string; ok?: boolean }

export type CommentItem = {
  id: string; body: string; created_at: string; isOwn: boolean
  author: { username: string; display_name: string | null; avatar_url: string | null }
}

export async function createPost(formData: FormData): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const body = String(formData.get('body') ?? '').trim()
  if (!body) return { error: 'Write something first.' }
  if (body.length > 2000) return { error: 'Post is too long (2000 max).' }
  const { error } = await supabase.from('posts').insert({ author_id: user.id, body })
  if (error) { console.error('createPost', error.message); return { error: 'Could not save your post. Try again.' } }
  revalidatePath('/')
  return { ok: true }
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
    return { id: c.id, body: c.body, created_at: c.created_at, isOwn: c.author_id === user?.id, author }
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
