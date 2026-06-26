'use client'

import { useState } from 'react'
import type { ConversationListItem, Message } from '@/lib/messaging'
import { ConversationList } from './_components/ConversationList'
import { MessageThread } from './_components/MessageThread'

type PeerLite = { id: string; username: string; displayName: string | null; avatarUrl: string | null }
type Active = { conversationId: string | null; peer: PeerLite; messages: Message[] }

export function MessagesClient({
  currentUserId, conversations, initialActive, pendingPeer,
}: {
  currentUserId: string
  conversations: ConversationListItem[]
  initialActive: { conversationId: string; peer: PeerLite; messages: Message[] } | null
  pendingPeer: PeerLite | null
}) {
  const [active, setActive] = useState<Active | null>(
    initialActive ?? (pendingPeer ? { conversationId: null, peer: pendingPeer, messages: [] } : null),
  )

  function openConversation(item: ConversationListItem) {
    setActive({ conversationId: item.conversationId, peer: item.other, messages: [] })
  }

  return (
    <div className="ts-msg-shell">
      <aside className="ts-msg-rail">
        <header className="ts-msg-rail-head"><h1 className="ts-h2">Messages</h1></header>
        <ConversationList
          items={conversations}
          activeId={active?.conversationId ?? null}
          onSelect={openConversation}
        />
      </aside>
      <section className="ts-msg-pane">
        {active ? (
          <MessageThread
            key={active.conversationId ?? `pending-${active.peer.id}`}
            currentUserId={currentUserId}
            conversationId={active.conversationId}
            peer={active.peer}
            initialMessages={active.messages}
          />
        ) : (
          <div className="ts-msg-empty-pane">
            <p className="faint">Select a conversation to start messaging.</p>
          </div>
        )}
      </section>
    </div>
  )
}
