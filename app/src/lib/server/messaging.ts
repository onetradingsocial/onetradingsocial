import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { orderPair, summarizePreview, type Attachment, type Message, type ConversationListItem, type ConversationStatus } from '@/lib/messaging'

type ProfileLite = { id: string; username: string; display_name: string | null; avatar_url: string | null }

function normProfile(p: unknown): ProfileLite | null {
  const row = (Array.isArray(p) ? p[0] : p) as ProfileLite | null
  return row ?? null
}

export async function areMutualFollowers(supabase: SupabaseClient, a: string, b: string): Promise<boolean> {
  const { data } = await supabase
    .from('follows')
    .select('follower_id, following_id')
    .or(`and(follower_id.eq.${a},following_id.eq.${b}),and(follower_id.eq.${b},following_id.eq.${a})`)
  const rows = data ?? []
  const aFollowsB = rows.some((r) => r.follower_id === a && r.following_id === b)
  const bFollowsA = rows.some((r) => r.follower_id === b && r.following_id === a)
  return aFollowsB && bFollowsA
}

export type ConversationRow = { id: string; status: ConversationStatus; requesterId: string | null }

// Finds the pair's conversation or creates one. New conversations start
// `accepted` for mutual followers, otherwise `pending` with the sender as
// requester (a message request the recipient must accept).
export async function getOrCreateConversation(
  service: SupabaseClient,
  id1: string,
  id2: string,
  initial: { status: ConversationStatus; requesterId: string },
): Promise<ConversationRow> {
  const { userA, userB } = orderPair(id1, id2)
  const { data: existing } = await service
    .from('conversations').select('id, status, requester_id').eq('user_a', userA).eq('user_b', userB).maybeSingle()
  if (existing) return { id: existing.id as string, status: existing.status as ConversationStatus, requesterId: existing.requester_id ?? null }
  const { data: created, error } = await service
    .from('conversations')
    .insert({ user_a: userA, user_b: userB, status: initial.status, requester_id: initial.requesterId })
    .select('id, status, requester_id').single()
  if (error || !created) {
    // race: another insert won; re-read
    const { data: row } = await service
      .from('conversations').select('id, status, requester_id').eq('user_a', userA).eq('user_b', userB).single()
    return { id: row!.id as string, status: row!.status as ConversationStatus, requesterId: row!.requester_id ?? null }
  }
  return { id: created.id as string, status: created.status as ConversationStatus, requesterId: created.requester_id ?? null }
}

export async function getConversations(supabase: SupabaseClient, userId: string): Promise<ConversationListItem[]> {
  const { data: convos } = await supabase
    .from('conversations')
    .select('id, user_a, user_b, last_message_at, status, requester_id, a:profiles!conversations_user_a_fkey(id,username,display_name,avatar_url), b:profiles!conversations_user_b_fkey(id,username,display_name,avatar_url)')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order('last_message_at', { ascending: false })
    .range(0, 49)
  const list = convos ?? []

  const items: ConversationListItem[] = []
  for (const c of list) {
    const other = c.user_a === userId ? normProfile(c.b) : normProfile(c.a)
    if (!other) continue
    const { data: lastRows } = await supabase
      .from('messages')
      .select('body, attachments, deleted_at')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .range(0, 0)
    const last = lastRows?.[0]
    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', c.id)
      .neq('sender_id', userId)
      .is('read_at', null)
    items.push({
      conversationId: c.id,
      other: { id: other.id, username: other.username, displayName: other.display_name, avatarUrl: other.avatar_url },
      lastMessageAt: c.last_message_at,
      preview: last ? summarizePreview({ body: last.body, attachments: (last.attachments ?? []) as Attachment[], deletedAt: last.deleted_at }) : '',
      unreadCount: count ?? 0,
      status: (c.status ?? 'accepted') as ConversationStatus,
      requesterId: c.requester_id ?? null,
    })
  }
  return items
}

export async function getMessages(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<Message[]> {
  const { before, limit = 50 } = opts
  // participant guard (RLS also enforces, but fail fast + empty)
  const { data: convo } = await supabase
    .from('conversations').select('user_a, user_b').eq('id', conversationId).maybeSingle()
  if (!convo || (convo.user_a !== userId && convo.user_b !== userId)) return []

  let q = supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, attachments, read_at, created_at, deleted_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .range(0, limit - 1)
  if (before) q = q.lt('created_at', before)
  const { data } = await q
  const rows = (data ?? []).map((r): Message => ({
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    body: r.body ?? null,
    attachments: (r.attachments ?? []) as Attachment[],
    readAt: r.read_at ?? null,
    createdAt: r.created_at,
    deletedAt: r.deleted_at ?? null,
  }))
  return rows.reverse() // ascending for display
}

export async function getUnreadTotal(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data: convos, error: cErr } = await supabase
    .from('conversations').select('id, status, requester_id').or(`user_a.eq.${userId},user_b.eq.${userId}`)
  if (cErr || !convos || convos.length === 0) return 0
  // incoming pending requests don't count toward the inbox badge — they
  // surface in the Requests tab instead
  const ids = convos
    .filter((c) => c.status !== 'pending' || c.requester_id === userId)
    .map((c) => c.id)
  if (ids.length === 0) return 0
  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .in('conversation_id', ids)
    .neq('sender_id', userId)
    .is('read_at', null)
  if (error) return 0
  return count ?? 0
}

export async function getConversationPeer(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<{
  id: string; username: string; displayName: string | null; avatarUrl: string | null
  status: ConversationStatus; requesterId: string | null
} | null> {
  const { data: c } = await supabase
    .from('conversations')
    .select('user_a, user_b, status, requester_id, a:profiles!conversations_user_a_fkey(id,username,display_name,avatar_url), b:profiles!conversations_user_b_fkey(id,username,display_name,avatar_url)')
    .eq('id', conversationId).maybeSingle()
  if (!c || (c.user_a !== userId && c.user_b !== userId)) return null
  const other = c.user_a === userId ? normProfile(c.b) : normProfile(c.a)
  if (!other) return null
  return {
    id: other.id, username: other.username, displayName: other.display_name, avatarUrl: other.avatar_url,
    status: (c.status ?? 'accepted') as ConversationStatus, requesterId: c.requester_id ?? null,
  }
}
