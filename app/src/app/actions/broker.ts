'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { provisionAccount, removeAccount, undeployAccount } from '@/lib/server/metaapi'

export type BrokerState = { ok?: boolean; error?: string }

export async function connectBroker(_prev: BrokerState, formData: FormData): Promise<BrokerState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const tier = await getTier(supabase, user.id)
  const flags = await getFeatureFlags()
  if (!canFlag(flags, tier, 'mt5_autosync')) return { error: 'Auto-sync is available on the Pro plan.' }

  const login = String(formData.get('login') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const server = String(formData.get('server') ?? '').trim()
  if (!/^\d{4,20}$/.test(login)) return { error: 'Login must be your numeric MT5 account number.' }
  if (!password) return { error: 'Investor password is required.' }
  if (!server || server.length > 64) return { error: 'Server name is required.' }

  const { data: existing } = await supabase
    .from('broker_accounts').select('id').eq('user_id', user.id).maybeSingle()
  if (existing) return { error: 'A broker account is already connected. Disconnect it first.' }

  const prov = await provisionAccount({
    login, password, server, name: `ts-${user.id.slice(0, 8)}`,
  })
  if ('error' in prov) return { error: prov.error }

  const { error } = await supabase.from('broker_accounts').insert({
    user_id: user.id, login, server,
    metaapi_account_id: prov.accountId, region: prov.region,
  })
  if (error) {
    await removeAccount(prov.accountId) // don't orphan the MetaApi account
    return { error: error.message }
  }
  revalidatePath('/settings')
  return { ok: true }
}

export async function disconnectBroker(): Promise<BrokerState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: row } = await supabase
    .from('broker_accounts').select('id, metaapi_account_id').eq('user_id', user.id).maybeSingle()
  if (!row) return { error: 'No broker account connected.' }

  await undeployAccount(row.metaapi_account_id) // best-effort
  await removeAccount(row.metaapi_account_id)   // best-effort
  const { error } = await supabase.from('broker_accounts').delete().eq('id', row.id)
  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { ok: true }
}
