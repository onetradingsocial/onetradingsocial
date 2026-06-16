'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { validateUsername } from '@/lib/username'
import { onboardingToRow, type OnboardingInput, type ExperienceLevel } from '@/lib/profile'

export type ProfileState = { error?: string }

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
