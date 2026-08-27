import { NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { deployAccount, isAccountRunning } from '@/lib/server/metaapi'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { isForexOpen } from '@/lib/market-hours'

export const maxDuration = 60

export async function GET(req: Request) {
  if (!authorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Nothing can trade while the market is shut, so nothing needs to be running.
  // Reported as its own outcome rather than `deployed: 0`, because "0 of 1" is
  // the shape of a failure and this is a deliberate skip — the workflow asserts
  // on those counts and would otherwise go red every weekend.
  if (!isForexOpen(new Date())) {
    return NextResponse.json({ deployed: 0, total: 0, skipped: 'market_closed' })
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
    // Stamp the phase and time alongside every error this route writes. collect
    // runs ten minutes later and used to overwrite whatever we put here with its
    // own downstream symptom, hiding the real cause; it now checks these two
    // columns and leaves a same-cycle deploy error alone (migration 0061).
    const failed = (msg: string) => svc.from('broker_accounts').update({
      sync_error: msg,
      sync_error_phase: 'deploy',
      sync_error_at: new Date().toISOString(),
    }).eq('id', row.id)

    // getTier, not a raw subscriptions read: same gate as connectBroker,
    // including the admin-email → pro override (admins have no sub rows).
    const tier = await getTier(svc, row.user_id)
    if (!canFlag(flags, tier, 'mt5_autosync')) {
      await failed('Pro plan required for auto-sync.')
      continue
    }

    // Accounts are left running between cycles now, so most hours this route
    // has nothing to do. Skipping the deploy call when the account is already
    // up is the entire saving: MetaApi bills a flat fee per START, and calling
    // deploy 720 times a month cost ~6x more than never undeploying at all.
    // Counted as deployed because the postcondition this route promises — the
    // account is running — holds.
    if (await isAccountRunning(row.metaapi_account_id)) {
      deployed++
      continue
    }

    const r = await deployAccount(row.metaapi_account_id)
    if ('error' in r) {
      await failed(`deploy: ${r.error}`)
    } else {
      deployed++
    }
  }
  return NextResponse.json({ deployed, total: rows?.length ?? 0 })
}
