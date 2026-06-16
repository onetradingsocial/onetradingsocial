'use server'

import { createClient } from '@/lib/supabase/server'
import { presignAvatarUpload } from '@/lib/r2'

export async function getAvatarUploadUrl(contentType: string) {
  if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
    return { error: 'Only PNG or JPEG allowed.' as const }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' as const }
  return presignAvatarUpload(user.id, contentType)
}

export async function saveAvatarUrl(publicUrl: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' as const }
  const prefix = `${process.env.R2_PUBLIC_BASE_URL}/avatars/${user.id}.`
  if (!publicUrl.startsWith(prefix)) return { error: 'Invalid avatar URL.' as const }
  await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id)
  return { ok: true as const }
}
