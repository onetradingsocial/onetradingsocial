'use client'

/* eslint-disable @next/next/no-img-element --
 * User-supplied images (Supabase storage, Google avatars) whose display size
 * comes entirely from CSS — percentages, a dynamic size prop, or viewport
 * units. next/image needs fixed dimensions or fill plus a positioned wrapper,
 * so converting is a layout change, and it routes every avatar through the
 * metered Vercel optimiser. Revisit if these ever show up as an LCP problem.
 */

import type { ConversationListItem } from '@/lib/messaging'
import { shortWhen } from './format'

export function ConversationRow({
  item, active, onClick,
}: {
  item: ConversationListItem
  active: boolean
  onClick: () => void
}) {
  const name = item.other.displayName || item.other.username
  const unread = item.unreadCount > 0
  return (
    <button
      type="button"
      className={`ts-msg-row${active ? ' ts-msg-row-active' : ''}${unread ? ' ts-msg-row-unread' : ''}`}
      onClick={onClick}
    >
      <span className="ts-msg-avatar">
        {item.other.avatarUrl
          ? <img src={item.other.avatarUrl} alt="" width={44} height={44} style={{ borderRadius: '50%' }} />
          : <span className="ts-msg-avatar-initial">{name.charAt(0).toUpperCase()}</span>}
      </span>
      <span className="ts-msg-row-body">
        <span className="ts-msg-row-top">
          <span className="ts-msg-row-name">{name}</span>
          <span className="ts-msg-row-time">{shortWhen(item.lastMessageAt)}</span>
        </span>
        <span className="ts-msg-row-bottom">
          <span className="ts-msg-row-preview">{item.preview || 'No messages yet'}</span>
          {unread && <span className="ts-notif-badge">{item.unreadCount > 99 ? '99+' : item.unreadCount}</span>}
        </span>
      </span>
    </button>
  )
}
