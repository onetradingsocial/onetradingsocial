'use client'

import { Fragment, useEffect, useRef } from 'react'
import { useConversation } from '@/app/hooks/useConversation'
import { useTyping } from '@/app/hooks/useTyping'
import type { Message } from '@/lib/messaging'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import { TypingIndicator } from './TypingIndicator'
import { dayLabel, isNewDay } from './format'

type PeerLite = { id: string; username: string; displayName: string | null; avatarUrl: string | null }

export function MessageThread({
  currentUserId, conversationId, peer, initialMessages, onBack,
  requestState = null, onAcceptRequest, onDeclineRequest,
}: {
  currentUserId: string
  conversationId: string | null
  peer: PeerLite
  initialMessages: Message[]
  onBack?: () => void
  requestState?: 'incoming' | 'outgoing' | null
  onAcceptRequest?: () => void
  onDeclineRequest?: () => void
}) {
  const { messages, send } = useConversation(conversationId ?? '', currentUserId, initialMessages, {
    suppressRead: requestState === 'incoming',
  })
  const { peerTyping, notifyTyping } = useTyping(conversationId ?? '', currentUserId)
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length, peerTyping])

  const lastMineIdx = messages.reduceRight<number>((found, m, i) => (found !== -1 ? found : (m.senderId === currentUserId ? i : -1)), -1)

  const name = peer.displayName || peer.username
  return (
    <div className="ts-msg-thread">
      <header className="ts-msg-thread-head">
        {onBack && (
          <button type="button" className="ts-msg-back" onClick={onBack} aria-label="Back to conversations">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <span className="ts-msg-avatar ts-msg-avatar-sm">
          {peer.avatarUrl
            ? <img src={peer.avatarUrl} alt="" width={38} height={38} style={{ borderRadius: '50%' }} />
            : <span className="ts-msg-avatar-initial">{name.charAt(0).toUpperCase()}</span>}
        </span>
        <a href={`/${peer.username}`} className="ts-msg-thread-id">
          <span className="ts-msg-thread-name">{name}</span>
          <span className="ts-msg-thread-handle">@{peer.username}</span>
        </a>
      </header>

      <div className="ts-msg-scroll">
        {messages.length === 0 && !peerTyping && (
          <div className="ts-msg-thread-intro faint">
            This is the start of your conversation with {name}.
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.senderId === currentUserId
          const isLastMine = mine && i === lastMineIdx
          const prev = i > 0 ? messages[i - 1] : null
          const newDay = isNewDay(prev?.createdAt ?? null, m.createdAt)
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="ts-msg-day-divider"><span>{dayLabel(m.createdAt)}</span></div>
              )}
              <MessageBubble message={m} mine={mine} showSeen={isLastMine && !!m.readAt} />
            </Fragment>
          )
        })}
        {peerTyping && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {requestState === 'incoming' ? (
        <div className="ts-msg-request-bar">
          <p className="ts-msg-request-text">
            <strong>{name}</strong> wants to send you messages. Accept to start chatting — they won&apos;t
            know you&apos;ve seen this until you do.
          </p>
          <div className="ts-msg-request-actions">
            <button type="button" className="h-btn h-btn-grad" onClick={onAcceptRequest}>Accept</button>
            <button type="button" className="h-btn" onClick={onDeclineRequest}>Decline</button>
          </div>
        </div>
      ) : (
        <>
          {requestState === 'outgoing' && (
            <div className="ts-msg-request-note faint">
              Message request pending — {name} needs to accept before this becomes a conversation.
            </div>
          )}
          <MessageComposer
            recipientId={peer.id}
            disabled={false}
            onTyping={notifyTyping}
            onSend={(body, attachments) => send(body, attachments, peer.id)}
          />
        </>
      )}
    </div>
  )
}
