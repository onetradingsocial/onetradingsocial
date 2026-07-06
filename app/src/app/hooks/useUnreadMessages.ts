'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useUnreadMessages(initialCount: number) {
  const [unreadCount, setUnreadCount] = useState(initialCount)

  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (channel) { supabase.removeChannel(channel); channel = null }
      if (!session?.user) return
      const userId = session.user.id
      channel = supabase
        .channel(`messages-unread:${userId}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          async (payload) => {
            const row = payload.new as Record<string, unknown>
            // RLS only delivers rows in the user's conversations; count inbound only
            if ((row.sender_id as string) === userId) return
            // pending requests stay out of the inbox badge (Requests tab owns them)
            const { data: c } = await supabase
              .from('conversations').select('status').eq('id', row.conversation_id as string).maybeSingle()
            if (c && c.status === 'pending') return
            setUnreadCount((c2) => c2 + 1)
          })
        .subscribe()
    })
    return () => { authSub.unsubscribe(); if (channel) supabase.removeChannel(channel) }
  }, [])

  return { unreadCount, setUnreadCount }
}
