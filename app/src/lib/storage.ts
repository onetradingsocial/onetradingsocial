import { createServiceClient } from '@/lib/supabase/service'

const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'OneTradingSocial'

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

function tradeChartKey(userId: string, tradeId: string, contentType: string) {
  const ext = contentType === 'image/png' ? 'png' : 'jpg'
  return `trades/${userId}/${tradeId}.${ext}`
}

export function tradeChartPublicUrl(userId: string, tradeId: string, contentType: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${tradeChartKey(userId, tradeId, contentType)}`
}

export async function signTradeChartUpload(userId: string, tradeId: string, contentType: string) {
  const path = tradeChartKey(userId, tradeId, contentType)
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return { error: 'Could not create upload URL.' as const }
  return { path: data.path, token: data.token }
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

export function messageImagePublicUrl(userId: string, draftId: string, idx: number, contentType: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${messageImageKey(userId, draftId, idx, contentType)}`
}

export function messageImagePrefix(userId: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/messages/${userId}/`
}

export async function signMessageImageUpload(userId: string, draftId: string, idx: number, contentType: string) {
  const path = messageImageKey(userId, draftId, idx, contentType)
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return { error: 'Could not create upload URL.' as const }
  return { path: data.path, token: data.token }
}
