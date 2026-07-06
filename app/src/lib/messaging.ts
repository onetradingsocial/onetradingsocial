export type ImageAttachment = { type: 'image'; url: string }
export type TradeAttachment = { type: 'trade'; tradeId: string }
export type Attachment = ImageAttachment | TradeAttachment

export interface Message {
  id: string
  conversationId: string
  senderId: string
  body: string | null
  attachments: Attachment[]
  readAt: string | null
  createdAt: string
  deletedAt: string | null
}

export type ConversationStatus = 'pending' | 'accepted'

export interface ConversationListItem {
  conversationId: string
  other: { id: string; username: string; displayName: string | null; avatarUrl: string | null }
  lastMessageAt: string
  preview: string
  unreadCount: number
  status: ConversationStatus
  requesterId: string | null
}

// How many messages the requester may send before the recipient accepts.
export const PENDING_MESSAGE_LIMIT = 3

export function orderPair(id1: string, id2: string): { userA: string; userB: string } {
  return id1 < id2 ? { userA: id1, userB: id2 } : { userA: id2, userB: id1 }
}

export function validateAttachments(atts: Attachment[]): { ok: true } | { ok: false; error: string } {
  const images = atts.filter((a) => a.type === 'image')
  const trades = atts.filter((a) => a.type === 'trade')
  if (images.length > 4) return { ok: false, error: 'Up to 4 images per message.' }
  if (trades.length > 1) return { ok: false, error: 'Only one trade per message.' }
  return { ok: true }
}

export function summarizePreview(m: { body: string | null; attachments: Attachment[]; deletedAt: string | null }): string {
  if (m.deletedAt) return 'Message deleted'
  if (m.body && m.body.trim()) return m.body.trim()
  if (m.attachments.some((a) => a.type === 'trade')) return '📈 Shared a trade'
  if (m.attachments.some((a) => a.type === 'image')) return '📷 Photo'
  return ''
}
