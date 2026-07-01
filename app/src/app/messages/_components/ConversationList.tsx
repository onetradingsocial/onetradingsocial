'use client'

import type { ConversationListItem } from '@/lib/messaging'
import { ConversationRow } from './ConversationRow'

export function ConversationList({
  items, activeId, onSelect, searching = false,
}: {
  items: ConversationListItem[]
  activeId: string | null
  onSelect: (item: ConversationListItem) => void
  searching?: boolean
}) {
  if (items.length === 0) {
    return (
      <div className="ts-msg-rail-empty">
        <p className="faint">
          {searching
            ? 'No conversations match your search.'
            : 'No conversations yet. Visit a profile you both follow and tap “Message” to start one.'}
        </p>
      </div>
    )
  }
  return (
    <div className="ts-msg-list">
      {items.map((item) => (
        <ConversationRow
          key={item.conversationId}
          item={item}
          active={item.conversationId === activeId}
          onClick={() => onSelect(item)}
        />
      ))}
    </div>
  )
}
