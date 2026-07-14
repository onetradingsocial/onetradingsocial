import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { OnboardingForm } from './OnboardingForm'
import { MetaPixel, subscribeParams } from '@/app/_components/MetaPixel'

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; tier?: string; interval?: string }>
}) {
  const sp = await searchParams
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
      {sp.checkout === 'success' && (
        <MetaPixel
          event="Subscribe"
          params={subscribeParams(sp.tier, sp.interval)}
          email={user.email}
          externalId={user.id}
          requireParam="checkout"
          requireValue="success"
          strip
        />
      )}
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
