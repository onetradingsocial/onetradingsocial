'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useTyping(conversationId: string, currentUserId: string) {
  const [peerTyping, setPeerTyping] = useState(false)
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!conversationId) return
    const supabase = createClient()
    const channel = supabase.channel(`typing:${conversationId}`, { config: { broadcast: { self: false } } })
    channel.on('broadcast', { event: 'typing' }, (payload) => {
      if ((payload.payload as { userId: string }).userId === currentUserId) return
      setPeerTyping(true)
      if (clearTimer.current) clearTimeout(clearTimer.current)
      clearTimer.current = setTimeout(() => setPeerTyping(false), 3000)
    })
    channel.subscribe()
    channelRef.current = channel
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current)
      supabase.removeChannel(channel)
      channelRef.current = null
      setPeerTyping(false)
    }
  }, [conversationId, currentUserId])

  const lastSent = useRef(0)
  const notifyTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastSent.current < 1500) return // throttle
    lastSent.current = now
    channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId } })
  }, [currentUserId])

  return { peerTyping, notifyTyping }
}
