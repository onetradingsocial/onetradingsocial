'use client'

import Link from 'next/link'
import { useUnreadMessages } from '@/app/hooks/useUnreadMessages'

export function MessagesBell({ initialCount }: { initialCount: number }) {
  const { unreadCount } = useUnreadMessages(initialCount)
  return (
    <Link href="/messages" className="ts-nav-icon ts-notif-bell" title="Messages" aria-label="Messages" style={{ position: 'relative' }}>
      ✉
      {unreadCount > 0 && (
        <span className="ts-notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
      )}
    </Link>
  )
}
