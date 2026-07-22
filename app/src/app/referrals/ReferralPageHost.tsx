'use client'

import { useRouter } from 'next/navigation'
import { ReferralModal, type ReferralSummary } from '@/app/_components/ReferralModal'

/** Standalone host for the referral modal at /referrals — closing returns home. */
export function ReferralPageHost({ summary }: { summary: ReferralSummary }) {
  const router = useRouter()
  return <ReferralModal summary={summary} loading={false} onClose={() => router.push('/')} />
}
