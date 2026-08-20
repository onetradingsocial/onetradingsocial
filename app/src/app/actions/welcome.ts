'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isTier, type Tier } from '@/lib/entitlements'
import { logError } from '@/lib/server/log'
import { allowAction, PROFILE_BUDGET } from '@/lib/server/action-throttle'

export type AckWelcomeResult = { ok: true } | { ok: false; error: string }

/** Records that the user has seen the welcome popup for `tier`, so it does not
 *  fire again until their tier changes.
 *
 *  The tier is validated with isTier (explicit allow-list) rather than trusted:
 *  it arrives from the client, and an arbitrary string here would permanently
 *  mismatch the effective tier and re-show the popup on every page load. We use
 *  isTier() rather than Object.hasOwn(TIER_RANK, tier) or the `in` operator
 *  because those would incorrectly accept Object.prototype keys ('toString',
 *  'constructor', etc.), and storing such garbage would break shouldShowWelcome()
 *  which returns true whenever seen !== tier — causing permanent re-fire.
 *
 *  Writes through the service client because welcome_tier_seen is deliberately
 *  outside the column-level UPDATE grant from 0042. */
export async function ackWelcome(tier: Tier): Promise<AckWelcomeResult> {
  if (!isTier(tier)) return { ok: false, error: 'Unknown tier.' }

  const supabase = await createClient()
  // A mutation, so getUser() rather than getSessionUser().
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }
  const gate = await allowAction(PROFILE_BUDGET, user.id)
  if (!gate.ok) return { ok: false, error: gate.message }

  const { error } = await createServiceClient()
    .from('profiles')
    .update({ welcome_tier_seen: tier })
    .eq('id', user.id)

  if (error) {
    logError('ackWelcome', error, { note: 'failed' })
    return { ok: false, error: 'Could not save. Please try again.' }
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}
