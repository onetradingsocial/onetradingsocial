'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { parseMt5, validateDeals, mapDealToTrade, type Mt5Deal } from '@/lib/mt5'
import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_BYTES = 5 * 1024 * 1024
const GATE_ERROR = 'MT5 import is available on the Trader plan and above.'

async function gate(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const tier = await getTier(supabase, userId)
  const flags = await getFeatureFlags()
  return canFlag(flags, tier, 'mt5_import') ? null : GATE_ERROR
}

export type ParsedRow = Mt5Deal & { duplicate: boolean }
export type Mt5ParseState = { rows?: ParsedRow[]; skipped?: number; error?: string }

export async function parseMt5Statement(formData: FormData): Promise<Mt5ParseState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gateErr = await gate(supabase, user.id)
  if (gateErr) return { error: gateErr }

  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'No file received.' }
  if (file.size > MAX_BYTES) return { error: 'File too large (max 5 MB).' }

  const parsed = parseMt5(await file.arrayBuffer(), file.name)
  if ('error' in parsed) return { error: parsed.error }

  const tickets = parsed.deals.map((d) => d.ticket)
  const { data: existing } = await supabase
    .from('trades').select('broker_deal_id')
    .eq('user_id', user.id).in('broker_deal_id', tickets)
  const dupes = new Set((existing ?? []).map((r) => r.broker_deal_id))

  return {
    rows: parsed.deals.map((d) => ({ ...d, duplicate: dupes.has(d.ticket) })),
    skipped: parsed.skipped,
  }
}

export type Mt5CommitState = { inserted?: number; error?: string }

export async function commitMt5Import(deals: Mt5Deal[]): Promise<Mt5CommitState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gateErr = await gate(supabase, user.id)
  if (gateErr) return { error: gateErr }

  const valid = validateDeals(deals)
  if ('error' in valid) return { error: valid.error }

  const { data: profile } = await supabase
    .from('profiles').select('is_public').eq('id', user.id).single()
  const isPublic = profile?.is_public ?? true

  const rows = valid.deals.map((d) => mapDealToTrade(d, { userId: user.id, isPublic }))
  const { data, error } = await supabase
    .from('trades')
    .upsert(rows, { onConflict: 'user_id,broker_deal_id', ignoreDuplicates: true })
    .select('id')
  if (error) return { error: error.message }

  revalidatePath('/journal')
  return { inserted: data?.length ?? 0 }
}
