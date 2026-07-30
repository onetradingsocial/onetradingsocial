'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { TIER_RANK, type Tier } from '@/lib/entitlements'

export type AckWelcomeResult = { ok: true } | { ok: false; error: string }

/** Records that the user has seen the welcome popup for `tier`, so it does not
 *  fire again until their tier changes.
 *
 *  The tier is validated against TIER_RANK rather than trusted: it arrives from
 *  the client, and an arbitrary string here would permanently mismatch the
 *  effective tier and re-show the popup on every page load.
 *
 *  Writes through the service client because welcome_tier_seen is deliberately
 *  outside the column-level UPDATE grant from 0042. */
export async function ackWelcome(tier: Tier): Promise<AckWelcomeResult> {
  if (!(tier in TIER_RANK)) return { ok: false, error: 'Unknown tier.' }

  const supabase = await createClient()
  // A mutation, so getUser() rather than getSessionUser().
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const { error } = await createServiceClient()
    .from('profiles')
    .update({ welcome_tier_seen: tier })
    .eq('id', user.id)

  if (error) {
    console.error('[ackWelcome] failed', error)
    return { ok: false, error: 'Could not save. Please try again.' }
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}
