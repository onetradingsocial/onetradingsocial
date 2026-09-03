'use client'

/* eslint-disable @next/next/no-img-element --
 * User-supplied images (Supabase storage, Google avatars) whose display size
 * comes entirely from CSS — percentages, a dynamic size prop, or viewport
 * units. next/image needs fixed dimensions or fill plus a positioned wrapper,
 * so converting is a layout change, and it routes every avatar through the
 * metered Vercel optimiser. Revisit if these ever show up as an LCP problem.
 */

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
