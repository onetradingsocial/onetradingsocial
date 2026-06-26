'use client'

import type { ConversationListItem } from '@/lib/messaging'

export function ConversationRow({
  item, active, onClick,
}: {
  item: ConversationListItem
  active: boolean
  onClick: () => void
}) {
  const name = item.other.displayName || item.other.username
  return (
    <button type="button" className={`ts-msg-row${active ? ' ts-msg-row-active' : ''}`} onClick={onClick}>
      <span className="ts-msg-avatar">
        {item.other.avatarUrl
          ? <img src={item.other.avatarUrl} alt="" width={40} height={40} style={{ borderRadius: '50%' }} />
          : <span className="ts-msg-avatar-initial">{name.charAt(0).toUpperCase()}</span>}
      </span>
      <span className="ts-msg-row-body">
        <span className="ts-msg-row-top">
          <span className="ts-msg-row-name">{name}</span>
          {item.unreadCount > 0 && <span className="ts-notif-badge">{item.unreadCount > 99 ? '99+' : item.unreadCount}</span>}
        </span>
        <span className="ts-msg-row-preview">{item.preview || 'No messages yet'}</span>
      </span>
    </button>
  )
}
