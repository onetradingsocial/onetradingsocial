import { NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { undeployAccount, isAccountRunning } from '@/lib/server/metaapi'

export const maxDuration = 60

/**
 * Weekend shutdown — the third sync phase, fired once at Friday's close.
 *
 * Accounts are otherwise left deployed permanently: MetaApi bills a flat fee
 * per START, so the old deploy-and-undeploy-every-hour cycle paid 720 start
 * fees a month to save hourly hosting that cost a sixth as much. The one window
 * still worth switching off is the weekend, when the market is shut and no deal
 * can be created — ~48 hours of hosting saved for a single start fee on Sunday.
 *
 * Deliberately NOT gated on entitlement. Undeploying is the safe direction: if
 * a user's tier is misread here the worst outcome is that a paying account sits
 * idle over a weekend when nothing could have synced anyway, and the deploy
 * route brings it back on Sunday. Refusing to stop an account because of a
 * failed tier lookup would bill real money instead.
 */
export async function GET(req: Request) {
  if (!authorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const svc = createServiceClient()
  const { data: rows, error } = await svc
    .from('broker_accounts')
    .select('id, metaapi_account_id')
    .in('status', ['pending', 'active', 'error'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let undeployed = 0
  const failures: string[] = []

  for (const row of rows ?? []) {
    // Already down (a failed deploy, a manual stop) — nothing to pay for and
    // nothing to do. Counted as a success so the workflow's `ok < total` assert
    // does not go red on an account that is already in the desired state.
    if (!(await isAccountRunning(row.metaapi_account_id))) {
      undeployed++
      continue
    }
    const r = await undeployAccount(row.metaapi_account_id)
    if ('error' in r) {
      failures.push(`${row.id}: ${r.error}`)
    } else {
      undeployed++
    }
  }

  // No status/sync_error write on failure. An account that will not undeploy is
  // a billing problem, not a sync problem, and stamping `status: 'error'` here
  // would tell the user their sync is broken when it is about to work fine on
  // Monday. It also would not survive: the deploy phase clears the row anyway.
  return NextResponse.json({
    undeployed,
    total: rows?.length ?? 0,
    ...(failures.length > 0 ? { failures } : {}),
  })
}
