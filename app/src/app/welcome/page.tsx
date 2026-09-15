import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TrialWelcome } from './TrialWelcome'

// Sits between sign-up and onboarding: Sign up → Trial → Onboarding.
//
// Still no plan picker — everyone trials Pro, and anyone who wants Trader or
// annual switches in the billing portal before day 14 (terms §8). But there IS
// a checkout now: the trial is a real Stripe subscription with a card behind
// it, so the primary button opens Stripe and the trial starts when it returns.
//
// The screen also carries a "Continue on Free" route, and that is load-bearing
// rather than a courtesy — terms §7 and two for/ landing pages all say the Free
// plan needs no card, which is only true while someone can get past here
// without entering one. See TrialWelcome.
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
