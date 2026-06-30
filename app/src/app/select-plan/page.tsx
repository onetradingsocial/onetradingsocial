import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SelectPlanForm } from './SelectPlanForm'

// Sits between sign-up and onboarding: Sign up → Pick a plan → Onboarding.
export default async function SelectPlanPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Already through onboarding? They don't belong in the signup funnel.
  const { data: profile } = await supabase
    .from('profiles').select('onboarding_completed').eq('id', user.id).single()
  if (profile?.onboarding_completed) redirect('/')

  return (
    <div className="fl-stage fl-stage--full">
      <SelectPlanForm />
    </div>
  )
}
