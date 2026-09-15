import { higherTier, normalizeCompTier, type Tier } from '@/lib/entitlements'
import { emailIsAdmin } from '@/lib/admin'

/**
 * Why a trial is its own source rather than a kind of 'Paid'.
 *
 * `trialing` grants the tier, so it belongs in the ACTIVE set below and always
 * has. What it does NOT mean is that anyone has paid us. That distinction did
 * not matter while the only Stripe trial was the rare referral reward; it
 * matters completely once every signup opens a trialing subscription, because
 * from that moment /admin/users would label the ENTIRE user base "Pro, source
 * Paid" and there would be no way left to tell a customer from a trialist.
 *
 * A metric that silently inflates is harder to catch than one that zeroes,
 * because nobody investigates good news.
 */
export type TierSource = 'Admin' | 'Comp' | 'Paid' | 'Trialing' | 'Free'

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
  // Whichever grant actually reaches the effective tier names the source; comp
  // wins ties. When it is the SUBSCRIPTION that reaches it, the status decides
  // whether that is money or a trial — see TierSource. A comped user who also
  // holds a trial still reads 'Comp', because the comp is what they keep.
  const source: TierSource = comp === tier
    ? 'Comp'
    : input.subStatus === 'trialing' ? 'Trialing' : 'Paid'
  return { tier, source }
}

export type AccountFilter = 'all' | 'real' | 'test'
export type SubFilter = 'any' | 'free' | 'trader' | 'pro'
export type CompFilter = 'any' | 'comped' | 'not'

export function normalizeAccountFilter(v: string | undefined): AccountFilter {
  return v === 'all' || v === 'test' || v === 'real' ? v : 'real'
}
export function normalizeSubFilter(v: string | undefined): SubFilter {
  return v === 'free' || v === 'trader' || v === 'pro' ? v : 'any'
}
export function normalizeCompFilter(v: string | undefined): CompFilter {
  return v === 'comped' || v === 'not' ? v : 'any'
}

/** Mirrors the RPC's internal predicate for defensive client-side checks. */
export function isInternalRow(input: { is_internal: boolean | null; email: string | null }): boolean {
  if (input.is_internal) return true
  return (input.email ?? '').toLowerCase().endsWith('@tradingsocial.io')
}
