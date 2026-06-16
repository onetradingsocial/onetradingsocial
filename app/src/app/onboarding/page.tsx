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
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-bold">Build your trader identity</h1>
      <OnboardingForm initialUsername={profile?.username ?? ''} />
    </main>
  )
}
