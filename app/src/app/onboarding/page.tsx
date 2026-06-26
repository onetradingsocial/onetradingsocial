import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { OnboardingForm } from './OnboardingForm'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles').select('username, display_name').eq('id', user.id).single()

  return (
    <div className="ob-app">
      <div className="ob-scrim">
        <OnboardingForm initialUsername={profile?.username ?? ''} displayName={profile?.display_name ?? undefined} />
      </div>
    </div>
  )
}
