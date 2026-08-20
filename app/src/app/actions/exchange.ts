'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { verifyReadOnly, type ExchangeCreds } from '@/lib/server/binance'
import { validatePairs } from '@/lib/crypto/exchange-symbols'
import { encryptSecret } from '@/lib/server/secrets'
import { syncExchangeAccount, type ExchangeRow } from '@/lib/server/crypto-sync'
import { allowAction, EXTERNAL_BUDGET } from '@/lib/server/action-throttle'

export type ExchangeState = { ok?: boolean; error?: string }
const IMPORT_GATE = 'Crypto sync is available on the Pro plan.'

async function gateImport(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string | null> {
  const tier = await getTier(supabase, userId)
  const flags = await getFeatureFlags()
  return canFlag(flags, tier, 'crypto_import') ? null : IMPORT_GATE
}

export async function connectExchange(_prev: ExchangeState, formData: FormData): Promise<ExchangeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const throttle = await allowAction(EXTERNAL_BUDGET, user.id)
  if (!throttle.ok) return { error: throttle.message }
  const gateErr = await gateImport(supabase, user.id)
  if (gateErr) return { error: gateErr }

  const apiKey = String(formData.get('apiKey') ?? '').trim()
  const apiSecret = String(formData.get('apiSecret') ?? '').trim()
  if (!apiKey || !apiSecret) return { error: 'API key and secret are required.' }

  const { pairs, invalid } = validatePairs(String(formData.get('symbols') ?? '').split(','))
  if (pairs.length === 0) return { error: 'Add at least one valid pair (e.g. BTC/USDT).' }
  if (invalid.length > 0) return { error: `Not a valid pair: ${invalid.join(', ')}` }

  const { data: existing } = await supabase
    .from('exchange_accounts').select('id').eq('user_id', user.id).eq('exchange', 'binance').maybeSingle()
  if (existing) return { error: 'Binance is already connected. Disconnect it first.' }

  const creds: ExchangeCreds = { apiKey, apiSecret }
  const verdict = await verifyReadOnly(creds)
  if (!verdict.ok) return { error: verdict.reason }

  const { error } = await supabase.from('exchange_accounts').insert({
    user_id: user.id, exchange: 'binance', status: 'active', symbols: pairs,
    api_key_enc: await encryptSecret(apiKey),
    api_secret_enc: await encryptSecret(apiSecret),
  })
  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { ok: true }
}

export async function disconnectExchange(): Promise<ExchangeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(EXTERNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }
  const { error } = await supabase
    .from('exchange_accounts').delete().eq('user_id', user.id).eq('exchange', 'binance')
  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { ok: true }
}

export type SyncNowResult = { imported?: number; error?: string }

export async function syncNow(): Promise<SyncNowResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const throttle = await allowAction(EXTERNAL_BUDGET, user.id)
  if (!throttle.ok) return { error: throttle.message }
  const gateErr = await gateImport(supabase, user.id)
  if (gateErr) return { error: gateErr }

  // The service client is the only role that can read the *_enc columns.
  const svc = createServiceClient()
  const { data: row } = await svc
    .from('exchange_accounts')
    .select('id, user_id, exchange, api_key_enc, api_secret_enc, symbols, last_fill_at')
    .eq('user_id', user.id).eq('exchange', 'binance').maybeSingle()
  if (!row) return { error: 'No exchange connected.' }

  const res = await syncExchangeAccount(svc, row as ExchangeRow)
  revalidatePath('/journal')
  revalidatePath('/settings')
  return 'error' in res ? { error: res.error } : { imported: res.imported }
}
