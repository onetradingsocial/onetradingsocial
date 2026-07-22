import { NextResponse } from 'next/server'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ensureReferralCode, getReferralStats } from '@/lib/server/referral'
import { earnedMonths, REFERRAL_MONTH_CAP } from '@/lib/referral'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Data behind the referral modal. Auth-gated: a user only ever sees their own
 * funnel. Mints the referral code on first open so the link is always ready.
 */
export async function GET() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const code = await ensureReferralCode(svc, user.id)
  if (!code) return NextResponse.json({ error: 'no code' }, { status: 500 })

  const stats = await getReferralStats(svc, user.id, code)
  return NextResponse.json({
    code,
    signups: stats.signups,
    activated: stats.activated,
    months: earnedMonths(stats.activated),
    cap: REFERRAL_MONTH_CAP,
  })
}
