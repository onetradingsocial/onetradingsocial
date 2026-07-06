'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ConversationListItem, ConversationStatus, Message } from '@/lib/messaging'
import { acceptMessageRequest, declineMessageRequest } from '@/app/actions/messaging'
import { ConversationList } from './_components/ConversationList'
import { MessageThread } from './_components/MessageThread'

type PeerLite = { id: string; username: string; displayName: string | null; avatarUrl: string | null }
type Active = {
  conversationId: string | null
  peer: PeerLite
  messages: Message[]
  status: ConversationStatus
  requesterId: string | null
}

export function MessagesClient({
  currentUserId, conversations, requests, initialActive, pendingPeer,
}: {
  currentUserId: string
  conversations: ConversationListItem[]
  requests: ConversationListItem[]
  initialActive: {
    conversationId: string; peer: PeerLite; messages: Message[]
    status: ConversationStatus; requesterId: string | null
  } | null
  pendingPeer: PeerLite | null
}) {
  const router = useRouter()
  const [active, setActive] = useState<Active | null>(
    initialActive
      ?? (pendingPeer ? { conversationId: null, peer: pendingPeer, messages: [], status: 'accepted', requesterId: null } : null),
  )
  const [tab, setTab] = useState<'inbox' | 'requests'>(
    initialActive && initialActive.status === 'pending' && initialActive.requesterId !== currentUserId
      ? 'requests'
      : 'inbox',
  )
  const [query, setQuery] = useState('')

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations],
  )

  const source = tab === 'requests' ? requests : conversations
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return source
    return source.filter((c) => {
      const name = (c.other.displayName || c.other.username).toLowerCase()
      return name.includes(q) || c.other.username.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)
    })
  }, [source, query])

  function openConversation(item: ConversationListItem) {
    setActive({
      conversationId: item.conversationId, peer: item.other, messages: [],
      status: item.status, requesterId: item.requesterId,
    })
  }

  async function handleAccept() {
    if (!active?.conversationId) return
    const res = await acceptMessageRequest(active.conversationId)
    if (!res.error) {
      setActive((prev) => (prev ? { ...prev, status: 'accepted' } : prev))
      setTab('inbox')
      router.refresh()
    }
  }

  async function handleDecline() {
    if (!active?.conversationId) return
    const res = await declineMessageRequest(active.conversationId)
    if (!res.error) {
      setActive(null)
      router.refresh()
    }
  }

  const requestState = active && active.status === 'pending'
    ? (active.requesterId === currentUserId ? 'outgoing' as const : 'incoming' as const)
    : null

  return (
    <div className={`ts-msg-shell${active ? ' ts-msg-shell-thread' : ''}`}>
      <aside className="ts-msg-rail">
        <header className="ts-msg-rail-head">
          <div className="ts-msg-rail-title">
            <h1 className="ts-h2">Messages</h1>
            {totalUnread > 0 && <span className="ts-notif-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
          </div>
          <div className="ts-msg-search">
            <svg className="ts-msg-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              className="ts-msg-search-input"
              type="search"
              placeholder="Search conversations"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search conversations"
            />
          </div>
          <div className="ts-msg-tabs" role="tablist" aria-label="Message folders">
            <button
              type="button" role="tab" aria-selected={tab === 'inbox'}
              className={`ts-msg-tab${tab === 'inbox' ? ' ts-msg-tab-active' : ''}`}
              onClick={() => setTab('inbox')}
            >
              Inbox
            </button>
            <button
              type="button" role="tab" aria-selected={tab === 'requests'}
              className={`ts-msg-tab${tab === 'requests' ? ' ts-msg-tab-active' : ''}`}
              onClick={() => setTab('requests')}
            >
              Requests
              {requests.length > 0 && <span className="ts-notif-badge">{requests.length > 99 ? '99+' : requests.length}</span>}
            </button>
          </div>
        </header>
        <ConversationList
          items={filtered}
          activeId={active?.conversationId ?? null}
          onSelect={openConversation}
          searching={query.trim().length > 0}
          variant={tab}
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
            onBack={() => setActive(null)}
            requestState={requestState}
            onAcceptRequest={handleAccept}
            onDeclineRequest={handleDecline}
          />
        ) : (
          <div className="ts-msg-empty-pane">
            <div className="ts-msg-empty-art" aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v8A1.5 1.5 0 0 1 18.5 15H9l-4 4v-4H5.5A1.5 1.5 0 0 1 4 13.5v-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="ts-msg-empty-title">Your messages</h2>
            <p className="faint">Pick a conversation to start chatting.</p>
          </div>
        )}
      </section>
    </div>
  )
}
