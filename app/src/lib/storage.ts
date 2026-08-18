import { createServiceClient } from '@/lib/supabase/service'

// Exported because account deletion has to sweep BOTH buckets (item 6 F6.2)
// and the one thing worse than not deleting a user's files is deleting them
// from a bucket name that has drifted out of sync with the uploaders'.
export const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'OneTradingSocial'

// Private-by-intent uploads (trade charts, DM attachments) live in a second,
// non-public bucket guarded by storage RLS -- see migration 0044. The name is
// deliberately NOT NEXT_PUBLIC_: nothing in the browser bundle needs to know it.
// The two upload routes hand it back to the client alongside the signed-upload
// token, which is the only moment a browser has any business naming it.
export const PRIVATE_BUCKET = process.env.SUPABASE_PRIVATE_BUCKET || 'OneTradingSocial-private'

// Private objects are never referenced by an absolute storage URL. The DB
// stores an app-relative URL through this route, which authorises the viewer
// and redirects to a short-TTL signed URL (see api/private-image/route.ts).
const PRIVATE_IMAGE_ROUTE = '/api/private-image'

// Storage keys are UUIDs, slashes and a two-value extension, so they are safe
// in a query string unescaped -- and leaving them unescaped keeps the stored
// URL prefix-matchable by the server actions that validate it.
function privateImageUrl(key: string) {
  return `${PRIVATE_IMAGE_ROUTE}?key=${key}`
}

function avatarKey(userId: string, contentType: string) {
  const ext = contentType === 'image/png' ? 'png' : 'jpg'
  return `avatars/${userId}.${ext}`
}

export function avatarPublicUrl(userId: string, contentType: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${avatarKey(userId, contentType)}`
}

// Service-role signed upload URL. Bypasses storage RLS; auth + path are
// enforced by the caller (see actions/avatar.ts), so no per-user policy needed.
export async function signAvatarUpload(userId: string, contentType: string) {
  const path = avatarKey(userId, contentType)
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return { error: 'Could not create upload URL.' as const }
  return { path: data.path, token: data.token }
}

function coverKey(userId: string, contentType: string) {
  const ext = contentType === 'image/png' ? 'png' : 'jpg'
  return `covers/${userId}.${ext}`
}

export function coverPublicUrl(userId: string, contentType: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${coverKey(userId, contentType)}`
}

export async function signCoverUpload(userId: string, contentType: string) {
  const path = coverKey(userId, contentType)
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return { error: 'Could not create upload URL.' as const }
  return { path: data.path, token: data.token }
}

/**
 * Trade chart keys are VERSIONED: `trades/{uid}/{tradeId}/{version}.{ext}`.
 *
 * ── Audit item 15, F8 (P2) ───────────────────────────────────────────────────
 *
 * The key used to be `trades/{uid}/{tradeId}.{ext}` — deterministic — and the
 * signed upload URL was minted with `upsert: true`. Re-uploading therefore
 * overwrote the object in place at a URL that never changed, so
 * `trades.screenshot_url` did not change either, so the `trades_audit` trigger
 * wrote nothing and the admin "recent trade edits" panel saw nothing. A chart
 * posted as evidence for a trade could be swapped for a different chart at any
 * time — after the trade was shared, after it was reported, after it was
 * reviewed — leaving no trace anywhere in the system.
 *
 * That matters because `/verification` lists "confirmed reports of manipulated
 * screenshots" as grounds for losing verification, which presumes a screenshot
 * is evidence. Evidence has to be tamper-EVIDENT; it does not have to be
 * immutable. A random version segment plus `upsert: false` is what buys that:
 * a replacement necessarily writes a new key, which necessarily updates
 * `screenshot_url`, which necessarily produces a `trade_audits` row recording
 * that the chart changed and what it was before. The old object is still
 * there, so the previous evidence survives rather than being destroyed by the
 * replacement.
 *
 * `upsert: false` also removes a smaller hazard: with a random version segment
 * a collision means someone guessed a uuid, and silently overwriting on that
 * event is never the right answer.
 */
function tradeChartKey(userId: string, tradeId: string, version: string, contentType: string) {
  return `trades/${userId}/${tradeId}/${version}.${contentType === 'image/png' ? 'png' : 'jpg'}`
}

export function tradeChartUrl(userId: string, tradeId: string, version: string, contentType: string) {
  return privateImageUrl(tradeChartKey(userId, tradeId, version, contentType))
}

export function tradeChartPrefix(userId: string) {
  return privateImageUrl(`trades/${userId}/`)
}

export async function signTradeChartUpload(userId: string, tradeId: string, version: string, contentType: string) {
  const path = tradeChartKey(userId, tradeId, version, contentType)
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from(PRIVATE_BUCKET)
    .createSignedUploadUrl(path, { upsert: false })
  if (error || !data) return { error: 'Could not create upload URL.' as const }
  return { bucket: PRIVATE_BUCKET, path: data.path, token: data.token }
}

function postImageKey(userId: string, postId: string, idx: number, contentType: string) {
  const ext = contentType === 'image/png' ? 'png' : 'jpg'
  return `posts/${userId}/${postId}/${idx}.${ext}`
}

export function postImagePublicUrl(userId: string, postId: string, idx: number, contentType: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${postImageKey(userId, postId, idx, contentType)}`
}

export async function signPostImageUpload(userId: string, postId: string, idx: number, contentType: string) {
  const path = postImageKey(userId, postId, idx, contentType)
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return { error: 'Could not create upload URL.' as const }
  return { path: data.path, token: data.token }
}

function messageImageKey(userId: string, draftId: string, idx: number, contentType: string) {
  const ext = contentType === 'image/png' ? 'png' : 'jpg'
  return `messages/${userId}/${draftId}/${idx}.${ext}`
}

export function messageImageUrl(userId: string, draftId: string, idx: number, contentType: string) {
  return privateImageUrl(messageImageKey(userId, draftId, idx, contentType))
}

export function messageImagePrefix(userId: string) {
  return privateImageUrl(`messages/${userId}/`)
}

export async function signMessageImageUpload(userId: string, draftId: string, idx: number, contentType: string) {
  const path = messageImageKey(userId, draftId, idx, contentType)
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return { error: 'Could not create upload URL.' as const }
  return { bucket: PRIVATE_BUCKET, path: data.path, token: data.token }
}

/**
 * Short-lived signed read URL for a private object. Service role, so it
 * bypasses storage RLS -- every caller must have authorised the VIEWER first
 * (see api/private-image/route.ts). The TTL is short because a signed URL is a
 * bearer token: once it leaks it is valid until it expires, and nothing else.
 */
export const PRIVATE_READ_TTL = 300

export async function signPrivateRead(key: string, expiresIn = PRIVATE_READ_TTL) {
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(key, expiresIn)
  if (error || !data) return null
  return data.signedUrl
}
