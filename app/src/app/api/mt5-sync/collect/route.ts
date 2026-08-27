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
import { isForexOpen } from '@/lib/market-hours'
import { trackServer } from '@/lib/server/track'
import { redactText } from '@/lib/redact'
import type { SupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 60

// One deploy(:00) → collect(:10) cycle. A deploy error younger than this is
// still the live cause of whatever collect is about to fail with; anything
// older is from a previous cycle and safe to replace. Generous on purpose —
// GitHub's scheduler drifts, so :00 and :10 are nominal, not exact.
const CYCLE_MS = 50 * 60 * 1000

// How long a broken account may stay quiet before it re-notifies its owner.
const RENOTIFY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Durable per-cycle record
//
// `broker_accounts` carries the CURRENT state and nothing else: a success sets
// `sync_error` back to null, so the failure it replaces leaves no trace. State
// answers "is sync working now"; it cannot answer "what fraction of cycles
// worked", which is the number the trust page has to publish. So each account's
// outcome is written once per cycle to `analytics_events`, which is append-only
// and already has a retention policy (0055).
//
//   broker_sync_succeeded  — deals fetched and the account marked active
//   broker_sync_failed     — reliability failure; props.phase is 'deploy' when
//                            this cycle's deploy is the root cause, else 'collect'
//   broker_sync_skipped    — the account was NOT ATTEMPTED because the user has
//                            no entitlement. Deliberately a third event, not a
//                            failure: a downgrade is a product decision, and
//                            counting it as a fault would make the published
//                            reliability rate fall every time somebody's plan
//                            lapses.
//
//   rate = succeeded / (succeeded + failed)   -- skipped is not in either term
//
// Nothing is emitted when the market is closed: no attempt was made, and a
// weekend of "not attempted" in the denominator would understate reliability by
// about 30%. `trackServer` is fire-and-forget and marks internal profiles, so
// the founder's own test account stays out of any real-user figure.
// ---------------------------------------------------------------------------

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
  // Accounts are undeployed over the weekend, so fetching would fail for every
  // one of them and mark a healthy account as errored — and notify its owner
  // that their sync is broken, every hour, all weekend. Skip instead.
  if (!isForexOpen(new Date())) {
    return NextResponse.json({ synced: 0, total: 0, skipped: 'market_closed' })
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
    // Accounts stay deployed between cycles (see lib/market-hours.ts for why
    // the old deploy/undeploy-every-hour pattern cost about six times what it
    // saved). So this route no longer undeploys on its way out — EXCEPT when
    // the account should not be running at all, which is `stop: true` below.
    // A transient fetch error must NOT undeploy: the next cycle would pay
    // another start fee to recover from a blip that may already be over.
    const fail = async (msg: string, opts: { stop?: boolean; entitlement?: boolean } = {}) => {
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
      // Only when the account has lost its entitlement to run. Leaving a
      // downgraded user's account deployed would bill hosting indefinitely for
      // somebody who is no longer paying.
      if (opts.stop) await undeployAccount(row.metaapi_account_id)

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

      // The reason is redacted, not trimmed: a fetch failure puts the upstream
      // URL in the message and `props` is kept for the life of the account.
      await trackServer(
        opts.entitlement ? 'broker_sync_skipped' : 'broker_sync_failed',
        { id: row.user_id },
        {
          phase: opts.entitlement ? 'entitlement' : deployFailedThisCycle ? 'deploy' : 'collect',
          reason: redactText(msg),
        },
      )
    }
    try {
      // Same gate as connectBroker (incl. admin override) — see deploy route.
      const tier = await getTier(svc, row.user_id)
      if (!canFlag(flags, tier, 'mt5_autosync')) { await fail('Pro plan required for auto-sync.', { stop: true, entitlement: true }); continue }

      const since = row.last_deal_time ?? row.created_at
      const fetched = await fetchDealsSince(row.metaapi_account_id, row.region, since)
      if ('error' in fetched) { await fail(`fetch: ${fetched.error}`); continue }

      const { trades, maxDealTime } = pairDealsToTrades(fetched.deals as MetaApiDeal[])
      let imported = 0
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
        imported = inserted?.length ?? 0
        if (imported > 0) {
          await insertSystemNotification({ supabase: svc, userId: row.user_id, type: 'import_done' })
        }
      }

      await svc.from('broker_accounts').update({
        status: 'active',
        sync_error: null,
        sync_error_phase: null,
        sync_error_at: null,
        last_sync_at: new Date().toISOString(),
        ...(maxDealTime ? { last_deal_time: maxDealTime } : {}),
      }).eq('id', row.id)
      synced++
      await trackServer('broker_sync_succeeded', { id: row.user_id }, { trades: imported })
    } catch (e) {
      await fail(e instanceof Error ? e.message : 'sync failed')
    }
  }
  return NextResponse.json({ synced, total: rows?.length ?? 0 })
}
