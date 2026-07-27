import { NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { syncExchangeAccount, type ExchangeRow } from '@/lib/server/crypto-sync'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'

export const maxDuration = 60
// Binance returns HTTP 451 from restricted-jurisdiction IPs (incl. US). Pin a
// non-US region. VERIFY the chosen region actually reaches Binance on the
// deployed env (Task 11) — adjust if 451 persists.
export const preferredRegion = ['sin1']

export async function GET(req: Request) {
  if (!authorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const svc = createServiceClient()
  const flags = await getFeatureFlags()
  const { data: rows, error } = await svc
    .from('exchange_accounts')
    .select('id, user_id, exchange, api_key_enc, api_secret_enc, symbols, last_fill_at, status')
    .in('status', ['active', 'error'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let synced = 0
  for (const row of rows ?? []) {
    // Autosync is a Pro feature; a downgraded owner is parked in error.
    const tier = await getTier(svc, row.user_id)
    if (!canFlag(flags, tier, 'crypto_autosync')) {
      await svc.from('exchange_accounts')
        .update({ status: 'error', sync_error: 'Auto-sync requires the Pro plan.' }).eq('id', row.id)
      continue
    }
    const res = await syncExchangeAccount(svc, row as ExchangeRow)
    if (!('error' in res)) synced++
  }
  return NextResponse.json({ synced, total: rows?.length ?? 0 })
}
