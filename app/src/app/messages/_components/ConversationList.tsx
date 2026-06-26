'use client'

import type { ConversationListItem } from '@/lib/messaging'
import { ConversationRow } from './ConversationRow'

export function ConversationList({
  items, activeId, onSelect,
}: {
  items: ConversationListItem[]
  activeId: string | null
  onSelect: (item: ConversationListItem) => void
}) {
  if (items.length === 0) {
    return <p className="ts-msg-rail-empty faint">No conversations yet. Visit a profile you both follow and tap &quot;Message&quot;.</p>
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
