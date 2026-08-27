import 'server-only'

// Thin MetaApi REST wrapper. ALL MetaApi endpoint knowledge lives here so a
// docs mismatch is a one-file fix (verified live in the release checklist).
const PROVISIONING = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai'
const clientApi = (region: string) => `https://mt-client-api-v1.${region}.agiliumtrade.ai`
// Without a cap a stalled MetaApi request burns the whole 60s function budget
// and the mt5-sync cron fails on a 504. Successful calls run in ~3-5s.
const TIMEOUT_MS = 15_000

function token(): string | null {
  return process.env.METAAPI_TOKEN || null
}

async function call(url: string, init: RequestInit = {}): Promise<{ ok: true; body: unknown } | { error: string }> {
  const t = token()
  if (!t) return { error: 'MetaApi is not configured.' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'auth-token': t, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    if (res.status === 204) return { ok: true, body: null }
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = (body as { message?: string } | null)?.message ?? `MetaApi error (${res.status})`
      return { error: msg }
    }
    return { ok: true, body }
  } catch (e) {
    // Surface the timeout distinctly so sync_error says why, not just "unreachable".
    if (e instanceof Error && e.name === 'AbortError') {
      return { error: `MetaApi timed out after ${TIMEOUT_MS / 1000}s.` }
    }
    return { error: 'Could not reach MetaApi.' }
  } finally {
    clearTimeout(timer)
  }
}

export async function provisionAccount(p: { login: string; password: string; server: string; name: string }) {
  const created = await call(`${PROVISIONING}/users/current/accounts`, {
    method: 'POST',
    body: JSON.stringify({
      name: p.name, login: p.login, password: p.password, server: p.server,
      platform: 'mt5', magic: 0,
    }),
  })
  if ('error' in created) return created
  const id = (created.body as { id?: string } | null)?.id
  if (!id) return { error: 'MetaApi did not return an account id.' }

  const acc = await call(`${PROVISIONING}/users/current/accounts/${id}`)
  const region = ('error' in acc ? null : (acc.body as { region?: string } | null)?.region) ?? 'london'
  return { accountId: id, region }
}

/** MetaApi account lifecycle states we care about. DEPLOYING is treated as
 *  deployed on purpose: a second deploy call while one is in flight is at best
 *  wasted and at worst a second start-up fee. */
const RUNNING_STATES = new Set(['DEPLOYED', 'DEPLOYING'])

/**
 * Whether the account is already running, read from MetaApi rather than from
 * our own column.
 *
 * A local `deployed_at` flag would drift the moment MetaApi undeploys an
 * account on its own (deploy failure, maintenance, an undeploy we lost the
 * response to), and a stale "already deployed" belief means the sync quietly
 * reads nothing forever. Reading the provider's own state cannot drift, and
 * the MetaApi REST API is free — only deployment and uptime are billed.
 *
 * Fails CLOSED on error: an unknown state reports `false`, so the caller
 * deploys. Paying one extra start fee is strictly better than a sync that
 * never runs because we assumed the account was up.
 */
export async function isAccountRunning(accountId: string): Promise<boolean> {
  const r = await call(`${PROVISIONING}/users/current/accounts/${accountId}`)
  if ('error' in r) return false
  const state = (r.body as { state?: string } | null)?.state
  return typeof state === 'string' && RUNNING_STATES.has(state)
}

export async function deployAccount(accountId: string) {
  const r = await call(`${PROVISIONING}/users/current/accounts/${accountId}/deploy`, { method: 'POST' })
  return 'error' in r ? r : { ok: true as const }
}

export async function undeployAccount(accountId: string) {
  const r = await call(`${PROVISIONING}/users/current/accounts/${accountId}/undeploy`, { method: 'POST' })
  return 'error' in r ? r : { ok: true as const }
}

export async function removeAccount(accountId: string) {
  const r = await call(`${PROVISIONING}/users/current/accounts/${accountId}`, { method: 'DELETE' })
  return 'error' in r ? r : { ok: true as const }
}

export async function fetchDealsSince(accountId: string, region: string, sinceIso: string) {
  const till = new Date().toISOString()
  const r = await call(
    `${clientApi(region)}/users/current/accounts/${accountId}/history-deals/time/${encodeURIComponent(sinceIso)}/${encodeURIComponent(till)}`,
  )
  if ('error' in r) return r
  return { deals: Array.isArray(r.body) ? r.body : [] }
}
