'use server'

import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { signCoverUpload, coverPublicUrl } from '@/lib/storage'

function isAllowed(ct: string): ct is 'image/png' | 'image/jpeg' {
  return ct === 'image/png' || ct === 'image/jpeg'
}

async function requireCreatorProfile(userId: string) {
  const supabase = await createClient()
  const tier = await getTier(supabase, userId)
  return canFlag(await getFeatureFlags(), tier, 'creator_profile')
}

export async function getCoverUploadUrl(contentType: string) {
  if (!isAllowed(contentType)) return { error: 'Only PNG or JPEG allowed.' as const }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' as const }
  if (!(await requireCreatorProfile(user.id))) return { error: 'Creator profile is a Pro perk.' as const }
  return signCoverUpload(user.id, contentType)
}

export async function saveCoverUrl(contentType: string) {
  if (!isAllowed(contentType)) return { error: 'Only PNG or JPEG allowed.' as const }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' as const }
  if (!(await requireCreatorProfile(user.id))) return { error: 'Creator profile is a Pro perk.' as const }
  const publicUrl = `${coverPublicUrl(user.id, contentType)}?v=${Date.now()}`
  await supabase.from('profiles').update({ cover_url: publicUrl }).eq('id', user.id)
  return { ok: true as const, publicUrl }
}
