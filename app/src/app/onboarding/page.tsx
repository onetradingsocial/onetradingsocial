import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { OnboardingForm } from './OnboardingForm'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles').select('username').eq('id', user.id).single()

  return (
    <div className="ts-authwrap">
      <div className="ts-card ts-card--narrow">
        <p className="eyebrow">Set up your identity</p>
        <h1 className="ts-h1 mt-3">Build your trader profile</h1>
        <p className="ts-sub">A few quick questions — this shapes your public profile and leaderboard placement.</p>
        <OnboardingForm initialUsername={profile?.username ?? ''} />
      </div>
    </div>
  )
}
