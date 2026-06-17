'use server'

import { createClient } from '@/lib/supabase/server'
import { signAvatarUpload, avatarPublicUrl } from '@/lib/storage'

function isAllowed(ct: string): ct is 'image/png' | 'image/jpeg' {
  return ct === 'image/png' || ct === 'image/jpeg'
}

export async function getAvatarUploadUrl(contentType: string) {
  if (!isAllowed(contentType)) return { error: 'Only PNG or JPEG allowed.' as const }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' as const }
  return signAvatarUpload(user.id, contentType)
}

export async function saveAvatarUrl(contentType: string) {
  if (!isAllowed(contentType)) return { error: 'Only PNG or JPEG allowed.' as const }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' as const }
  // Rebuild URL server-side from the session user id; never trust a client URL.
  // Cache-bust query so the browser drops the previous avatar after re-upload.
  const publicUrl = `${avatarPublicUrl(user.id, contentType)}?v=${Date.now()}`
  await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id)
  return { ok: true as const, publicUrl }
}
