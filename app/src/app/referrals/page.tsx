import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ensureReferralCode, getReferralStats } from '@/lib/server/referral'
import { earnedMonths, REFERRAL_MONTH_CAP } from '@/lib/referral'
import { referralMonthsClaimedFor } from '@/lib/server/billing'
import { getStripe } from '@/lib/stripe'
import { ReferralPageHost } from './ReferralPageHost'

// Login-gated. Logged out, this answers 200 with a meta-refresh to /login
// (redirect() runs after streaming has started), so the page itself has to
// say noindex. SEO audit 2026-09-18, finding 3.
export const metadata: Metadata = {
  title: 'Refer a trader — TradingSocial',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function ReferralsPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const svc = createServiceClient()
  const code = await ensureReferralCode(svc, user.id)
  if (!code) redirect('/')

  const [stats, claimed] = await Promise.all([
    getReferralStats(svc, user.id, code),
    referralMonthsClaimedFor(svc, getStripe(), user.id),
  ])
  return (
    <ReferralPageHost
      summary={{
        code,
        signups: stats.signups,
        activated: stats.activated,
        months: earnedMonths(stats.activated),
        cap: REFERRAL_MONTH_CAP,
        claimed,
      }}
    />
  )
}
