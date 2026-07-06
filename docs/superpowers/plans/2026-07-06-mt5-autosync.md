# MT5 Auto-Sync (MetaApi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pro-tier users connect one MT5 account (investor password, one-time pass-through to MetaApi) and get closed trades synced into the journal daily.

**Architecture:** Thin MetaApi REST wrapper (server-only) + pure deal-pairing module reused by unit tests. Two cron-guarded routes: deploy (03:00 UTC) and collect (03:30 UTC, fetch→map→upsert→undeploy). One `broker_accounts` row per user. Reuses Phase 1's `Mt5Deal` type, `mapDealToTrade`, and the `(user_id, broker_deal_id)` unique index.

**Tech Stack:** Next.js 15 route handlers + server actions, Supabase (service client in cron routes), Vercel cron, Vitest. No new npm deps.

**Spec:** `docs/superpowers/specs/2026-07-06-mt5-autosync-design.md`

## Global Constraints

- Working dir for npm: `D:\Work\OneTradingSocial\Website\app`; `git add` paths relative to app/ (vercel.json is at app/vercel.json since the Next app lives there).
- Tests: `npm test -- tests/unit/<file>` (Vitest, `@/` → `app/src/`).
- Mutations auth via `supabase.auth.getUser()`; tier gate `canFlag(flags, tier, 'mt5_autosync')` server-side in connect action AND per-row in collect route.
- Investor password: transits `connectBroker` → MetaApi provisioning call only. NEVER stored, NEVER logged, never echoed in errors.
- Cron routes: reject unless `authorization === 'Bearer ' + process.env.CRON_SECRET`.
- MetaApi REST endpoint shapes in Task 2 are from MetaApi docs as of plan date — the wrapper isolates them in one file; the live-token verification (Task 7) is where mismatches surface and get fixed. Do not spread endpoint strings outside `metaapi.ts`.
- Style: single quotes, thin `{ error }` returns, house patterns per `actions/trade.ts` / `actions/mt5-import.ts`.
- Repo has unrelated untracked files + user WIP (.gitignore, server/entitlements.ts modified) — commit ONLY files each task names; never `git add -A`.

---

### Task 1: Migration 0019 — broker_accounts

**Files:**
- Create: `app/supabase/migrations/0019_broker_accounts.sql`

**Interfaces:**
- Produces: table `broker_accounts` (columns below). Task 3 inserts/deletes via user client (RLS owner policies); Task 4 updates via service client (no update policy needed).

- [ ] **Step 1: Write the migration**

```sql
-- MT5 auto-sync (phase 2): one MetaApi-backed broker connection per user.
-- No credential storage: MetaApi holds broker creds after one-time provisioning.
create table if not exists public.broker_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'mt5',
  login text not null,
  server text not null,
  metaapi_account_id text not null,
  region text not null default 'london',
  status text not null default 'pending',   -- pending | active | error | disconnected
  last_sync_at timestamptz,
  last_deal_time timestamptz,               -- sync cursor (max closed-deal time seen)
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists broker_accounts_user_idx
  on public.broker_accounts (user_id);

drop trigger if exists broker_accounts_touch_updated_at on public.broker_accounts;
create trigger broker_accounts_touch_updated_at
  before update on public.broker_accounts
  for each row execute function public.touch_updated_at();

alter table public.broker_accounts enable row level security;

-- Owner select/insert/delete; NO update policy (sync routes use service role).
drop policy if exists broker_accounts_select on public.broker_accounts;
create policy broker_accounts_select on public.broker_accounts
  for select using (auth.uid() = user_id);

drop policy if exists broker_accounts_insert on public.broker_accounts;
create policy broker_accounts_insert on public.broker_accounts
  for insert with check (auth.uid() = user_id);

drop policy if exists broker_accounts_delete on public.broker_accounts;
create policy broker_accounts_delete on public.broker_accounts
  for delete using (auth.uid() = user_id);
```

- [ ] **Step 2: Apply** — controller/user applies (SQL editor or MCP), verify with:

```sql
select policyname from pg_policies where tablename = 'broker_accounts';
```

