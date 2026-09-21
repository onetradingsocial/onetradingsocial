import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { OnboardingForm } from './OnboardingForm'

// Private. Middleware already 3xx-redirects logged-out visitors; noindex is
// the backstop if that ever changes. SEO audit 2026-09-18, finding 3.
export const metadata: Metadata = {
  title: 'Set up your profile — TradingSocial',
  robots: { index: false, follow: false },
}

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles').select('username, display_name, onboarding_completed').eq('id', user.id).single()

  // Already onboarded? Don't let them redo it — send them into the app.
  if (profile?.onboarding_completed) redirect('/')

  // A private (solo) profile is a paid perk — free users are public-only.
  const tier = await getTier(supabase, user.id)
  const canGoPrivate = tier !== 'free'

  return (
    <div className="ob-app">
      <div className="ob-scrim">
        <OnboardingForm
          initialUsername={profile?.username ?? ''}
          displayName={profile?.display_name ?? undefined}
          canGoPrivate={canGoPrivate}
        />
      </div>
    </div>
  )
}
