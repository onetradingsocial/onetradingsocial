'use server'

import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { headers, cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { sendRedditConversion } from '@/lib/server/reddit-capi'
import { trackServer } from '@/lib/server/track'
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

  const requestedType = String(formData.get('account_type') ?? '').trim()
  const account_type = (['live', 'demo', 'prop', 'competition'] as const).includes(requestedType as never)
    ? requestedType
    : null

  // Attribution fallback for the Google-OAuth path (email signups already set
  // this in signUp): campaign cookie -> profile, first value wins.
  const refCookie = (await cookies()).get('ts_ref')?.value ?? null

  const { error } = await supabase
    .from('profiles')
    .update({
      ...onboardingToRow(input),
      account_type,
      ...(refCookie ? { acquisition_source: refCookie.slice(0, 64) } : {}),
    })
    .eq('id', user.id)

  if (error) {
    if (error.code === '23505') return { error: 'That username is already taken.' }
    return { error: error.message }
  }
  // ?signup=1 lets the home page fire the Reddit SignUp conversion once. This is
  // the single completion signal for both the email and Google signup paths,
  // which both converge here at onboarding completion. The shared cid dedupes
  // the browser pixel against the server-side (CAPI) SignUp below.
  await trackServer('onboarding_completed', user, {
    markets: input.main_markets.join(','),
    experience: input.experience_level,
  })

  const conversionId = randomUUID()
  const hdrs = await headers()
  const cookieStore = await cookies()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = hdrs.get('user-agent')
  const clickId = cookieStore.get('rdt_cid')?.value ?? null
  const email = user.email ?? null

  // Best-effort Reddit SignUp conversion via CAPI, sent after the response so it
  // adds no signup latency. Never throws.
  after(async () => {
    await sendRedditConversion({
      eventType: 'SignUp',
      conversionId,
      email,
      externalId: user.id,
      ip,
      userAgent,
      clickId,
    })
  })

  redirect(`/?signup=1&cid=${conversionId}`)
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

  const requestedAccountType = String(formData.get('account_type') ?? '').trim()
  const account_type = (['live', 'demo', 'prop', 'competition'] as const).includes(requestedAccountType as never)
    ? requestedAccountType
    : null

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

  // Leaderboard placement is a Pro perk — non-entitled users always stay listed.
  const canPlacement = canFlag(flags, tier, 'leaderboard_placement')
  const leaderboard_optout = canPlacement && formData.get('leaderboard_optout') === '1'

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
      account_type,
      is_public: resolveVisibility(tier, requestedPublic),
      custom_badge,
      theme_color,
      tagline,
      cta_label,
      cta_url,
      pinned_post_id,
      leaderboard_optout,
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
