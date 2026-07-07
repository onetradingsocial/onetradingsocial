'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { validateUsername } from '@/lib/username'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { onboardingToRow, type OnboardingInput, type ExperienceLevel, resolveVisibility, EXPERIENCE_LEVELS } from '@/lib/profile'
import { CUSTOM_BADGES } from '@/lib/badges'
import { THEME_PRESETS, sanitizeCtaUrl } from '@/lib/creator-profile'

export type ProfileState = { error?: string; ok?: boolean }

export async function saveOnboarding(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const username = String(formData.get('username') ?? '')
  const v = validateUsername(username)
  if (!v.ok) return { error: v.error }

  const input: OnboardingInput = {
    username,
    experience_level: String(formData.get('experience_level') ?? 'beginner') as ExperienceLevel,
    main_markets: formData.getAll('main_markets').map(String),
    trading_styles: formData.getAll('trading_styles').map(String),
    goal: String(formData.get('goal') ?? ''),
    is_public: formData.get('is_public') === 'public',
  }

  const { error } = await supabase
    .from('profiles')
    .update(onboardingToRow(input))
    .eq('id', user.id)

  if (error) {
    if (error.code === '23505') return { error: 'That username is already taken.' }
    return { error: error.message }
  }
  redirect('/')
}

// Edits profile content from the settings hub. Unlike saveOnboarding it does NOT
// touch onboarding_completed and returns to the same page (no redirect) so the
// client form can show inline success/error.
export async function saveProfileSettings(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const username = String(formData.get('username') ?? '').trim()
  const v = validateUsername(username)
  if (!v.ok) return { error: v.error }

  const clean = (key: string): string | null => {
    const s = String(formData.get(key) ?? '').trim()
    return s.length ? s : null
  }

  const requestedExperience = String(formData.get('experience_level') ?? 'beginner')
  const experience_level: ExperienceLevel = EXPERIENCE_LEVELS.includes(requestedExperience as ExperienceLevel)
    ? (requestedExperience as ExperienceLevel)
    : 'beginner'

  const tier = await getTier(supabase, user.id)
  const requestedPublic = formData.get('is_public') === 'public'

  const flags = await getFeatureFlags()
  const canCustomBadge = canFlag(flags, tier, 'custom_badge')
  const requestedBadge = String(formData.get('custom_badge') ?? '').trim()
  const custom_badge = canCustomBadge && CUSTOM_BADGES.some((b) => b.key === requestedBadge)
    ? requestedBadge
    : null

  const canCreatorProfile = canFlag(flags, tier, 'creator_profile')
  const requestedTheme = String(formData.get('theme_color') ?? '').trim()
  const theme_color = canCreatorProfile && THEME_PRESETS.some((t) => t.key === requestedTheme)
    ? requestedTheme
    : null
  const tagline = canCreatorProfile ? clean('tagline') : null
  const cta_label = canCreatorProfile ? clean('cta_label') : null
  const requestedCtaUrl = String(formData.get('cta_url') ?? '').trim()
  const cta_url = canCreatorProfile && requestedCtaUrl ? sanitizeCtaUrl(requestedCtaUrl) : null

  const requestedPinned = String(formData.get('pinned_post_id') ?? '').trim()
  let pinned_post_id: string | null = null
  if (canCreatorProfile && requestedPinned) {
    const { data: owned } = await supabase
      .from('posts').select('id').eq('id', requestedPinned).eq('author_id', user.id).maybeSingle()
    pinned_post_id = owned?.id ?? null
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      username,
      display_name: clean('display_name'),
      bio: clean('bio'),
      goal: clean('goal'),
      experience_level,
      main_markets: formData.getAll('main_markets').map(String),
      trading_styles: formData.getAll('trading_styles').map(String),
      is_public: resolveVisibility(tier, requestedPublic),
      custom_badge,
      theme_color,
      tagline,
      cta_label,
      cta_url,
      pinned_post_id,
    })
    .eq('id', user.id)

  if (error) {
    if (error.code === '23505') return { error: 'That username is already taken.' }
    return { error: error.message }
  }

  revalidatePath('/settings')
  revalidatePath('/[username]', 'page')
  return { ok: true }
}
