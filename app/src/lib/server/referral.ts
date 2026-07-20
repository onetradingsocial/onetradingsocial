import 'server-only'
import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { makeReferralCode, type ReferralStats } from '@/lib/referral'

/** Get the user's referral code, creating one on first use. */
export async function ensureReferralCode(svc: SupabaseClient, userId: string): Promise<string | null> {
  const { data: existing } = await svc
    .from('referral_codes').select('code').eq('user_id', userId).maybeSingle()
  if (existing) return existing.code

  const { data: prof } = await svc.from('profiles').select('username').eq('id', userId).maybeSingle()
  if (!prof) return null

  // Retry on the (unlikely) unique collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeReferralCode(prof.username, randomBytes(3).toString('hex'))
    const { error } = await svc.from('referral_codes').insert({ user_id: userId, code })
    if (!error) return code
    if (error.code !== '23505') return null
  }
  return null
}

export async function getReferralStats(svc: SupabaseClient, userId: string, code: string): Promise<ReferralStats> {
  const [{ count: clicks }, { data: rows }] = await Promise.all([
    svc.from('referral_clicks').select('id', { count: 'exact', head: true }).eq('code', code),
    svc.from('referrals').select('status').eq('referrer_id', userId),
  ])
  const list = rows ?? []
  return {
    clicks: clicks ?? 0,
    signups: list.length,
    // 'paid' implies the user activated first, so it counts toward both.
    activated: list.filter((r) => r.status === 'activated' || r.status === 'paid').length,
    paid: list.filter((r) => r.status === 'paid').length,
  }
}

/**
 * Attribute a brand-new signup to a referrer. Abuse controls:
 *  - unknown code -> no-op
 *  - self-referral rejected (also enforced by a CHECK constraint)
 *  - one referrer per referred user forever (unique index)
 *  - internal/seed accounts never earn credit
 */
export async function attributeReferral(svc: SupabaseClient, referredUserId: string, code: string): Promise<void> {
  const clean = code.trim().toLowerCase()
  if (!clean) return

  const { data: owner } = await svc
    .from('referral_codes').select('user_id, code').ilike('code', clean).maybeSingle()
  if (!owner || owner.user_id === referredUserId) return

  const { data: refProf } = await svc
    .from('profiles').select('is_internal').eq('id', owner.user_id).maybeSingle()
  if (refProf?.is_internal) return

  // Ignore the duplicate error: the unique index is the real guard.
  await svc.from('referrals').insert({
    referrer_id: owner.user_id, referred_user_id: referredUserId, code: owner.code,
  })
}

/** Promote a referral to 'activated' when the referred user logs their first trade. */
export async function markReferralActivated(svc: SupabaseClient, referredUserId: string): Promise<string | null> {
  const { data } = await svc
    .from('referrals')
    .update({ status: 'activated', activated_at: new Date().toISOString() })
    .eq('referred_user_id', referredUserId).eq('status', 'signed_up')
    .select('referrer_id').maybeSingle()
  return data?.referrer_id ?? null
}

/** Promote to 'paid' when the referred user's subscription goes active. */
export async function markReferralPaid(svc: SupabaseClient, referredUserId: string): Promise<string | null> {
  const { data } = await svc
    .from('referrals')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('referred_user_id', referredUserId).in('status', ['signed_up', 'activated'])
    .select('referrer_id').maybeSingle()
  return data?.referrer_id ?? null
}
