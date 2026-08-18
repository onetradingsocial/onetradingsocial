import { createHash } from 'crypto'

export type RedditEventType = 'SignUp' | 'Purchase'

export function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export interface ConversionInput {
  eventType: RedditEventType
  conversionId: string
  email?: string | null
  externalId?: string | null
  ip?: string | null
  userAgent?: string | null
  clickId?: string | null
  actionSource?: string
  eventAt?: number
  testMode?: boolean
  value?: number
  currency?: string
  itemCount?: number
}

// Build the v3 conversion_events request body. Pure — no network, no env.
//
// Identifier handling (audit item 17 finding 3 — the highest-sensitivity
// transfer on the platform):
//
//   email, external_id   SHA-256 hex hashed.
//   ip_address           SHA-256 hex hashed. It used to be sent RAW. A raw IP
//                        is directly identifying, this leg is server-to-server
//                        so no ad blocker, cookie setting, ITP or Do Not Track
//                        can reach it, and the recipient is overseas — APP 6
//                        and APP 8 together, with no client-side mitigation
//                        available to the person it describes.
//   user_agent           Passed through. It is not an identifier on its own and
//                        Reddit needs it to classify the event; it carries
//                        weight only in combination with an IP, which is now
//                        hashed.
//
// Note that hashing an IPv4 is weak pseudonymisation on its own — the space is
// only 2^32 and a determined recipient can reverse it. That is why hashing is
// the *second* line here and not the first: callers no longer send `ip` at all
// unless REDDIT_CAPI_SEND_IP is explicitly set, and the advertising consent
// tier gates the whole call. Hashing is the floor for the case where the
// business turns the field back on for match-rate reasons.
export function buildConversionBody(input: ConversionInput) {
  const user: Record<string, unknown> = {}
  if (input.email) user.email = hashSha256(normalizeEmail(input.email))
  if (input.externalId) user.external_id = hashSha256(input.externalId)
  if (input.ip) user.ip_address = hashSha256(input.ip)
  if (input.userAgent) user.user_agent = input.userAgent

  // conversion_id must be SHA-256 hashed to match the browser pixel, which hashes
  // it client-side. Sending it raw here would break dedup (hashed vs raw never
  // match) and double-count. Verified: pixel.js sends sha256(cid) as m.conversionId.
  // Field names per Reddit's Events Manager "Add parameters" reference: the block
  // is `metadata` (not event_metadata) and the amount field is `value` (decimal).
  const metadata: Record<string, unknown> = { conversion_id: hashSha256(input.conversionId) }
  if (input.value != null) metadata.value = input.value
  if (input.currency) metadata.currency = input.currency
  if (input.itemCount != null) metadata.item_count = input.itemCount

  const event: Record<string, unknown> = {
    event_at: input.eventAt ?? Date.now(),
    action_source: input.actionSource ?? 'website',
    type: { tracking_type: input.eventType },
    user,
    metadata,
  }
  if (input.clickId) event.click_id = input.clickId

  return { data: { test_mode: input.testMode ?? false, events: [event] } }
}
