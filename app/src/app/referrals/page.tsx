import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ensureReferralCode, getReferralStats } from '@/lib/server/referral'
import { earnedMonths, REFERRAL_MONTH_CAP } from '@/lib/referral'
import { ReferralPageHost } from './ReferralPageHost'

export const metadata: Metadata = { title: 'Refer a trader — TradingSocial' }
export const dynamic = 'force-dynamic'

export default async function ReferralsPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const svc = createServiceClient()
  const code = await ensureReferralCode(svc, user.id)
  if (!code) redirect('/')

  const stats = await getReferralStats(svc, user.id, code)
  return (
    <ReferralPageHost
      summary={{
        code,
        signups: stats.signups,
        activated: stats.activated,
        months: earnedMonths(stats.activated),
        cap: REFERRAL_MONTH_CAP,
      }}
    />
  )
}
