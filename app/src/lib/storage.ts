import { createServiceClient } from '@/lib/supabase/service'

const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'OneTradingSocial'

// Private-by-intent uploads (trade charts, DM attachments) live in a second,
// non-public bucket guarded by storage RLS -- see migration 0044. The name is
// deliberately NOT NEXT_PUBLIC_: nothing in the browser bundle needs to know it.
// The two upload routes hand it back to the client alongside the signed-upload
// token, which is the only moment a browser has any business naming it.
const PRIVATE_BUCKET = process.env.SUPABASE_PRIVATE_BUCKET || 'OneTradingSocial-private'

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

function tradeChartKey(userId: string, tradeId: string, contentType: string) {
  return `trades/${userId}/${tradeId}.${contentType === 'image/png' ? 'png' : 'jpg'}`
}

export function tradeChartUrl(userId: string, tradeId: string, contentType: string) {
  return privateImageUrl(tradeChartKey(userId, tradeId, contentType))
}

export function tradeChartPrefix(userId: string) {
  return privateImageUrl(`trades/${userId}/`)
}

export async function signTradeChartUpload(userId: string, tradeId: string, contentType: string) {
  const path = tradeChartKey(userId, tradeId, contentType)
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from(PRIVATE_BUCKET)
    .createSignedUploadUrl(path, { upsert: true })
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
