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
