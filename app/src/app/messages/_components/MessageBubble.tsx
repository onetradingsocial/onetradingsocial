'use client'

import type { Message } from '@/lib/messaging'
import { clock } from './format'

export function MessageBubble({ message, mine, showSeen }: { message: Message; mine: boolean; showSeen: boolean }) {
  const images = message.attachments.filter((a) => a.type === 'image')
  const time = clock(message.createdAt)
  return (
    <div className={`ts-msg-bubble-row${mine ? ' ts-msg-bubble-mine' : ''}`}>
      <div className={`ts-msg-bubble${mine ? ' ts-msg-bubble-out' : ' ts-msg-bubble-in'}`}>
        {message.deletedAt
          ? <span className="ts-msg-deleted faint">Message deleted</span>
          : <>
              {images.length > 0 && (
                <div className={`ts-msg-images ts-msg-images-${Math.min(images.length, 4)}`}>
                  {images.map((img, i) => img.type === 'image' && <img key={i} src={img.url} alt="" className="ts-msg-image" />)}
                </div>
              )}
              {message.attachments.some((a) => a.type === 'trade') && (
                <div className="ts-msg-trade-chip">📈 Shared a trade</div>
              )}
              {message.body && <span className="ts-msg-text">{message.body}</span>}
            </>}
      </div>
      <span className="ts-msg-meta">
        {time && <span className="ts-msg-time">{time}</span>}
        {showSeen && <span className="ts-msg-seen">Seen</span>}
      </span>
    </div>
  )
}
