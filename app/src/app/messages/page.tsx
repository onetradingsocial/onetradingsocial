import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import {
  getConversations, getMessages, getConversationPeer,
  getOrCreateConversation, areMutualFollowers,
} from '@/lib/server/messaging'
import { MessagesClient } from './MessagesClient'

export const dynamic = 'force-dynamic'

type PeerLite = { id: string; username: string; displayName: string | null; avatarUrl: string | null }

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; to?: string }>
}) {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const { c, to } = await searchParams
  const conversations = await getConversations(supabase, user.id)

  let activeConversationId: string | null = null
  let pendingPeer: PeerLite | null = null

  if (c) {
    const peer = await getConversationPeer(supabase, c, user.id)
    if (peer) activeConversationId = c
  } else if (to) {
    const { data: target } = await supabase
      .from('profiles').select('id, username, display_name, avatar_url').eq('username', to).maybeSingle()
    if (target && target.id !== user.id) {
      const mutual = await areMutualFollowers(supabase, user.id, target.id)
      if (mutual) {
        // open existing convo if any, else stage a pending (no row until first send)
        const existing = conversations.find((cv) => cv.other.id === target.id)
        if (existing) activeConversationId = existing.conversationId
        else pendingPeer = { id: target.id, username: target.username, displayName: target.display_name, avatarUrl: target.avatar_url }
      }
    }
  }

  let initialActive = null
  if (activeConversationId) {
    const peer = await getConversationPeer(supabase, activeConversationId, user.id)
    const messages = await getMessages(supabase, activeConversationId, user.id)
    if (peer) initialActive = { conversationId: activeConversationId, peer, messages }
  }

  return (
    <main className="ts-msg-page">
      <MessagesClient
        currentUserId={user.id}
        conversations={conversations}
        initialActive={initialActive}
        pendingPeer={pendingPeer}
      />
    </main>
  )
}