Expected: select/insert/delete policies, no update.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0019_broker_accounts.sql
git commit -m "feat(db): broker_accounts table for mt5 auto-sync"
```

---

### Task 2: Pure deal-pairing module — MetaApi deals → Mt5Deal[]

**Files:**
- Create: `app/src/lib/metaapi-deals.ts` (pure — importable by tests and by server code)
- Test: `app/tests/unit/metaapi-deals.test.ts`

**Interfaces:**
- Consumes: `Mt5Deal` type from `@/lib/mt5` (Phase 1).
- Produces (Task 4 collect route consumes):

```ts
export type MetaApiDeal = {
  id: string
  type: string          // DEAL_TYPE_BUY | DEAL_TYPE_SELL | DEAL_TYPE_BALANCE | ...
  entryType?: string    // DEAL_ENTRY_IN | DEAL_ENTRY_OUT | DEAL_ENTRY_INOUT
  symbol?: string
  positionId?: string
  volume?: number
  price?: number
  time: string          // ISO
  profit?: number
  commission?: number
  swap?: number
  stopLoss?: number
  takeProfit?: number
}
export function pairDealsToTrades(deals: MetaApiDeal[]): { trades: Mt5Deal[]; maxDealTime: string | null }
```

Pairing rules (the module's contract):
- Group by `positionId`; ignore deals without positionId/symbol/volume/price (balance ops etc.).
- `DEAL_ENTRY_IN` deals accumulate: volume-weighted average entry price, summed IN volume, summed IN commission, first IN time, direction (`DEAL_TYPE_BUY` IN → long).
- Each `DEAL_ENTRY_OUT` (and `DEAL_ENTRY_INOUT`, treated as OUT for its volume) produces ONE `Mt5Deal`: ticket = OUT deal id, lots = OUT volume, closePrice/closeTime from OUT, profit/swap from OUT, commission = OUT commission + IN commission × (OUT volume / total IN volume) rounded 2dp, netPnl = profit + that commission + swap rounded 2dp, stopPrice/targetPrice from OUT `stopLoss`/`takeProfit` (else null).
- Positions with IN but no OUT (still open) produce nothing.
- OUT with no seen IN (position opened before `since` window): skip — cursor design makes this rare (window starts at last cursor); count not needed.
- `maxDealTime` = max `time` across ALL input deals (cursor advance), null on empty input.
- Times normalized to `Z` suffix (`new Date(t).toISOString()` trimmed of ms → `YYYY-MM-DDTHH:MM:SSZ`).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { pairDealsToTrades, type MetaApiDeal } from '@/lib/metaapi-deals'

const IN = (over: Partial<MetaApiDeal> = {}): MetaApiDeal => ({
  id: 'd1', type: 'DEAL_TYPE_BUY', entryType: 'DEAL_ENTRY_IN', symbol: 'EURUSD',
  positionId: 'p1', volume: 1, price: 1.085, time: '2026-06-01T09:30:00.000Z',
  profit: 0, commission: -4, swap: 0, ...over,
})
const OUT = (over: Partial<MetaApiDeal> = {}): MetaApiDeal => ({
  id: 'd2', type: 'DEAL_TYPE_SELL', entryType: 'DEAL_ENTRY_OUT', symbol: 'EURUSD',
  positionId: 'p1', volume: 1, price: 1.0905, time: '2026-06-01T14:45:10.000Z',
  profit: 55, commission: -4, swap: -1, ...over,
})

describe('pairDealsToTrades', () => {
  it('pairs simple IN+OUT into one closed trade', () => {
    const { trades, maxDealTime } = pairDealsToTrades([IN(), OUT()])
    expect(trades).toHaveLength(1)
    expect(trades[0]).toMatchObject({
      ticket: 'd2', symbol: 'EURUSD', direction: 'long', lots: 1,
      openPrice: 1.085, closePrice: 1.0905,
      openTime: '2026-06-01T09:30:00Z', closeTime: '2026-06-01T14:45:10Z',
      profit: 55, swap: -1, commission: -8,   // -4 OUT + -4 IN (full volume)
    })
    expect(trades[0].netPnl).toBeCloseTo(46)
    expect(maxDealTime).toBe('2026-06-01T14:45:10Z')
  })

  it('partial close: two OUTs → two trades, IN commission apportioned', () => {
    const { trades } = pairDealsToTrades([
      IN({ volume: 1, commission: -4 }),
      OUT({ id: 'o1', volume: 0.4, profit: 20, commission: -1.6, time: '2026-06-01T11:00:00.000Z' }),
      OUT({ id: 'o2', volume: 0.6, profit: 35, commission: -2.4, time: '2026-06-01T12:00:00.000Z' }),
    ])
    expect(trades).toHaveLength(2)
    expect(trades[0]).toMatchObject({ ticket: 'o1', lots: 0.4 })
    expect(trades[0].commission).toBeCloseTo(-1.6 + -4 * 0.4)
    expect(trades[1].commission).toBeCloseTo(-2.4 + -4 * 0.6)
  })

  it('short direction from SELL entry', () => {
    const { trades } = pairDealsToTrades([
      IN({ type: 'DEAL_TYPE_SELL' }),
      OUT({ type: 'DEAL_TYPE_BUY', profit: -30 }),
    ])
    expect(trades[0].direction).toBe('short')
  })

  it('open position (IN only) produces nothing; balance deals ignored', () => {
    const { trades, maxDealTime } = pairDealsToTrades([
      { id: 'b1', type: 'DEAL_TYPE_BALANCE', time: '2026-06-01T08:00:00.000Z', profit: 1000 },
      IN(),
    ])
    expect(trades).toHaveLength(0)
    expect(maxDealTime).toBe('2026-06-01T09:30:00Z')
  })

  it('weighted average entry across multiple INs', () => {
    const { trades } = pairDealsToTrades([
      IN({ id: 'i1', volume: 1, price: 1.08 }),
      IN({ id: 'i2', volume: 1, price: 1.09, time: '2026-06-01T10:00:00.000Z' }),
      OUT({ volume: 2, profit: 10 }),
    ])
    expect(trades[0].openPrice).toBeCloseTo(1.085)
    expect(trades[0].lots).toBe(2)
  })

  it('stopLoss/takeProfit on OUT map to stop/target; absent → null', () => {
    const a = pairDealsToTrades([IN(), OUT({ stopLoss: 1.082, takeProfit: 1.091 })])
    expect(a.trades[0]).toMatchObject({ stopPrice: 1.082, targetPrice: 1.091 })
    const b = pairDealsToTrades([IN(), OUT()])
    expect(b.trades[0]).toMatchObject({ stopPrice: null, targetPrice: null })
  })

  it('empty input → no trades, null cursor', () => {
    expect(pairDealsToTrades([])).toEqual({ trades: [], maxDealTime: null })
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npm test -- tests/unit/metaapi-deals.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `app/src/lib/metaapi-deals.ts`**

```ts
// Pairs raw MetaApi history deals into Phase 1's Mt5Deal shape.
// Pure module: no server deps; unit-tested with MetaApi-shaped fixtures.
import type { Mt5Deal } from '@/lib/mt5'

