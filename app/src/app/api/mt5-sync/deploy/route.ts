import { NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { deployAccount } from '@/lib/server/metaapi'
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
    .select('id, user_id, metaapi_account_id')
    .in('status', ['pending', 'active', 'error'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let deployed = 0
  for (const row of rows ?? []) {
    const { data: subs } = await svc
      .from('subscriptions').select('tier, status').eq('user_id', row.user_id)
    const tier = tierFromSubscriptions(subs ?? [])
    if (!canFlag(flags, tier, 'mt5_autosync')) {
      await svc.from('broker_accounts')
        .update({ sync_error: 'Pro plan required for auto-sync.' }).eq('id', row.id)
      continue
    }

    const r = await deployAccount(row.metaapi_account_id)
    if ('error' in r) {
      await svc.from('broker_accounts').update({ sync_error: `deploy: ${r.error}` }).eq('id', row.id)
    } else {
      deployed++
    }
  }
  return NextResponse.json({ deployed, total: rows?.length ?? 0 })
}
