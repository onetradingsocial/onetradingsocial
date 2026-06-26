'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { validateAttachments, type Attachment } from '@/lib/messaging'
import { messageImagePrefix } from '@/lib/storage'
import { areMutualFollowers, getOrCreateConversation } from '@/lib/server/messaging'
import { insertNotification } from '@/lib/notifications'

export async function sendMessage(
  recipientId: string,
  body: string,
  attachments: Attachment[] = [],
): Promise<{ messageId?: string; conversationId?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (recipientId === user.id) return { error: 'You cannot message yourself.' }

  const text = (body ?? '').trim()
  const atts = Array.isArray(attachments) ? attachments : []
  if (!text && atts.length === 0) return { error: 'Write a message first.' }
  if (text.length > 4000) return { error: 'Message is too long (4000 max).' }
  const v = validateAttachments(atts)
  if (!v.ok) return { error: v.error }

  const prefix = messageImagePrefix(user.id)
  for (const a of atts) {
    if (a.type === 'image' && !a.url.startsWith(prefix)) {
      return { error: 'Invalid image attachment.' }
    }
  }

  // mutual-follow gate — re-checked every send, fail closed
  const mutual = await areMutualFollowers(supabase, user.id, recipientId)
  if (!mutual) return { error: 'You can only message people who follow you back.' }

  // validate any trade attachment belongs to the sender
  const tradeAtt = atts.find((a) => a.type === 'trade')
  if (tradeAtt && tradeAtt.type === 'trade') {
    const { data: t } = await supabase.from('trades').select('user_id').eq('id', tradeAtt.tradeId).single()
    if (!t || t.user_id !== user.id) return { error: 'Trade not found.' }
  }

  const service = createServiceClient()
  const conversationId = await getOrCreateConversation(service, user.id, recipientId)

  const { data: msg, error } = await service.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: text || null,
    attachments: atts,
  }).select('id').single()
  if (error || !msg) return { error: 'Could not send message.' }

  await service.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)

  await insertNotification({
    supabase: service, userId: recipientId, actorId: user.id,
    type: 'message', entityId: conversationId, entityType: 'conversation',
  })

  return { messageId: msg.id, conversationId }
}

export async function markThreadRead(conversationId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  // confirm participant
  const { data: c } = await supabase
    .from('conversations').select('user_a, user_b').eq('id', conversationId).maybeSingle()
  if (!c || (c.user_a !== user.id && c.user_b !== user.id)) return
  const service = createServiceClient()
  await service.from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', user.id)
    .is('read_at', null)
}

export async function deleteMessage(messageId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const service = createServiceClient()
  // own message only
  await service.from('messages')
    .update({ deleted_at: new Date().toISOString(), body: null, attachments: [] })
    .eq('id', messageId)
    .eq('sender_id', user.id)
}
