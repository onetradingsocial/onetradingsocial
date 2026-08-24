import { NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { undeployAccount, fetchDealsSince } from '@/lib/server/metaapi'
import { pairDealsToTrades, type MetaApiDeal } from '@/lib/metaapi-deals'
import { mapDealToTrade } from '@/lib/mt5'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { insertSystemNotification } from '@/lib/notifications'
import type { SupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 60

// One deploy(:00) → collect(:10) cycle. A deploy error younger than this is
// still the live cause of whatever collect is about to fail with; anything
// older is from a previous cycle and safe to replace. Generous on purpose —
// GitHub's scheduler drifts, so :00 and :10 are nominal, not exact.
const CYCLE_MS = 50 * 60 * 1000

// How long a broken account may stay quiet before it re-notifies its owner.
const RENOTIFY_MS = 24 * 60 * 60 * 1000

// True if this user already got a sync_failed notification inside the window.
// Fails safe: on a query error we report "already notified" so a logging blip
// can't turn into an hourly notification loop.
async function notifiedWithin(svc: SupabaseClient, userId: string, windowMs: number) {
  const since = new Date(Date.now() - windowMs).toISOString()
  const { data, error } = await svc
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'sync_failed')
    .gte('created_at', since)
    .limit(1)
  return error ? true : (data?.length ?? 0) > 0
}

export async function GET(req: Request) {
  if (!authorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const svc = createServiceClient()
  const flags = await getFeatureFlags()
  const { data: rows, error } = await svc
    .from('broker_accounts')
    .select('id, user_id, metaapi_account_id, region, last_deal_time, created_at, status, sync_error_phase, sync_error_at')
    .in('status', ['pending', 'active', 'error'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let synced = 0
  for (const row of rows ?? []) {
    // Hourly burst sync (deploy :00 → collect :10): accounts run only for
    // the window, so every exit path undeploys to stop MetaApi billing.
    const fail = async (msg: string) => {
      // Don't bury the deploy phase's error under our own. If deploy failed
      // earlier in this same hourly cycle, that message is the root cause and
      // ours is only its symptom: an account that was never deployed always
      // reads back from MetaApi as "not connected to broker yet ... or request
      // URL does not match the account region", which points at a region
      // misconfiguration that isn't there. Keep the cause, discard the symptom.
      const deployErrAt = row.sync_error_phase === 'deploy' && row.sync_error_at
        ? Date.parse(row.sync_error_at)
        : NaN
      const deployFailedThisCycle =
        Number.isFinite(deployErrAt) && Date.now() - deployErrAt < CYCLE_MS

      await svc.from('broker_accounts').update({
        status: 'error',
        ...(deployFailedThisCycle ? {} : {
          sync_error: msg,
          sync_error_phase: 'collect',
          sync_error_at: new Date().toISOString(),
        }),
      }).eq('id', row.id)
      await undeployAccount(row.metaapi_account_id)

      // Notify the owner their verification is at risk (row 31). This runs
      // hourly, so notifying on every failure would spam an upstream outage —
      // but notifying ONLY on the transition into error means an account that
      // stays broken goes silent forever, which is how a dead sync sat
      // unnoticed from 2026-08-11 to 2026-08-24. Re-notify on the transition,
      // or at most once a day while it stays broken.
      const stale = row.status === 'error' && !(await notifiedWithin(svc, row.user_id, RENOTIFY_MS))
      if (row.status !== 'error' || stale) {
        await insertSystemNotification({ supabase: svc, userId: row.user_id, type: 'sync_failed' })
      }
    }
    try {
      // Same gate as connectBroker (incl. admin override) — see deploy route.
      const tier = await getTier(svc, row.user_id)
      if (!canFlag(flags, tier, 'mt5_autosync')) { await fail('Pro plan required for auto-sync.'); continue }

      const since = row.last_deal_time ?? row.created_at
      const fetched = await fetchDealsSince(row.metaapi_account_id, row.region, since)
      if ('error' in fetched) { await fail(`fetch: ${fetched.error}`); continue }

      const { trades, maxDealTime } = pairDealsToTrades(fetched.deals as MetaApiDeal[])
      if (trades.length > 0) {
        const { data: profile } = await svc
          .from('profiles').select('is_public').eq('id', row.user_id).single()
        const mapped = trades.map((t) =>
          mapDealToTrade(t, { userId: row.user_id, isPublic: profile?.is_public ?? true, source: 'broker' }))
        const { data: inserted, error: upErr } = await svc
          .from('trades')
          .upsert(mapped, { onConflict: 'user_id,broker_deal_id', ignoreDuplicates: true })
          .select('id')
        if (upErr) { await fail(`upsert: ${upErr.message}`); continue }
        if ((inserted?.length ?? 0) > 0) {
          await insertSystemNotification({ supabase: svc, userId: row.user_id, type: 'import_done' })
        }
      }

      await undeployAccount(row.metaapi_account_id)
      await svc.from('broker_accounts').update({
        status: 'active',
        sync_error: null,
        sync_error_phase: null,
        sync_error_at: null,
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
