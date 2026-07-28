import { higherTier, normalizeCompTier, type Tier } from '@/lib/entitlements'
import { emailIsAdmin } from '@/lib/admin'

export type TierSource = 'Admin' | 'Comp' | 'Paid' | 'Free'

const ACTIVE = new Set(['active', 'trialing'])

export function userTierSummary(input: {
  email: string | null
  compTier: string | null
  subTier: string | null
  subStatus: string | null
  adminEmails: string[]
}): { tier: Tier; source: TierSource } {
  if (emailIsAdmin(input.email, input.adminEmails)) return { tier: 'pro', source: 'Admin' }

  const comp = normalizeCompTier(input.compTier)
  const paid: Tier =
    input.subStatus && ACTIVE.has(input.subStatus) && (input.subTier === 'trader' || input.subTier === 'pro')
      ? input.subTier
      : 'free'

  const tier = higherTier(comp, paid)
  if (tier === 'free') return { tier, source: 'Free' }
  // Whichever grant actually reaches the effective tier names the source; comp wins ties.
  const source: TierSource = comp === tier ? 'Comp' : 'Paid'
  return { tier, source }
}
