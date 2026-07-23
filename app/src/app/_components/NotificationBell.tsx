// app/src/app/_components/NotificationBell.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useNotifications } from '@/app/hooks/useNotifications'
import type { Notification } from '@/lib/server/notifications'
import { TraderHoverCard } from '@/app/_components/TraderHoverCard'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const SYSTEM_TEXT: Record<string, string> = {
  weekly_report: 'Your weekly review is ready',
  import_done: 'Your trade import finished',
  sync_failed: 'Broker sync failed — reconnect to keep verifying',
  goal_completed: 'You hit a process goal 🎯',
  rule_breach: 'A trade broke one of your rules',
  new_learning: 'New learning material for you',
}

const SYSTEM_ICON: Record<string, string> = {
  weekly_report: '📊', import_done: '📥', sync_failed: '⚠️', goal_completed: '🎯', rule_breach: '🚩', new_learning: '📚',
}

function isSystem(n: Notification): boolean {
  return n.type in SYSTEM_TEXT
}

function notifText(n: Notification): string {
  if (isSystem(n)) return SYSTEM_TEXT[n.type]
  switch (n.type) {
    case 'like':       return `@${n.actorUsername} liked your post`
    case 'comment':    return `@${n.actorUsername} commented on your post`
    case 'follow':     return `@${n.actorUsername} followed you`
    case 'post_share': return `@${n.actorUsername} shared a trade`
    case 'mention':    return `@${n.actorUsername} mentioned you`
    case 'message':    return `@${n.actorUsername} sent you a message`
    default:           return `@${n.actorUsername} interacted with you`
  }
}

function notifHref(n: Notification): string {
  if (n.type === 'weekly_report' || n.type === 'rule_breach' || n.type === 'import_done') return '/journal'
  if (n.type === 'sync_failed') return '/settings#broker'
  if (n.type === 'goal_completed') return '/journal'
  if (n.type === 'new_learning') return '/learn'
  if (n.entityType === 'post' && n.entityId) return `/#post-${n.entityId}`
  if (n.type === 'follow') return `/${n.actorUsername}`
  if (n.type === 'message' && n.entityId) return `/messages?c=${n.entityId}`
  return '/'
}

export function NotificationBell({
  initialCount,
  initialItems,
}: {
  initialCount: number
  initialItems: Notification[]
}) {
  const { unreadCount, notifications, markRead, markAllRead } = useNotifications({
    count: initialCount,
    items: initialItems,
  })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    if (open) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="ts-nav-icon ts-notif-bell"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {unreadCount > 0 && (
          <span className="ts-notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="ts-notif-dropdown" role="dialog" aria-label="Notifications">
          <div className="ts-notif-header">
            <span style={{ fontWeight: 600 }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                className="ts-notif-mark-all"
                onClick={() => markAllRead()}
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="ts-notif-empty">No notifications yet</p>
          ) : (
            <ul className="ts-notif-list">
              {notifications.map((n) => {
                const link = (
                  <Link
                    href={notifHref(n)}
                    onClick={() => { if (!n.read) markRead(n.id); setOpen(false) }}
                    className="ts-notif-row-link"
                  >
                    <span className="ts-notif-avatar">
                      {isSystem(n)
                        ? <span className="ts-notif-avatar-initial" aria-hidden>{SYSTEM_ICON[n.type]}</span>
                        : n.actorAvatarUrl
                          ? <img src={n.actorAvatarUrl} alt="" width={28} height={28} style={{ borderRadius: '50%' }} />
                          : <span className="ts-notif-avatar-initial">{(n.actorUsername[0] ?? '?').toUpperCase()}</span>
                      }
                    </span>
                    <span className="ts-notif-body">
                      <span className="ts-notif-text">{notifText(n)}</span>
                      <span className="ts-notif-time">{relativeTime(n.createdAt)}</span>
                    </span>
                  </Link>
                )
                return (
                  <li key={n.id} className={`ts-notif-row${n.read ? '' : ' ts-notif-unread'}`}>
                    {n.actorId && !isSystem(n)
                      ? <TraderHoverCard userId={n.actorId} username={n.actorUsername} displayName={null} avatarUrl={n.actorAvatarUrl} wrapClassName="thc-block">{link}</TraderHoverCard>
                      : link}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
