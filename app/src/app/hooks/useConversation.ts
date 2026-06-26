'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sendMessage, markThreadRead } from '@/app/actions/messaging'
import type { Message, Attachment } from '@/lib/messaging'

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    senderId: row.sender_id as string,
    body: (row.body as string) ?? null,
    attachments: ((row.attachments as Attachment[]) ?? []),
    readAt: (row.read_at as string) ?? null,
    createdAt: row.created_at as string,
    deletedAt: (row.deleted_at as string) ?? null,
  }
}

export function useConversation(conversationId: string, currentUserId: string, initial: Message[]) {
  const [messages, setMessages] = useState<Message[]>(initial)

  // reset when switching conversations
  useEffect(() => { setMessages(initial) }, [conversationId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!conversationId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const m = rowToMessage(payload.new as Record<string, unknown>)
          setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m])
          if (m.senderId !== currentUserId) void markThreadRead(conversationId)
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const m = rowToMessage(payload.new as Record<string, unknown>)
          setMessages((prev) => prev.map((x) => x.id === m.id ? m : x))
        })
      .subscribe()
    // mark inbound as read on open
    void markThreadRead(conversationId)
    return () => { supabase.removeChannel(channel) }
  }, [conversationId, currentUserId])

  const send = useCallback(async (body: string, attachments: Attachment[], recipientId: string) => {
    const optimistic: Message = {
      id: `tmp-${Date.now()}`, conversationId, senderId: currentUserId,
      body: body.trim() || null, attachments, readAt: null,
      createdAt: new Date().toISOString(), deletedAt: null,
    }
    setMessages((prev) => [...prev, optimistic])
    const res = await sendMessage(recipientId, body, attachments)
    if (res.error) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      return { error: res.error }
    }
    // replace temp id with the real one (realtime INSERT may also arrive; dedupe by id)
    setMessages((prev) => prev.map((m) => m.id === optimistic.id ? { ...m, id: res.messageId! } : m))
    return {}
  }, [conversationId, currentUserId])

  return { messages, send }
}
