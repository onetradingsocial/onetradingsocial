'use client'

import { useEffect, useRef } from 'react'
import { useConversation } from '@/app/hooks/useConversation'
import { useTyping } from '@/app/hooks/useTyping'
import type { Message } from '@/lib/messaging'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import { TypingIndicator } from './TypingIndicator'

type PeerLite = { id: string; username: string; displayName: string | null; avatarUrl: string | null }

export function MessageThread({
  currentUserId, conversationId, peer, initialMessages,
}: {
  currentUserId: string
  conversationId: string | null
  peer: PeerLite
  initialMessages: Message[]
}) {
  const { messages, send } = useConversation(conversationId ?? '', currentUserId, initialMessages)
  const { peerTyping, notifyTyping } = useTyping(conversationId ?? '', currentUserId)
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length, peerTyping])

  const lastMineIdx = messages.reduceRight<number>((found, m, i) => (found !== -1 ? found : (m.senderId === currentUserId ? i : -1)), -1)

  const name = peer.displayName || peer.username
  return (
    <div className="ts-msg-thread">
      <header className="ts-msg-thread-head">
        <span className="ts-msg-avatar">
          {peer.avatarUrl
            ? <img src={peer.avatarUrl} alt="" width={36} height={36} style={{ borderRadius: '50%' }} />
            : <span className="ts-msg-avatar-initial">{name.charAt(0).toUpperCase()}</span>}
        </span>
        <a href={`/${peer.username}`} className="ts-msg-thread-name">{name}</a>
      </header>

      <div className="ts-msg-scroll">
        {messages.map((m, i) => {
          const mine = m.senderId === currentUserId
          const isLastMine = mine && i === lastMineIdx
          return (
            <MessageBubble key={m.id} message={m} mine={mine} showSeen={isLastMine && !!m.readAt} />
          )
        })}
        {peerTyping && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      <MessageComposer
        recipientId={peer.id}
        disabled={false}
        onTyping={notifyTyping}
        onSend={(body, attachments) => send(body, attachments, peer.id)}
      />
    </div>
  )
}
