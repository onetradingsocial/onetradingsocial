// app/src/app/hooks/useNotifications.ts
'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { markNotificationRead, markAllNotificationsRead } from '@/app/actions/notifications'
import type { Notification } from '@/lib/server/notifications'

export function useNotifications(initial: { count: number; items: Notification[] }) {
  const [notifications, setNotifications] = useState<Notification[]>(initial.items)
  const [unreadCount, setUnreadCount] = useState(initial.count)

  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return
      const userId = session.user.id
      const channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          (payload) => {
            const row = payload.new as Record<string, unknown>
            const newNotif: Notification = {
              id: row.id as string,
              actorId: row.actor_id as string,
              actorUsername: '',   // will be enriched by full fetch; acceptable for badge count
              actorAvatarUrl: null,
              type: row.type as Notification['type'],
              entityId: (row.entity_id as string) ?? null,
              entityType: (row.entity_type as Notification['entityType']) ?? null,
              read: false,
              createdAt: row.created_at as string,
            }
            setNotifications((prev) => [newNotif, ...prev].slice(0, 20))
            setUnreadCount((c) => c + 1)
          },
        )
        .subscribe()

      return () => { supabase.removeChannel(channel) }
    })
    return () => { authSub.unsubscribe() }
  }, [])

  const markRead = useCallback(async (id: string) => {
    await markNotificationRead(id)
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n))
    setUnreadCount((c) => Math.max(0, c - 1))
  }, [])

  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead()
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
  }, [])

  return { unreadCount, notifications, markRead, markAllRead }
}
