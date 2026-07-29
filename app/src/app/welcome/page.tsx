import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TrialWelcome } from './TrialWelcome'

// Sits between sign-up and onboarding: Sign up → Trial starts → Onboarding.
// No plan picker and no checkout — every new account gets 14 days of Pro.
export default async function WelcomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('onboarding_completed').eq('id', user.id).single()
  if (profile?.onboarding_completed) redirect('/')

  return (
    <div className="fl-stage fl-stage--full">
      <TrialWelcome />
    </div>
  )
}