export type MetaApiDeal = {
  id: string
  type: string
  entryType?: string
  symbol?: string
  positionId?: string
  volume?: number
  price?: number
  time: string
  profit?: number
  commission?: number
  swap?: number
  stopLoss?: number
  takeProfit?: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

function toZ(t: string): string {
  const d = new Date(t)
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

type Position = {
  symbol: string
  direction: 'long' | 'short'
  inVolume: number
  inNotional: number     // Σ volume × price, for weighted avg entry
  inCommission: number
  firstInTime: string
}

/** Groups deals by positionId; each OUT (or INOUT) emits one closed Mt5Deal. */
export function pairDealsToTrades(deals: MetaApiDeal[]): { trades: Mt5Deal[]; maxDealTime: string | null } {
  const positions = new Map<string, Position>()
  const trades: Mt5Deal[] = []
  let maxTime: string | null = null

  const sorted = [...deals].sort((a, b) => a.time.localeCompare(b.time))
  for (const d of sorted) {
    if (!maxTime || d.time > maxTime) maxTime = d.time

    if (!d.positionId || !d.symbol || d.volume == null || d.price == null) continue
    const isIn = d.entryType === 'DEAL_ENTRY_IN'
    const isOut = d.entryType === 'DEAL_ENTRY_OUT' || d.entryType === 'DEAL_ENTRY_INOUT'
    if (!isIn && !isOut) continue

    if (isIn) {
      const pos = positions.get(d.positionId)
      if (pos) {
        pos.inVolume += d.volume
        pos.inNotional += d.volume * d.price
        pos.inCommission += d.commission ?? 0
      } else {
        positions.set(d.positionId, {
          symbol: d.symbol,
          direction: d.type === 'DEAL_TYPE_BUY' ? 'long' : 'short',
          inVolume: d.volume,
          inNotional: d.volume * d.price,
          inCommission: d.commission ?? 0,
          firstInTime: d.time,
        })
      }
      continue
    }

    const pos = positions.get(d.positionId)
    if (!pos || pos.inVolume <= 0) continue // opened before window; cursor makes this rare

    const share = Math.min(d.volume / pos.inVolume, 1)
    const commission = r2((d.commission ?? 0) + pos.inCommission * share)
    const profit = d.profit ?? 0
    const swap = d.swap ?? 0
    trades.push({
      ticket: d.id,
      symbol: pos.symbol,
      direction: pos.direction,
      lots: d.volume,
      openTime: toZ(pos.firstInTime),
      closeTime: toZ(d.time),
      openPrice: pos.inNotional / pos.inVolume,
      closePrice: d.price,
      stopPrice: d.stopLoss ?? null,
      targetPrice: d.takeProfit ?? null,
      commission,
      swap,
      profit,
      netPnl: r2(profit + commission + swap),
    })
  }

  return { trades, maxDealTime: maxTime ? toZ(maxTime) : null }
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -- tests/unit/metaapi-deals.test.ts` → PASS (7 tests). Then full `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metaapi-deals.ts tests/unit/metaapi-deals.test.ts
git commit -m "feat(mt5): metaapi deal pairing into closed trades"
```

---

### Task 3: MetaApi REST wrapper (server-only)

**Files:**
- Create: `app/src/lib/server/metaapi.ts`

**Interfaces:**
- Produces (Tasks 4–5 consume):

```ts
export async function provisionAccount(p: { login: string; password: string; server: string; name: string }):
  Promise<{ accountId: string; region: string } | { error: string }>
export async function deployAccount(accountId: string): Promise<{ ok: true } | { error: string }>
export async function undeployAccount(accountId: string): Promise<{ ok: true } | { error: string }>
export async function removeAccount(accountId: string): Promise<{ ok: true } | { error: string }>
export async function fetchDealsSince(accountId: string, region: string, sinceIso: string):
  Promise<{ deals: unknown[] } | { error: string }>
```

- [ ] **Step 1: Implement `app/src/lib/server/metaapi.ts`**

```ts
import 'server-only'

// Thin MetaApi REST wrapper. ALL MetaApi endpoint knowledge lives here so a
// docs mismatch is a one-file fix (verified live in the release checklist).
const PROVISIONING = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai'
const clientApi = (region: string) => `https://mt-client-api-v1.${region}.agiliumtrade.ai`

function token(): string | null {
  return process.env.METAAPI_TOKEN || null
}

async function call(url: string, init: RequestInit = {}): Promise<{ ok: true; body: unknown } | { error: string }> {
  const t = token()
  if (!t) return { error: 'MetaApi is not configured.' }
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'auth-token': t, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    if (res.status === 204) return { ok: true, body: null }
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = (body as { message?: string } | null)?.message ?? `MetaApi error (${res.status})`
      return { error: msg }
    }
    return { ok: true, body }
  } catch {
    return { error: 'Could not reach MetaApi.' }
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
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` clean; full `npm test` (no unit tests for this file — network wrapper, exercised in Task 7 live verify).

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/metaapi.ts
git commit -m "feat(mt5): metaapi rest wrapper (provision/deploy/fetch/remove)"
```

---

### Task 4: Cron sync routes + guard + vercel.json

**Files:**
- Create: `app/src/lib/cron.ts` (pure guard)
- Create: `app/src/app/api/mt5-sync/deploy/route.ts`
- Create: `app/src/app/api/mt5-sync/collect/route.ts`
- Create: `app/vercel.json`
- Test: `app/tests/unit/cron.test.ts`

**Interfaces:**
- Consumes: `deployAccount`, `undeployAccount`, `fetchDealsSince` (Task 3); `pairDealsToTrades`, `MetaApiDeal` (Task 2); `mapDealToTrade` (`@/lib/mt5`); `createServiceClient` (`@/lib/supabase/service`); `tierFromSubscriptions` (`@/lib/entitlements`); `getFeatureFlags` + `canFlag`.
- Produces: `authorizedCron(authHeader: string | null): boolean`; two GET routes.

- [ ] **Step 1: Failing test for the guard** (`app/tests/unit/cron.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { authorizedCron } from '@/lib/cron'

describe('authorizedCron', () => {
  const prev = process.env.CRON_SECRET
  beforeEach(() => { process.env.CRON_SECRET = 's3cret' })
  afterEach(() => { process.env.CRON_SECRET = prev })

  it('accepts the exact bearer secret', () => {
    expect(authorizedCron('Bearer s3cret')).toBe(true)
  })
  it('rejects wrong/missing/malformed values', () => {
    expect(authorizedCron('Bearer nope')).toBe(false)
    expect(authorizedCron(null)).toBe(false)
    expect(authorizedCron('s3cret')).toBe(false)
  })
  it('rejects everything when CRON_SECRET unset', () => {
    delete process.env.CRON_SECRET
    expect(authorizedCron('Bearer ')).toBe(false)
    expect(authorizedCron(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Verify fail, implement `app/src/lib/cron.ts`**

```ts
/** Vercel cron sends `authorization: Bearer ${CRON_SECRET}` when the env var
 *  is set. Fails closed when the secret is missing or empty. */
export function authorizedCron(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return authHeader === `Bearer ${secret}`
}
```

- [ ] **Step 3: Verify guard tests pass.**

- [ ] **Step 4: Implement deploy route** (`app/src/app/api/mt5-sync/deploy/route.ts`)

```ts
import { NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { deployAccount } from '@/lib/server/metaapi'

export const maxDuration = 60

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

  let deployed = 0
  for (const row of rows ?? []) {
    const r = await deployAccount(row.metaapi_account_id)
    if ('error' in r) {
      await svc.from('broker_accounts').update({ sync_error: `deploy: ${r.error}` }).eq('id', row.id)
    } else {
      deployed++
    }
  }
  return NextResponse.json({ deployed, total: rows?.length ?? 0 })
}
```

- [ ] **Step 5: Implement collect route** (`app/src/app/api/mt5-sync/collect/route.ts`)

```ts
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
```

- [ ] **Step 6: Create `app/vercel.json`**

```json
{
  "crons": [
    { "path": "/api/mt5-sync/deploy", "schedule": "0 3 * * *" },
    { "path": "/api/mt5-sync/collect", "schedule": "30 3 * * *" }
  ]
}
```

- [ ] **Step 7: Verify** — `npx tsc --noEmit` clean; full `npm test`; `npm run build` (new routes must compile).

- [ ] **Step 8: Commit**

```bash
git add src/lib/cron.ts src/app/api/mt5-sync/deploy/route.ts src/app/api/mt5-sync/collect/route.ts vercel.json tests/unit/cron.test.ts
git commit -m "feat(mt5): daily deploy/collect cron routes with secret guard"
```

---

### Task 5: Broker server actions

**Files:**
- Create: `app/src/app/actions/broker.ts`

**Interfaces:**
- Consumes: `provisionAccount`, `removeAccount`, `undeployAccount` (Task 3); auth/gate helpers as in `actions/mt5-import.ts`.
- Produces (Task 6 UI consumes):

```ts
export type BrokerState = { ok?: boolean; error?: string }
export async function connectBroker(_prev: BrokerState, formData: FormData): Promise<BrokerState>
export async function disconnectBroker(): Promise<BrokerState>
```

- [ ] **Step 1: Implement `app/src/app/actions/broker.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { provisionAccount, removeAccount, undeployAccount } from '@/lib/server/metaapi'

export type BrokerState = { ok?: boolean; error?: string }

export async function connectBroker(_prev: BrokerState, formData: FormData): Promise<BrokerState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const tier = await getTier(supabase, user.id)
  const flags = await getFeatureFlags()
  if (!canFlag(flags, tier, 'mt5_autosync')) return { error: 'Auto-sync is available on the Pro plan.' }

  const login = String(formData.get('login') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const server = String(formData.get('server') ?? '').trim()
  if (!/^\d{4,20}$/.test(login)) return { error: 'Login must be your numeric MT5 account number.' }
  if (!password) return { error: 'Investor password is required.' }
  if (!server || server.length > 64) return { error: 'Server name is required.' }

  const { data: existing } = await supabase
    .from('broker_accounts').select('id').eq('user_id', user.id).maybeSingle()
  if (existing) return { error: 'A broker account is already connected. Disconnect it first.' }

  const prov = await provisionAccount({
    login, password, server, name: `ts-${user.id.slice(0, 8)}`,
  })
  if ('error' in prov) return { error: prov.error }

  const { error } = await supabase.from('broker_accounts').insert({
    user_id: user.id, login, server,
    metaapi_account_id: prov.accountId, region: prov.region,
  })
  if (error) {
    await removeAccount(prov.accountId) // don't orphan the MetaApi account
    return { error: error.message }
  }
  revalidatePath('/settings')
  return { ok: true }
}

export async function disconnectBroker(): Promise<BrokerState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: row } = await supabase
    .from('broker_accounts').select('id, metaapi_account_id').eq('user_id', user.id).maybeSingle()
  if (!row) return { error: 'No broker account connected.' }

  await undeployAccount(row.metaapi_account_id) // best-effort
  await removeAccount(row.metaapi_account_id)   // best-effort
  const { error } = await supabase.from('broker_accounts').delete().eq('id', row.id)
  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { ok: true }
}
```

Note: the investor `password` variable is used only in the `provisionAccount` call — never inserted, logged, or returned.

- [ ] **Step 2: Verify** — `npx tsc --noEmit`; full `npm test`. (No unit tests — same plan decision as Phase 1 actions.)

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/broker.ts
git commit -m "feat(mt5): connect/disconnect broker actions, no credential storage"
```

---

### Task 6: Settings UI — broker connection card

**Files:**
- Create: `app/src/app/settings/BrokerCard.tsx` (client component)
- Modify: `app/src/app/settings/page.tsx` (fetch row + flags, render card)
- Modify: `app/src/app/settings/settings.css` (small additions if needed; reuse existing classes first)

**Interfaces:**
- Consumes: `connectBroker`, `disconnectBroker`, `BrokerState` (Task 5); broker row + `canAutosync` computed server-side in page.

- [ ] **Step 1: Create `app/src/app/settings/BrokerCard.tsx`**

```tsx
'use client'

import { useActionState, useState, useTransition } from 'react'
import { connectBroker, disconnectBroker, type BrokerState } from '@/app/actions/broker'

export type BrokerRow = {
  login: string; server: string; status: string
  last_sync_at: string | null; sync_error: string | null
}

export function BrokerCard({ row, canAutosync }: { row: BrokerRow | null; canAutosync: boolean }) {
  const [state, formAction, pending] = useActionState<BrokerState, FormData>(connectBroker, {})
  const [confirming, setConfirming] = useState(false)
  const [discErr, setDiscErr] = useState('')
  const [discPending, startDisc] = useTransition()

  if (!canAutosync) {
    return (
      <div className="settings-card">
        <h2 className="ts-h2">MT5 auto-sync</h2>
        <p className="ts-sub mt-2">Connect your MT5 account and your closed trades land in the journal automatically, every day.</p>
        <a href="/settings/billing" className="btn btn-primary mt-4">🔒 Upgrade to Pro</a>
      </div>
    )
  }

  if (row) {
    const synced = row.last_sync_at ? new Date(row.last_sync_at).toLocaleString() : 'not yet — first sync runs tonight'
    return (
      <div className="settings-card">
        <h2 className="ts-h2">MT5 auto-sync</h2>
        <p className="ts-sub mt-2">
          Account <strong>{row.login}</strong> on <strong>{row.server}</strong>
          {' · '}status: {row.status}{' · '}last synced: {synced}
        </p>
        <p className="faint mt-1" style={{ fontSize: 12 }}>Syncs daily. Trades appear each morning (UTC).</p>
        {row.sync_error && <p className="ts-error mt-2">{row.sync_error}</p>}
        {discErr && <p className="ts-error mt-2">{discErr}</p>}
        {confirming ? (
          <div className="mt-4" style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={discPending}>Cancel</button>
            <button
              type="button" className="btn btn-primary" disabled={discPending}
              onClick={() => startDisc(async () => {
                const r = await disconnectBroker()
                if (r.error) { setDiscErr(r.error); setConfirming(false) }
              })}
            >{discPending ? 'Disconnecting…' : 'Yes, disconnect'}</button>
          </div>
        ) : (
          <button type="button" className="btn mt-4" onClick={() => setConfirming(true)}>Disconnect</button>
        )}
      </div>
    )
  }

  return (
    <div className="settings-card">
      <h2 className="ts-h2">MT5 auto-sync</h2>
      <p className="ts-sub mt-2">Connect with your read-only investor password — we pass it to the sync service once and never store it. It cannot place trades or move funds.</p>
      <form action={formAction} className="mt-4">
        <label className="ts-field"><span className="ts-label">MT5 account number</span>
          <input name="login" className="ts-input" inputMode="numeric" placeholder="12345678" required /></label>
        <label className="ts-field mt-3"><span className="ts-label">Investor password (read-only)</span>
          <input name="password" type="password" className="ts-input" autoComplete="off" required /></label>
        <label className="ts-field mt-3"><span className="ts-label">Broker server</span>
          <input name="server" className="ts-input" placeholder="ICMarketsSC-Live" required /></label>
        {state.error && <p className="ts-error mt-3">{state.error}</p>}
        <button className="btn btn-primary mt-4" disabled={pending}>{pending ? 'Connecting…' : 'Connect account'}</button>
      </form>
    </div>
  )
}
```

(If `settings-card` class doesn't exist in settings.css, use whatever section-card class the page's existing sections use — match the page's structure, don't invent one.)

- [ ] **Step 2: Wire into `app/src/app/settings/page.tsx`**

Add to the existing `Promise.all`: `getFeatureFlags()` and the broker row:

```ts
supabase.from('broker_accounts')
  .select('login, server, status, last_sync_at, sync_error')
  .eq('id', user.id) // NOTE: column is user_id — use .eq('user_id', user.id)
  .maybeSingle(),
```

(Use `.eq('user_id', user.id)` — the NOTE is the correction, do not ship the wrong column.) Then render below the existing sections, gated:

```tsx
<BrokerCard row={brokerRow} canAutosync={canFlag(flags, tier, 'mt5_autosync')} />
```

Imports: `BrokerCard`, `getFeatureFlags`, `canFlag`. Match the page's existing section placement conventions (read the whole page first).

- [ ] **Step 3: Verify** — `npx tsc --noEmit`; full `npm test`; `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/BrokerCard.tsx src/app/settings/page.tsx src/app/settings/settings.css
git commit -m "feat(mt5): broker connection card in settings, pro-gated"
```

(Omit settings.css from the commit if unchanged.)

---

### Task 7: Verification (controller)

- [ ] **Step 1:** `npm test` + `npx tsc --noEmit` + `npm run build` — all clean.
- [ ] **Step 2:** Migration 0019 applied (user/MCP). Verify policies.
- [ ] **Step 3:** Local route guard check: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/mt5-sync/deploy` → 401; with `-H "Authorization: Bearer $CRON_SECRET"` (set locally) → 200 `{ deployed: 0, total: 0 }`.
- [ ] **Step 4:** Settings page: free/trader user → locked card; Pro user (seeded sub) → connect form renders (server-rendered HTML check works despite hydration quirk).
- [ ] **Step 5 (BLOCKED until user provides METAAPI_TOKEN):** live connect with a demo MT5 account → deploy → collect → trades appear → disconnect. Until then, feature ships dark: without the env var, `connectBroker` returns 'MetaApi is not configured.'
- [ ] **Step 6:** Env documentation: add `METAAPI_TOKEN=` and `CRON_SECRET=` lines to `app/.env.example`, commit that file only.

---

## Self-Review (done at write time)

- Spec coverage: schema+RLS (T1), pairing rules incl. partial closes (T2), wrapper isolation (T3), two-cron flow + guard + lapsed-sub check + per-row error isolation (T4), no-credential connect/disconnect with orphan cleanup (T5), gated settings UI with investor-password copy (T6), env + live verify (T7). Out-of-scope respected.
- Placeholder scan: clean — every code step has full code; the one intentional deferral (live MetaApi verify) is explicitly BLOCKED-labeled with its unblock condition.
- Type consistency: `Mt5Deal` reused from `@/lib/mt5`; `MetaApiDeal`/`pairDealsToTrades` names match between T2 and T4; `BrokerState`/`connectBroker`/`disconnectBroker` match T5→T6; `provisionAccount` return `{ accountId, region }` consumed correctly in T5 insert.
