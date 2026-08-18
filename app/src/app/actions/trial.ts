'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logError } from '@/lib/server/log'

export type AckResult = { ok: true } | { ok: false; error: string }

/** "Continue on Free" — records that the user answered the end-of-trial modal
 *  so it never blocks them again. Takes no arguments: a user can only ever
 *  acknowledge their own trial, so there is nothing to forge. */
export async function ackTrial(): Promise<AckResult> {
  const supabase = await createClient()
  // A mutation, so getUser() rather than getSessionUser().
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const { error } = await createServiceClient()
    .from('profiles')
    .update({ trial_ack_at: new Date().toISOString() })
    .eq('id', user.id)
    .is('trial_ack_at', null)

  if (error) {
    logError('ackTrial', error, { note: 'failed' })
    return { ok: false, error: 'Could not save your choice. Please try again.' }
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}
