'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { provisionAccount, removeAccount, undeployAccount } from '@/lib/server/metaapi'
import { allowAction, EXTERNAL_BUDGET } from '@/lib/server/action-throttle'
import { trackServer } from '@/lib/server/track'

export type BrokerState = { ok?: boolean; error?: string }

/**
 * Why every exit from connectBroker is instrumented.
 *
 * `broker_accounts` only ever gains a row on SUCCESS, so it could not
 * distinguish "nobody tried" from "everybody tried and failed" — both read as
 * zero, which is exactly what production showed for the first two months.
 * These events make the attempt visible independently of the outcome.
 *
 * Server-side on purpose: client `track()` is gated on analytics consent and is
 * trivially forgeable, and `broker_connected` feeds the funnel. Deliberately
 * NOT added to the /api/track allowlist for the same reason.
 *
 * Reason codes are a closed set — never the raw provider string, which can
 * carry account detail. The investor password is never recorded in any form.
 */
export type ConnectFailure =
  | 'not_authenticated'
  | 'rate_limited'
  | 'tier'
  | 'invalid_login'
  | 'missing_password'
  | 'invalid_server'
  | 'already_connected'
  | 'provider'
  | 'db_insert'

export async function connectBroker(_prev: BrokerState, formData: FormData): Promise<BrokerState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  /** Single exit point for a failed attempt, so no branch can be added later
   *  that returns an error without leaving a trace. `detail` carries the one
   *  genuinely diagnostic string we have — the provider's own message — kept
   *  separate from the closed-set `reason` so grouping still works, and
   *  truncated. `login`, `server` and the investor password never go in. */
  const fail = async (
    reason: ConnectFailure,
    error: string,
    detail?: string,
  ): Promise<BrokerState> => {
    await trackServer('broker_connect_failed', user, {
      reason,
      ...(detail ? { detail: detail.slice(0, 120) } : {}),
    })
    return { error }
  }

  if (!user) return fail('not_authenticated', 'Not authenticated.')
  const gate = await allowAction(EXTERNAL_BUDGET, user.id)
  if (!gate.ok) return fail('rate_limited', gate.message)
  const tier = await getTier(supabase, user.id)
  const flags = await getFeatureFlags()

  // Recorded BEFORE the tier gate: a Pro-gated bounce is a result, not a
  // non-event. `tier` rides along so a bounce can be read against the plan the
  // user was actually on at the time.
  await trackServer('broker_connect_submitted', user, { tier })

  if (!canFlag(flags, tier, 'mt5_autosync')) return fail('tier', 'Auto-sync is available on the Pro plan.')

  const login = String(formData.get('login') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const server = String(formData.get('server') ?? '').trim()
  if (!/^\d{4,20}$/.test(login)) return fail('invalid_login', 'Login must be your numeric MT5 account number.')
  if (!password) return fail('missing_password', 'Investor password is required.')
  if (!server || server.length > 64) return fail('invalid_server', 'Server name is required.')

  const { data: existing } = await supabase
    .from('broker_accounts').select('id').eq('user_id', user.id).maybeSingle()
  if (existing) return fail('already_connected', 'A broker account is already connected. Disconnect it first.')

  const prov = await provisionAccount({
    login, password, server, name: `ts-${user.id.slice(0, 8)}`,
  })
  // "invalid credentials" and "unknown server" are different problems with
  // different fixes, and this is the branch most likely to be silently eating
  // real attempts, so the provider's message rides along as `detail`.
  if ('error' in prov) return fail('provider', prov.error, prov.error)

  const { error } = await supabase.from('broker_accounts').insert({
    user_id: user.id, login, server,
    metaapi_account_id: prov.accountId, region: prov.region,
  })
  if (error) {
    await removeAccount(prov.accountId) // don't orphan the MetaApi account
    return fail('db_insert', error.message)
  }
  await trackServer('broker_connected', user, { tier, region: prov.region })
  revalidatePath('/settings')
  return { ok: true }
}

export async function disconnectBroker(): Promise<BrokerState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gate = await allowAction(EXTERNAL_BUDGET, user.id)
  if (!gate.ok) return { error: gate.message }

  const { data: row } = await supabase
    .from('broker_accounts').select('id, metaapi_account_id').eq('user_id', user.id).maybeSingle()
  if (!row) return { error: 'No broker account connected.' }

  await undeployAccount(row.metaapi_account_id) // best-effort
  await removeAccount(row.metaapi_account_id)   // best-effort
  const { error } = await supabase.from('broker_accounts').delete().eq('id', row.id)
  if (error) return { error: error.message }
  // Counterpart to broker_connected: without it a connect followed by a
  // disconnect is indistinguishable from a connection that never happened,
  // since the table returns to empty either way.
  await trackServer('broker_disconnected', user, {})
  revalidatePath('/settings')
  return { ok: true }
}
