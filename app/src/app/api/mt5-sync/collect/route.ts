import { NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { undeployAccount, fetchDealsSince } from '@/lib/server/metaapi'
import { pairDealsToTrades, type MetaApiDeal } from '@/lib/metaapi-deals'
import { mapDealToTrade } from '@/lib/mt5'
import { tierFromSubscriptions } from '@/lib/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'

export const maxDuration = 60

export async function GET(req: Request) {
  if (!authorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const svc = createServiceClient()
  const flags = await getFeatureFlags()
  const { data: rows, error } = await svc
    .from('broker_accounts')
    .select('id, user_id, metaapi_account_id, region, last_deal_time, created_at')
    .in('status', ['pending', 'active', 'error'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let synced = 0
  for (const row of rows ?? []) {
    const fail = async (msg: string) => {
      await svc.from('broker_accounts')
        .update({ status: 'error', sync_error: msg }).eq('id', row.id)
      await undeployAccount(row.metaapi_account_id)
    }
    try {
      const { data: subs } = await svc
        .from('subscriptions').select('tier, status').eq('user_id', row.user_id)
      const tier = tierFromSubscriptions(subs ?? [])
      if (!canFlag(flags, tier, 'mt5_autosync')) { await fail('Pro plan required for auto-sync.'); continue }

      const since = row.last_deal_time ?? row.created_at
      const fetched = await fetchDealsSince(row.metaapi_account_id, row.region, since)
      if ('error' in fetched) { await fail(`fetch: ${fetched.error}`); continue }

      const { trades, maxDealTime } = pairDealsToTrades(fetched.deals as MetaApiDeal[])
      if (trades.length > 0) {
        const { data: profile } = await svc
          .from('profiles').select('is_public').eq('id', row.user_id).single()
        const mapped = trades.map((t) =>
          mapDealToTrade(t, { userId: row.user_id, isPublic: profile?.is_public ?? true }))
        const { error: upErr } = await svc
          .from('trades')
          .upsert(mapped, { onConflict: 'user_id,broker_deal_id', ignoreDuplicates: true })
        if (upErr) { await fail(`upsert: ${upErr.message}`); continue }
      }

      await undeployAccount(row.metaapi_account_id)
      await svc.from('broker_accounts').update({
        status: 'active',
        sync_error: null,
        last_sync_at: new Date().toISOString(),
        ...(maxDealTime ? { last_deal_time: maxDealTime } : {}),
      }).eq('id', row.id)
      synced++
    } catch (e) {
      await fail(e instanceof Error ? e.message : 'sync failed')
    }
  }
  return NextResponse.json({ synced, total: rows?.length ?? 0 })
}
