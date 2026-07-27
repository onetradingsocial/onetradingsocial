# Crypto Sync Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Trader/Pro user connect Binance with a read-only API key and pull their trades into the journal on demand and daily.

**Architecture:** One CCXT-wrapping module (`binance.ts`), a sync engine split into a pure core (`planImport`) and a thin IO wrapper (`syncExchangeAccount`), server actions + a settings card for the UI, and a GitHub-Actions-driven cron route for autosync. CCXT-touching functions take an injectable client so they unit-test without network. Phase 0's pure modules are reused; `map.ts` gets one additive change (an exchange prefix on the dedupe key).

**Tech Stack:** Next.js 15 / React 19, TypeScript, Supabase Postgres, Vitest, CCXT (Binance), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-07-24-crypto-sync-phase1-design.md`

## Global Constraints

- All commands run from `app/` unless stated. `npm test` = `vitest run`; there is no watch mode in CI.
- Unit tests live in `app/tests/unit/<name>.test.ts`, import source via the `@/` alias. `server-only` is aliased to a mock in `vitest.config.ts`, so server modules are unit-testable.
- Do not modify the MT5 path: `src/lib/mt5.ts`, `src/app/actions/mt5-import.ts`, `src/app/api/mt5-sync/**`, `src/app/actions/broker.ts`, migrations `0018`/`0019`.
- Exchange id string, exact: `'binance'`. Dedupe key format, exact: `binance:<fill id>` (built inside `mapCycleToTrade`).
- Only read-only keys are accepted: reject on connect if withdrawal OR trading (spot/margin/futures) is enabled.
- `trades.source` for crypto rows stays `'broker'` (no new enum value).
- Trades upsert on conflict target, exact: `'user_id,broker_deal_id'`, `ignoreDuplicates: true`.
- Pairs are stored in exchange form (`BTC/USDT`); normalization to `BTC/USD` happens only in `mapCycleToTrade` via Phase 0's `symbols.ts`. Never normalize before handing a symbol to CCXT.
- Never log, return, or embed an API key/secret (or its ciphertext) in a message, error, or URL.
- Secrets are encrypted with `encryptSecret` / read with `decryptSecret` (`@/lib/server/secrets`). The sync path reads the `*_enc` columns with the **service client** only (client roles cannot SELECT them — Phase 0 grant).
- Migrations apply to the **dev** Supabase project (`sixixw…`) in this phase; prod is a human step. Supabase MCP may be unauthorized — apply via the dashboard SQL editor if so.
- Rollout (marketing + admin) is the LAST task and ships only after a live end-to-end confirmation — never before.

## Reused Phase 0 interfaces

- `rollupFills(fills: Fill[]): { cycles: Cycle[]; skippedOpen: number; warnings: string[] }` — `@/lib/crypto/fills`.
- `type Fill = { id: string; symbol: string; timestamp: number; side: 'buy'|'sell'; price: number; amount: number; fee?: { cost: number; currency: string } | null }` — `@/lib/crypto/fills`.
- `type Cycle = { dedupeId; symbol; direction; size; entryPrice; exitPrice; fees; pnl; openedAt; closedAt }` — `@/lib/crypto/fills`.
- `mapCycleToTrade(cycle, opts)` — `@/lib/crypto/map` (Task 3 extends `opts`).
- `splitSymbol(raw): { base; quote } | null` — `@/lib/crypto/symbols`.
- `encryptSecret(plain): Promise<string>` / `decryptSecret(enc): Promise<string>` — `@/lib/server/secrets`.
- `createServiceClient()` — `@/lib/supabase/service`.
- `authorizedCron(header): boolean` — `@/lib/cron`.
- `insertSystemNotification({ supabase, userId, type }): Promise<void>` where `type` ∈ system set incl. `'import_done'`, `'sync_failed'` — `@/lib/notifications`.
- Gate trio: `getTier(supabase, userId)` (`@/lib/server/entitlements`), `getFeatureFlags()` (`@/lib/server/feature-flags`), `canFlag(flags, tier, feature)` (`@/lib/feature-flags`).

## File Structure

| File | Responsibility |
|---|---|
| Modify `app/package.json` | Add `ccxt` dependency. |
| Create `app/src/lib/server/binance.ts` | Only CCXT-touching file. `makeClient`, `verifyReadOnly`, `fetchFillsSince`. |
| Modify `app/src/lib/crypto/map.ts` | Add `opts.exchange`; prefix `broker_deal_id`. |
| Create `app/src/lib/crypto/exchange-symbols.ts` | `validatePairs(raw[])` — pure pair-list validation for the connect form. |
| Create `app/src/lib/server/crypto-sync.ts` | `planImport` (pure) + `syncExchangeAccount` (IO wrapper). |
| Create `app/supabase/migrations/0038_exchange_symbols.sql` | Add `symbols text[]` column. |
| Create `app/src/app/actions/exchange.ts` | `connectExchange`, `disconnectExchange`, `syncNow`. |
| Create `app/src/app/settings/ExchangeCard.tsx` | Connect form + pair picker + Sync-now + status + disconnect. |
| Modify `app/src/app/settings/page.tsx` | Fetch the exchange row; render `ExchangeCard`. |
| Create `app/src/app/api/cron/crypto-sync/route.ts` | Cron entry; region-pinned; iterate rows → engine. |
| Create `.github/workflows/crypto-sync.yml` | Daily trigger. |
| Modify `app/src/app/admin/features/page.tsx` | (Rollout) wire crypto flags into WIRED + Trading Journal group. |
| Modify `pricing.html` | (Rollout) add crypto-sync feature rows. |
| Tests | `binance.test.ts`, `crypto-sync.test.ts`, `exchange-symbols.test.ts`, updated `crypto-map.test.ts`. |

---

### Task 1: `binance.ts` — client factory + read-only verification

**Files:**
- Modify: `app/package.json` (add `ccxt`)
- Create: `app/src/lib/server/binance.ts`
- Test: `app/tests/unit/binance.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type ExchangeCreds = { apiKey: string; apiSecret: string }`
  - `type BinanceClient = { fetchMyTrades: Function; sapiGetAccountApiRestrictions: Function }` (structural — the CCXT `binance` instance satisfies it; tests pass a fake).
  - `makeClient(creds: ExchangeCreds): BinanceClient`
  - `verifyReadOnly(creds: ExchangeCreds, client?: BinanceClient): Promise<{ ok: true } | { ok: false; reason: string }>`

- [ ] **Step 1: Install ccxt**

Run (from `app/`):
```bash
npm install ccxt
```
Expected: `ccxt` appears in `package.json` `dependencies`. Commit this in Step 6 together with the module.

- [ ] **Step 2: Write the failing test**

Create `app/tests/unit/binance.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { verifyReadOnly, type BinanceClient } from '@/lib/server/binance'

// A fake CCXT-like client whose apiRestrictions payload we control.
const clientWith = (restrictions: Record<string, unknown>): BinanceClient => ({
  fetchMyTrades: async () => [],
  sapiGetAccountApiRestrictions: async () => restrictions,
})

const READ_ONLY = {
  enableWithdrawals: false,
  enableInternalTransfer: false,
  enableSpotAndMarginTrading: false,
  enableFutures: false,
  enableMargin: false,
}

describe('verifyReadOnly', () => {
  it('accepts a strictly read-only key', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' }, clientWith(READ_ONLY))
    expect(res).toEqual({ ok: true })
  })

  it('rejects a key that can withdraw', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith({ ...READ_ONLY, enableWithdrawals: true }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/withdraw/i)
  })

  it('rejects a key that can trade spot/margin', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith({ ...READ_ONLY, enableSpotAndMarginTrading: true }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/trade/i)
  })

  it('rejects a key that can trade futures', async () => {
    const res = await verifyReadOnly({ apiKey: 'k', apiSecret: 's' },
      clientWith({ ...READ_ONLY, enableFutures: true }))
    expect(res.ok).toBe(false)
  })

  it('reports a read failure without leaking the key', async () => {
    const throwing: BinanceClient = {
      fetchMyTrades: async () => [],
      sapiGetAccountApiRestrictions: async () => { throw new Error('Invalid Api-Key ID') },
    }
    const res = await verifyReadOnly({ apiKey: 'SECRET_KEY', apiSecret: 's' }, throwing)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).not.toContain('SECRET_KEY')
      expect(res.reason).toMatch(/could not|check/i)
    }
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npm test -- tests/unit/binance.test.ts`
Expected: FAIL — cannot resolve `@/lib/server/binance`.

- [ ] **Step 4: Implement**

Create `app/src/lib/server/binance.ts`:

```ts
import 'server-only'
import { binance } from 'ccxt'

// The only module that imports CCXT. Wraps one Binance spot client behind
// two operations the sync needs: a read-only scope check and a fills fetch.
// Functions take an optional client so they unit-test without network.
export type ExchangeCreds = { apiKey: string; apiSecret: string }

export type BinanceClient = {
  fetchMyTrades: (symbol: string, since?: number, limit?: number, params?: object) => Promise<unknown[]>
  sapiGetAccountApiRestrictions: () => Promise<Record<string, unknown>>
}

export function makeClient(creds: ExchangeCreds): BinanceClient {
  return new binance({
    apiKey: creds.apiKey,
    secret: creds.apiSecret,
    enableRateLimit: true,
  }) as unknown as BinanceClient
}

// Reject any key that can move funds or trade. A read key is the only kind
// we will custody. Never echoes the key on failure.
export async function verifyReadOnly(
  creds: ExchangeCreds,
  client: BinanceClient = makeClient(creds),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let r: Record<string, unknown>
  try {
    r = await client.sapiGetAccountApiRestrictions()
  } catch {
    return { ok: false, reason: 'Could not reach Binance with that key — check it is correct and read-only.' }
  }
  if (r.enableWithdrawals === true) {
    return { ok: false, reason: 'This key can withdraw funds. Create a new key with only "Enable Reading" checked.' }
  }
  if (r.enableSpotAndMarginTrading === true || r.enableMargin === true || r.enableFutures === true) {
    return { ok: false, reason: 'This key can place trades. Create a new key with only "Enable Reading" checked.' }
  }
  return { ok: true }
}
```

Note: `sapiGetAccountApiRestrictions` is CCXT's generated name for `GET sapi/v1/account/apiRestrictions`. If `tsc` reports the method is missing on the ccxt type, keep the structural `BinanceClient` cast in `makeClient` (already present) — do not loosen `verifyReadOnly`'s typing.

- [ ] **Step 5: Run the tests**

Run: `npm test -- tests/unit/binance.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add app/package.json app/package-lock.json app/src/lib/server/binance.ts app/tests/unit/binance.test.ts
git commit -m "feat(crypto): binance client + read-only key verification"
```

---

### Task 2: `binance.ts` — fetch fills since a cursor

**Files:**
- Modify: `app/src/lib/server/binance.ts`
- Test: `app/tests/unit/binance.test.ts`

**Interfaces:**
- Consumes: `BinanceClient`, `ExchangeCreds`, `makeClient` (Task 1); `Fill` (`@/lib/crypto/fills`).
- Produces: `fetchFillsSince(creds: ExchangeCreds, symbol: string, sinceMs: number | null, client?: BinanceClient): Promise<Fill[]>` — one pair's fills, paged forward from `sinceMs`, normalized to the Phase 0 `Fill` shape.

- [ ] **Step 1: Add the failing tests**

Append to `app/tests/unit/binance.test.ts`:

```ts
import { fetchFillsSince } from '@/lib/server/binance'
import type { Fill } from '@/lib/crypto/fills'

// A CCXT trade object (the fields fetchFillsSince reads).
const ccxtTrade = (o: Partial<{ id: string; timestamp: number; side: string; price: number; amount: number; fee: unknown }>) => ({
  id: 'x', timestamp: 1_000, symbol: 'BTC/USDT', side: 'buy', price: 100, amount: 1,
  fee: { cost: 0.1, currency: 'USDT' }, ...o,
})

// Fake client that returns a scripted page per call, then empties.
const pagingClient = (pages: unknown[][]): BinanceClient => {
  let i = 0
  return {
    sapiGetAccountApiRestrictions: async () => ({}),
    fetchMyTrades: async () => (i < pages.length ? pages[i++] : []),
  }
}

describe('fetchFillsSince', () => {
  it('normalizes a ccxt trade into a Fill', async () => {
    const fills = await fetchFillsSince({ apiKey: 'k', apiSecret: 's' }, 'BTC/USDT', null,
      pagingClient([[ccxtTrade({ id: 'a', timestamp: 5, side: 'sell', price: 110, amount: 2 })]]))
    expect(fills).toHaveLength(1)
    const f: Fill = fills[0]
    expect(f).toEqual({
      id: 'a', symbol: 'BTC/USDT', timestamp: 5, side: 'sell', price: 110, amount: 2,
      fee: { cost: 0.1, currency: 'USDT' },
    })
  })

  it('pages forward until an empty page and concatenates', async () => {
    const fills = await fetchFillsSince({ apiKey: 'k', apiSecret: 's' }, 'BTC/USDT', 0,
      pagingClient([
        [ccxtTrade({ id: 'a', timestamp: 10 }), ccxtTrade({ id: 'b', timestamp: 20 })],
        [ccxtTrade({ id: 'c', timestamp: 30 })],
      ]))
    expect(fills.map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('stops paging when a page repeats the last id (no forward progress)', async () => {
    const t = ccxtTrade({ id: 'a', timestamp: 10 })
    const fills = await fetchFillsSince({ apiKey: 'k', apiSecret: 's' }, 'BTC/USDT', 0,
      pagingClient([[t], [t]]))
    expect(fills.map((f) => f.id)).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/unit/binance.test.ts`
Expected: FAIL — `fetchFillsSince` not exported.

- [ ] **Step 3: Implement**

Append to `app/src/lib/server/binance.ts`:

```ts
import type { Fill } from '@/lib/crypto/fills'

const PAGE_LIMIT = 1000
// Floor for the first-ever sync: pull at most ~1 year of history per pair.
const BACKFILL_FLOOR_MS = 365 * 24 * 60 * 60 * 1000

type CcxtTrade = {
  id: string; timestamp: number; symbol: string; side: 'buy' | 'sell'
  price: number; amount: number; fee?: { cost: number; currency: string } | null
}

function toFill(t: CcxtTrade): Fill {
  return {
    id: String(t.id),
    symbol: t.symbol,
    timestamp: t.timestamp,
    side: t.side,
    price: t.price,
    amount: t.amount,
    fee: t.fee ?? null,
  }
}

// One pair's fills, paged forward from the cursor. Binance myTrades is
// per-symbol and time-windowed; we walk pages until one comes back short or
// stops making forward progress, guarding against an infinite loop.
export async function fetchFillsSince(
  creds: ExchangeCreds,
  symbol: string,
  sinceMs: number | null,
  client: BinanceClient = makeClient(creds),
): Promise<Fill[]> {
  let since = sinceMs ?? Date.now() - BACKFILL_FLOOR_MS
  const out: Fill[] = []
  const seen = new Set<string>()
  for (;;) {
    const page = (await client.fetchMyTrades(symbol, since, PAGE_LIMIT)) as CcxtTrade[]
    if (!page || page.length === 0) break
    let progressed = false
    for (const t of page) {
      const f = toFill(t)
      if (seen.has(f.id)) continue
      seen.add(f.id)
      out.push(f)
      progressed = true
      if (f.timestamp >= since) since = f.timestamp + 1 // advance the window past this fill
    }
    if (!progressed || page.length < PAGE_LIMIT) break
  }
  return out
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/unit/binance.test.ts`
Expected: PASS, 8 tests total.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/binance.ts app/tests/unit/binance.test.ts
git commit -m "feat(crypto): fetch a pair's fills since a cursor, paged"
```

---

### Task 3: `map.ts` — namespace the dedupe key by exchange

**Files:**
- Modify: `app/src/lib/crypto/map.ts`
- Test: `app/tests/unit/crypto-map.test.ts`

**Interfaces:**
- Consumes: `Cycle` (`@/lib/crypto/fills`).
- Produces: `mapCycleToTrade(cycle, opts: { userId: string; isPublic: boolean; exchange: string })` — `broker_deal_id` is now `` `${opts.exchange}:${cycle.dedupeId}` ``.

- [ ] **Step 1: Update the tests to expect the prefix**

In `app/tests/unit/crypto-map.test.ts`, every `mapCycleToTrade(cycle(...), { userId, isPublic })` call gains `exchange: 'binance'`, and the `broker_deal_id` expectation changes from `'fill-9'` to `'binance:fill-9'`. Concretely, change the option objects `{ userId: 'u1', isPublic: true }` → `{ userId: 'u1', isPublic: true, exchange: 'binance' }` (and the `isPublic: false` variant likewise), and update the first test's assertion:

```ts
    expect(mapCycleToTrade(cycle(), { userId: 'u1', isPublic: true, exchange: 'binance' })).toMatchObject({
      user_id: 'u1', broker_deal_id: 'binance:fill-9', source: 'broker',
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/unit/crypto-map.test.ts`
Expected: FAIL — TypeScript/assert: `exchange` missing in the type, and `broker_deal_id` is `'fill-9'` not `'binance:fill-9'`.

- [ ] **Step 3: Implement**

In `app/src/lib/crypto/map.ts`, change the signature and the one field:

```ts
export function mapCycleToTrade(
  cycle: Cycle,
  opts: { userId: string; isPublic: boolean; exchange: string },
): Record<string, unknown> {
```

and

```ts
    broker_deal_id: `${opts.exchange}:${cycle.dedupeId}`,
```

Leave everything else in the file unchanged.

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/unit/crypto-map.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/crypto/map.ts app/tests/unit/crypto-map.test.ts
git commit -m "feat(crypto): namespace broker_deal_id by exchange (binance:<id>)"
```

---

### Task 4: `exchange-symbols.ts` — validate the pair list

**Files:**
- Create: `app/src/lib/crypto/exchange-symbols.ts`
- Test: `app/tests/unit/exchange-symbols.test.ts`

**Interfaces:**
- Consumes: `splitSymbol` (`@/lib/crypto/symbols`).
- Produces: `validatePairs(raw: string[]): { pairs: string[]; invalid: string[] }` — upper-cased, de-duplicated, splittable pairs kept in exchange form; unsplittable inputs collected as `invalid`.

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/exchange-symbols.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validatePairs } from '@/lib/crypto/exchange-symbols'

describe('validatePairs', () => {
  it('keeps splittable pairs in exchange form, upper-cased', () => {
    expect(validatePairs(['btc/usdt', 'ETH/USDT'])).toEqual({
      pairs: ['BTC/USDT', 'ETH/USDT'], invalid: [],
    })
  })
  it('de-duplicates', () => {
    expect(validatePairs(['BTC/USDT', 'btc/usdt']).pairs).toEqual(['BTC/USDT'])
  })
  it('collects unsplittable inputs as invalid', () => {
    const r = validatePairs(['BTC/USDT', 'garbage'])
    expect(r.pairs).toEqual(['BTC/USDT'])
    expect(r.invalid).toEqual(['garbage'])
  })
  it('ignores blank entries', () => {
    expect(validatePairs(['', '  ', 'BTC/USDT']).pairs).toEqual(['BTC/USDT'])
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/unit/exchange-symbols.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement**

Create `app/src/lib/crypto/exchange-symbols.ts`:

```ts
import { splitSymbol } from '@/lib/crypto/symbols'

// Validates a user-entered pair list for the connect form. Pairs are kept in
// EXCHANGE form (BTC/USDT) because that is what CCXT is handed; normalization
// to BTC/USD happens later, only in mapCycleToTrade.
export function validatePairs(raw: string[]): { pairs: string[]; invalid: string[] } {
  const pairs: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const s = entry.trim().toUpperCase()
    if (!s) continue
    if (!splitSymbol(s)) { invalid.push(entry.trim()); continue }
    if (seen.has(s)) continue
    seen.add(s)
    pairs.push(s)
  }
  return { pairs, invalid }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/unit/exchange-symbols.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/crypto/exchange-symbols.ts app/tests/unit/exchange-symbols.test.ts
git commit -m "feat(crypto): validate the connect-form pair list"
```

---

### Task 5: `crypto-sync.ts` — pure import planner

**Files:**
- Create: `app/src/lib/server/crypto-sync.ts`
- Test: `app/tests/unit/crypto-sync.test.ts`

**Interfaces:**
- Consumes: `Fill`, `rollupFills` (`@/lib/crypto/fills`); `mapCycleToTrade` (`@/lib/crypto/map`).
- Produces: `planImport(fills: Fill[], opts: { userId: string; isPublic: boolean; exchange: string }): { rows: Record<string, unknown>[]; cursor: number | null; warnings: string[] }` — pure: rollup → map → rows, plus the new cursor (max fill timestamp seen, or null if no fills).

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/crypto-sync.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { planImport } from '@/lib/server/crypto-sync'
import type { Fill } from '@/lib/crypto/fills'

const f = (o: Partial<Fill> & { id: string; side: 'buy' | 'sell'; price: number; amount: number; timestamp: number }): Fill => ({
  symbol: 'BTC/USDT', ...o,
})

describe('planImport', () => {
  it('rolls a closed cycle into one prefixed, broker-sourced row', () => {
    const res = planImport([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1000 }),
      f({ id: '2', side: 'sell', price: 110, amount: 1, timestamp: 2000 }),
    ], { userId: 'u1', isPublic: true, exchange: 'binance' })
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0]).toMatchObject({
      user_id: 'u1', broker_deal_id: 'binance:2', source: 'broker',
      instrument: 'BTC/USD', pnl_amount: 10, status: 'closed',
    })
  })

  it('reports the cursor as the max fill timestamp', () => {
    const res = planImport([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1000 }),
      f({ id: '2', side: 'sell', price: 110, amount: 1, timestamp: 5000 }),
    ], { userId: 'u1', isPublic: true, exchange: 'binance' })
    expect(res.cursor).toBe(5000)
  })

  it('emits no rows and a null cursor for no fills', () => {
    const res = planImport([], { userId: 'u1', isPublic: true, exchange: 'binance' })
    expect(res.rows).toEqual([])
    expect(res.cursor).toBeNull()
  })

  it('still advances the cursor when fills are all still-open (no closed cycle)', () => {
    const res = planImport([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 4000 }),
    ], { userId: 'u1', isPublic: true, exchange: 'binance' })
    expect(res.rows).toEqual([])
    expect(res.cursor).toBe(4000) // so the open position isn't re-fetched from scratch next run
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/unit/crypto-sync.test.ts`
Expected: FAIL — cannot resolve `@/lib/server/crypto-sync`.

- [ ] **Step 3: Implement**

Create `app/src/lib/server/crypto-sync.ts`:

```ts
import 'server-only'
import { rollupFills, type Fill } from '@/lib/crypto/fills'
import { mapCycleToTrade } from '@/lib/crypto/map'

// Pure core: fills -> journal rows + the new cursor. No DB, no network, so it
// is fully unit-testable. The cursor is the max fill timestamp seen (even when
// no cycle closed), so an open position is never re-fetched from scratch.
export function planImport(
  fills: Fill[],
  opts: { userId: string; isPublic: boolean; exchange: string },
): { rows: Record<string, unknown>[]; cursor: number | null; warnings: string[] } {
  const { cycles, warnings } = rollupFills(fills)
  const rows = cycles.map((c) => mapCycleToTrade(c, opts))
  const cursor = fills.length ? Math.max(...fills.map((f) => f.timestamp)) : null
  return { rows, cursor, warnings }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/unit/crypto-sync.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/crypto-sync.ts app/tests/unit/crypto-sync.test.ts
git commit -m "feat(crypto): pure import planner (fills -> rows + cursor)"
```

---

### Task 6: `crypto-sync.ts` — the IO sync wrapper

**Files:**
- Modify: `app/src/lib/server/crypto-sync.ts`
- Test: `app/tests/unit/crypto-sync.test.ts`

**Interfaces:**
- Consumes: `planImport` (Task 5); `fetchFillsSince`, `type ExchangeCreds` (`@/lib/server/binance`); `decryptSecret` (`@/lib/server/secrets`); `insertSystemNotification` (`@/lib/notifications`).
- Produces:
  - `type ExchangeRow = { id: string; user_id: string; exchange: string; api_key_enc: string; api_secret_enc: string; symbols: string[]; last_fill_at: string | null }`
  - `type SyncDeps = { fetchFillsSince: typeof import('@/lib/server/binance').fetchFillsSince; decryptSecret: (enc: string) => Promise<string>; insertSystemNotification: typeof import('@/lib/notifications').insertSystemNotification }`
  - `syncExchangeAccount(svc: SupabaseClient, row: ExchangeRow, deps?: Partial<SyncDeps>): Promise<{ imported: number } | { error: string }>`

`svc` is a Supabase **service** client. `deps` defaults to the real functions; tests inject fakes. The wrapper decrypts the key, fetches each pair since the cursor, plans the import, upserts, advances `last_fill_at`, sets status, and notifies.

- [ ] **Step 1: Add the failing test**

Append to `app/tests/unit/crypto-sync.test.ts`:

```ts
import { syncExchangeAccount, type ExchangeRow } from '@/lib/server/crypto-sync'
import type { SupabaseClient } from '@supabase/supabase-js'

// Minimal fake service client capturing upserts + row updates.
function fakeSvc() {
  const calls = { upserted: [] as Record<string, unknown>[], updated: [] as Record<string, unknown>[] }
  const svc = {
    from(table: string) {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { is_public: true } }) }) }) }
      }
      if (table === 'trades') {
        return { upsert: (rows: Record<string, unknown>[]) => ({ select: async () => { calls.upserted.push(...rows); return { data: rows.map((_, i) => ({ id: `t${i}` })), error: null } } }) }
      }
      if (table === 'exchange_accounts') {
        return { update: (patch: Record<string, unknown>) => ({ eq: async () => { calls.updated.push(patch); return { error: null } } }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as unknown as SupabaseClient
  return { svc, calls }
}

const row = (o: Partial<ExchangeRow> = {}): ExchangeRow => ({
  id: 'row1', user_id: 'u1', exchange: 'binance',
  api_key_enc: 'KENC', api_secret_enc: 'SENC',
  symbols: ['BTC/USDT'], last_fill_at: null, ...o,
})

const okDeps = (fills: Parameters<typeof import('@/lib/crypto/fills')['rollupFills']>[0]) => ({
  decryptSecret: async (enc: string) => (enc === 'KENC' ? 'apikey' : 'apisecret'),
  fetchFillsSince: async () => fills,
  insertSystemNotification: async () => {},
})

describe('syncExchangeAccount', () => {
  it('imports fills, advances the cursor, and reports the count', async () => {
    const { svc, calls } = fakeSvc()
    const notes: string[] = []
    const res = await syncExchangeAccount(svc, row(), {
      ...okDeps([
        { id: '1', symbol: 'BTC/USDT', side: 'buy', price: 100, amount: 1, timestamp: 1000 },
        { id: '2', symbol: 'BTC/USDT', side: 'sell', price: 110, amount: 1, timestamp: 5000 },
      ]),
      insertSystemNotification: async (a) => { notes.push(a.type) },
    })
    expect(res).toEqual({ imported: 1 })
    expect(calls.upserted[0]).toMatchObject({ broker_deal_id: 'binance:2' })
    // cursor persisted as an ISO string of the max fill ts (5000ms)
    expect(calls.updated.at(-1)).toMatchObject({ status: 'active', sync_error: null })
    expect(String(calls.updated.at(-1)!.last_fill_at)).toBe(new Date(5000).toISOString())
    expect(notes).toContain('import_done')
  })

  it('on a fetch failure sets error status, notifies, and returns an error', async () => {
    const { svc, calls } = fakeSvc()
    const notes: string[] = []
    const res = await syncExchangeAccount(svc, row(), {
      decryptSecret: async () => 'x',
      fetchFillsSince: async () => { throw new Error('451 unavailable') },
      insertSystemNotification: async (a) => { notes.push(a.type) },
    })
    expect('error' in res).toBe(true)
    expect(calls.updated.at(-1)).toMatchObject({ status: 'error' })
    expect(notes).toContain('sync_failed')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/unit/crypto-sync.test.ts`
Expected: FAIL — `syncExchangeAccount` not exported.

- [ ] **Step 3: Implement**

Append to `app/src/lib/server/crypto-sync.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchFillsSince as realFetch, type ExchangeCreds } from '@/lib/server/binance'
import { decryptSecret as realDecrypt } from '@/lib/server/secrets'
import { insertSystemNotification as realNotify } from '@/lib/notifications'
import type { Fill } from '@/lib/crypto/fills'

export type ExchangeRow = {
  id: string; user_id: string; exchange: string
  api_key_enc: string; api_secret_enc: string
  symbols: string[]; last_fill_at: string | null
}

export type SyncDeps = {
  fetchFillsSince: (creds: ExchangeCreds, symbol: string, sinceMs: number | null) => Promise<Fill[]>
  decryptSecret: (enc: string) => Promise<string>
  insertSystemNotification: typeof realNotify
}

const defaultDeps: SyncDeps = {
  fetchFillsSince: (creds, symbol, since) => realFetch(creds, symbol, since),
  decryptSecret: realDecrypt,
  insertSystemNotification: realNotify,
}

export async function syncExchangeAccount(
  svc: SupabaseClient,
  row: ExchangeRow,
  overrides: Partial<SyncDeps> = {},
): Promise<{ imported: number } | { error: string }> {
  const deps = { ...defaultDeps, ...overrides }
  try {
    const creds: ExchangeCreds = {
      apiKey: await deps.decryptSecret(row.api_key_enc),
      apiSecret: await deps.decryptSecret(row.api_secret_enc),
    }
    const sinceMs = row.last_fill_at ? Date.parse(row.last_fill_at) : null

    const all: Fill[] = []
    for (const symbol of row.symbols) {
      const fills = await deps.fetchFillsSince(creds, symbol, sinceMs)
      all.push(...fills)
    }

    const { data: profile } = await svc
      .from('profiles').select('is_public').eq('id', row.user_id).single()
    const { rows, cursor } = planImport(all, {
      userId: row.user_id, isPublic: profile?.is_public ?? true, exchange: row.exchange,
    })

    let imported = 0
    if (rows.length > 0) {
      const { data, error } = await svc
        .from('trades')
        .upsert(rows, { onConflict: 'user_id,broker_deal_id', ignoreDuplicates: true })
        .select('id')
      if (error) throw new Error(error.message)
      imported = data?.length ?? 0
    }

    await svc.from('exchange_accounts').update({
      status: 'active',
      sync_error: null,
      last_sync_at: new Date().toISOString(),
      ...(cursor != null ? { last_fill_at: new Date(cursor).toISOString() } : {}),
    }).eq('id', row.id)

    if (imported > 0) {
      await deps.insertSystemNotification({ supabase: svc, userId: row.user_id, type: 'import_done' })
    }
    return { imported }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sync failed'
    await svc.from('exchange_accounts').update({ status: 'error', sync_error: msg }).eq('id', row.id)
    await deps.insertSystemNotification({ supabase: svc, userId: row.user_id, type: 'sync_failed' })
    return { error: msg }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/unit/crypto-sync.test.ts`
Expected: PASS, 6 tests total.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/crypto-sync.ts app/tests/unit/crypto-sync.test.ts
git commit -m "feat(crypto): IO sync wrapper (decrypt, fetch, upsert, notify)"
```

---

### Task 7: `0038_exchange_symbols.sql` — the pair-list column

**Files:**
- Create: `app/supabase/migrations/0038_exchange_symbols.sql`

**Interfaces:**
- Consumes: the `exchange_accounts` table (`0037`).
- Produces: `exchange_accounts.symbols text[]`.

- [ ] **Step 1: Write the migration**

Create `app/supabase/migrations/0038_exchange_symbols.sql`:

```sql
-- Crypto sync phase 1: the pairs to query on exchanges that need a per-symbol
-- fetch (Binance). Stored in exchange form (e.g. 'BTC/USDT').
alter table public.exchange_accounts
  add column if not exists symbols text[] not null default '{}';
```

- [ ] **Step 2: Apply to the dev project**

Apply against the **dev** Supabase project (`sixixw…`), not prod: Supabase MCP `apply_migration` if authorized, else paste into the dev SQL editor and run. Re-running is safe (`if not exists`).

- [ ] **Step 3: Verify the column landed**

Run in the dev SQL editor:
```sql
select column_name, data_type from information_schema.columns
where table_name = 'exchange_accounts' and column_name = 'symbols';
```
Expected: one row, `symbols`, `ARRAY`.

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0038_exchange_symbols.sql
git commit -m "feat(crypto): exchange_accounts.symbols pair-list column"
```

---

### Task 8: `actions/exchange.ts` — connect / disconnect / sync now

**Files:**
- Create: `app/src/app/actions/exchange.ts`
- Test: none (mirrors `actions/broker.ts`, which has no unit test; the CCXT + Supabase orchestration is covered by the Task 10 manual e2e). The pure pieces it uses (`validatePairs`, `verifyReadOnly`, `syncExchangeAccount`) are already unit-tested in Tasks 1/4/6.

**Interfaces:**
- Consumes: `verifyReadOnly`, `type ExchangeCreds` (`@/lib/server/binance`); `validatePairs` (`@/lib/crypto/exchange-symbols`); `encryptSecret` (`@/lib/server/secrets`); `syncExchangeAccount`, `type ExchangeRow` (`@/lib/server/crypto-sync`); `createServiceClient` (`@/lib/supabase/service`); the gate trio.
- Produces:
  - `type ExchangeState = { ok?: boolean; error?: string }`
  - `connectExchange(_prev: ExchangeState, formData: FormData): Promise<ExchangeState>`
  - `disconnectExchange(): Promise<ExchangeState>`
  - `type SyncNowResult = { imported?: number; error?: string }`
  - `syncNow(): Promise<SyncNowResult>`

- [ ] **Step 1: Implement**

Create `app/src/app/actions/exchange.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { verifyReadOnly, type ExchangeCreds } from '@/lib/server/binance'
import { validatePairs } from '@/lib/crypto/exchange-symbols'
import { encryptSecret } from '@/lib/server/secrets'
import { syncExchangeAccount, type ExchangeRow } from '@/lib/server/crypto-sync'

export type ExchangeState = { ok?: boolean; error?: string }
const IMPORT_GATE = 'Crypto sync is available on the Trader plan and above.'

async function gateImport(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string | null> {
  const tier = await getTier(supabase, userId)
  const flags = await getFeatureFlags()
  return canFlag(flags, tier, 'crypto_import') ? null : IMPORT_GATE
}

export async function connectExchange(_prev: ExchangeState, formData: FormData): Promise<ExchangeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gateErr = await gateImport(supabase, user.id)
  if (gateErr) return { error: gateErr }

  const apiKey = String(formData.get('apiKey') ?? '').trim()
  const apiSecret = String(formData.get('apiSecret') ?? '').trim()
  if (!apiKey || !apiSecret) return { error: 'API key and secret are required.' }

  const { pairs, invalid } = validatePairs(String(formData.get('symbols') ?? '').split(','))
  if (pairs.length === 0) return { error: 'Add at least one valid pair (e.g. BTC/USDT).' }
  if (invalid.length > 0) return { error: `Not a valid pair: ${invalid.join(', ')}` }

  const { data: existing } = await supabase
    .from('exchange_accounts').select('id').eq('user_id', user.id).eq('exchange', 'binance').maybeSingle()
  if (existing) return { error: 'Binance is already connected. Disconnect it first.' }

  const creds: ExchangeCreds = { apiKey, apiSecret }
  const verdict = await verifyReadOnly(creds)
  if (!verdict.ok) return { error: verdict.reason }

  const { error } = await supabase.from('exchange_accounts').insert({
    user_id: user.id, exchange: 'binance', status: 'active', symbols: pairs,
    api_key_enc: await encryptSecret(apiKey),
    api_secret_enc: await encryptSecret(apiSecret),
  })
  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { ok: true }
}

export async function disconnectExchange(): Promise<ExchangeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const { error } = await supabase
    .from('exchange_accounts').delete().eq('user_id', user.id).eq('exchange', 'binance')
  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { ok: true }
}

export type SyncNowResult = { imported?: number; error?: string }

export async function syncNow(): Promise<SyncNowResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gateErr = await gateImport(supabase, user.id)
  if (gateErr) return { error: gateErr }

  // The service client is the only role that can read the *_enc columns.
  const svc = createServiceClient()
  const { data: row } = await svc
    .from('exchange_accounts')
    .select('id, user_id, exchange, api_key_enc, api_secret_enc, symbols, last_fill_at')
    .eq('user_id', user.id).eq('exchange', 'binance').maybeSingle()
  if (!row) return { error: 'No exchange connected.' }

  const res = await syncExchangeAccount(svc, row as ExchangeRow)
  revalidatePath('/journal')
  revalidatePath('/settings')
  return 'error' in res ? { error: res.error } : { imported: res.imported }
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: compiles. (No unit test for this file — verified end-to-end in Task 10.)

- [ ] **Step 3: Commit**

```bash
git add app/src/app/actions/exchange.ts
git commit -m "feat(crypto): connect/disconnect/sync-now server actions"
```

---

### Task 9: `ExchangeCard.tsx` + settings wiring

**Files:**
- Create: `app/src/app/settings/ExchangeCard.tsx`
- Modify: `app/src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `connectExchange`, `disconnectExchange`, `syncNow`, `type ExchangeState` (`@/app/actions/exchange`); the settings page's existing `tier`/`flags` for the gate.
- Produces: `type ExchangeRowView = { status: string; symbols: string[]; last_sync_at: string | null; sync_error: string | null }`; `<ExchangeCard row={ExchangeRowView | null} canImport={boolean} />`.

- [ ] **Step 1: Implement the card**

Create `app/src/app/settings/ExchangeCard.tsx`:

```tsx
'use client'

import { useActionState, useState, useTransition } from 'react'
import { connectExchange, disconnectExchange, syncNow, type ExchangeState } from '@/app/actions/exchange'
import { Icon } from '@/app/[username]/_components/Icon'

export type ExchangeRowView = {
  status: string; symbols: string[]
  last_sync_at: string | null; sync_error: string | null
}

const MAJORS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'DOGE/USDT', 'ADA/USDT']

export function ExchangeCard({ row, canImport }: { row: ExchangeRowView | null; canImport: boolean }) {
  const [state, formAction, pending] = useActionState<ExchangeState, FormData>(connectExchange, {})
  const [picked, setPicked] = useState<Set<string>>(new Set(MAJORS.slice(0, 3)))
  const [extra, setExtra] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [discErr, setDiscErr] = useState('')
  const [discPending, startDisc] = useTransition()
  const [syncing, startSync] = useTransition()
  const [syncMsg, setSyncMsg] = useState('')

  if (!canImport) {
    return (
      <section id="exchange" className="ts-card settings-section">
        <h2 className="ts-h2"><Icon name="bolt" size={18} /> Crypto exchange sync</h2>
        <p className="ts-sub mt-2">Connect Binance with a read-only API key and your trades land in the journal.</p>
        <a href="/settings/billing" className="btn btn-primary mt-4">Upgrade to Trader</a>
      </section>
    )
  }

  if (row) {
    const synced = row.last_sync_at ? new Date(row.last_sync_at).toLocaleString() : 'not yet'
    return (
      <section id="exchange" className="ts-card settings-section">
        <h2 className="ts-h2"><Icon name="bolt" size={18} /> Crypto exchange sync</h2>
        <p className="ts-sub mt-2">
          <strong>Binance</strong>{' · '}status: {row.status}{' · '}last synced: {synced}
        </p>
        <p className="faint mt-1" style={{ fontSize: 12 }}>Pairs: {row.symbols.join(', ') || '—'}</p>
        {row.sync_error && <p className="ts-error mt-2">{row.sync_error}</p>}
        {syncMsg && <p className="ts-sub mt-2">{syncMsg}</p>}
        {discErr && <p className="ts-error mt-2">{discErr}</p>}
        <div className="mt-4" style={{ display: 'flex', gap: 8 }}>
          <button
            type="button" className="btn btn-primary" disabled={syncing}
            onClick={() => startSync(async () => {
              setSyncMsg('')
              const r = await syncNow()
              setSyncMsg(r.error ? '' : `Imported ${r.imported} trade${r.imported === 1 ? '' : 's'}.`)
              if (r.error) setDiscErr(r.error)
            })}
          >{syncing ? 'Syncing…' : 'Sync now'}</button>
          {confirming ? (
            <>
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={discPending}>Cancel</button>
              <button
                type="button" className="btn" disabled={discPending}
                onClick={() => startDisc(async () => {
                  const r = await disconnectExchange()
                  if (r.error) { setDiscErr(r.error); setConfirming(false) }
                })}
              >{discPending ? 'Disconnecting…' : 'Yes, disconnect'}</button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirming(true)}>Disconnect</button>
          )}
        </div>
      </section>
    )
  }

  const symbols = [...picked, ...extra.split(',').map((s) => s.trim()).filter(Boolean)].join(',')
  return (
    <section id="exchange" className="ts-card settings-section">
      <h2 className="ts-h2"><Icon name="bolt" size={18} /> Crypto exchange sync</h2>
      <p className="ts-sub mt-2">
        Paste a <strong>read-only</strong> Binance API key (enable “Reading” only — not trading or withdrawals).
        We store it encrypted and it can never move funds.
      </p>
      <form action={formAction} className="mt-4">
        <input type="hidden" name="symbols" value={symbols} />
        <label className="ts-field"><span className="ts-label">API key</span>
          <input name="apiKey" className="ts-input" autoComplete="off" required /></label>
        <label className="ts-field mt-3"><span className="ts-label">API secret</span>
          <input name="apiSecret" type="password" className="ts-input" autoComplete="off" required /></label>
        <div className="ts-field mt-3">
          <span className="ts-label">Pairs to sync</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {MAJORS.map((p) => (
              <label key={p} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="checkbox" checked={picked.has(p)}
                  onChange={(e) => {
                    const next = new Set(picked)
                    if (e.target.checked) next.add(p); else next.delete(p)
                    setPicked(next)
                  }}
                />{p}
              </label>
            ))}
          </div>
          <input
            className="ts-input mt-2" placeholder="Add more, comma-separated (e.g. LINK/USDT, AVAX/USDT)"
            value={extra} onChange={(e) => setExtra(e.target.value)}
          />
        </div>
        {state.error && <p className="ts-error mt-3">{state.error}</p>}
        <button className="btn btn-primary mt-4" disabled={pending}>{pending ? 'Connecting…' : 'Connect Binance'}</button>
      </form>
    </section>
  )
}
```

- [ ] **Step 2: Wire it into the settings page**

In `app/src/app/settings/page.tsx`: add an `exchange_accounts` fetch beside the existing `broker_accounts` fetch, and render `<ExchangeCard>` beside `<BrokerCard>`.

Add the import near the `BrokerCard` import:
```ts
import { ExchangeCard } from './ExchangeCard'
```
Add to the `Promise.all([...])` block (mirroring the `broker_accounts` entry):
```ts
    supabase
      .from('exchange_accounts')
      .select('status, symbols, last_sync_at, sync_error')
      .eq('user_id', user.id).eq('exchange', 'binance')
      .maybeSingle(),
```
Bind its result (follow the file's existing destructuring style for the `Promise.all` results — add a `exchangeRow` entry in the same order you added the query). Then render it right after the `<BrokerCard ... />` line:
```tsx
            <ExchangeCard row={exchangeRow} canImport={canFlag(flags, tier, 'crypto_import')} />
```

- [ ] **Step 3: Verify in preview + build**

Run: `npm run build` — expected: compiles.
Then start the dev server and open `/settings` as a Trader-tier user; confirm the card renders with the pair checkboxes and connect form, and the locked state shows for a free user. (Screenshots in Task 10.)

- [ ] **Step 4: Commit**

```bash
git add app/src/app/settings/ExchangeCard.tsx app/src/app/settings/page.tsx
git commit -m "feat(crypto): exchange connect card in settings"
```

---

### Task 10: Autosync route + GitHub Actions workflow

**Files:**
- Create: `app/src/app/api/cron/crypto-sync/route.ts`
- Create: `.github/workflows/crypto-sync.yml`

**Interfaces:**
- Consumes: `authorizedCron` (`@/lib/cron`); `createServiceClient` (`@/lib/supabase/service`); `syncExchangeAccount`, `type ExchangeRow` (`@/lib/server/crypto-sync`); the gate trio.
- Produces: `GET /api/cron/crypto-sync` (cron-authorized JSON), driven daily by the workflow.

- [ ] **Step 1: Implement the route**

Create `app/src/app/api/cron/crypto-sync/route.ts`:

```ts
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
```

- [ ] **Step 2: Create the workflow**

Create `.github/workflows/crypto-sync.yml`:

```yaml
# Daily crypto (Binance) sync. Vercel Hobby crons are daily-only and both slots
# are used, so — like mt5-sync.yml — GitHub Actions drives this instead.
# Requires repo secret CRON_SECRET matching the Vercel env var of the same name.
name: Crypto sync

on:
  schedule:
    - cron: '0 6 * * *'
  workflow_dispatch:

concurrency:
  group: crypto-sync
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Call crypto-sync route
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          code=$(curl -sS -o /tmp/out -w '%{http_code}' \
            -H "Authorization: Bearer ${CRON_SECRET}" \
            "https://app.tradingsocial.io/api/cron/crypto-sync")
          cat /tmp/out; echo
          echo "HTTP ${code}"
          test "${code}" = "200"
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: compiles; the new route appears in the build output.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/api/cron/crypto-sync/route.ts .github/workflows/crypto-sync.yml
git commit -m "feat(crypto): daily autosync route + github actions workflow"
```

---

### Task 11: Full verification + manual end-to-end confirmation

**Files:** none (verification only).

- [ ] **Step 1: Unit suite**

Run (from `app/`): `npm test`
Expected: all pass, including `binance`, `crypto-sync`, `exchange-symbols`, and the updated `crypto-map`.

- [ ] **Step 2: Type check + build**

Run (from `app/`): `npx tsc --noEmit` then `npm run build`
Expected: both clean.

- [ ] **Step 3: Secret-leak grep**

From repo root:
```bash
git log -p $(git merge-base main HEAD)..HEAD | grep -iE "apiKey|apiSecret" | grep -v "formData|name=|apiKey:|apiSecret:|'apiKey'|'apiSecret'" || echo "clean"
```
Expected: no line containing a real key value (only code identifiers).

- [ ] **Step 4: Manual end-to-end (human, deployed env)**

This gates Task 12. On the deployed app with a **real read-only Binance key**:
1. Connect Binance in `/settings` with a read-only key + a couple of pairs. Confirm a key that has trading/withdrawal enabled is **rejected** with the scope message.
2. Confirm the connect call reaches Binance (no HTTP 451). If 451 appears, change `preferredRegion` in the route (and, if the connect action itself 451s, pin the settings segment's region or move `verifyReadOnly` into a region-pinned route handler), redeploy, retest — this is the region confirmation the design flagged.
3. Click **Sync now**; confirm real closed trades appear in the journal, P&L looks right, and a second Sync now imports 0 (idempotent).
4. Trigger the workflow via `workflow_dispatch`; confirm HTTP 200 and that it syncs.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "test: verify crypto sync phase 1 end to end"
```

---

### Task 12: Rollout — marketing + admin (GATED on Task 11 confirmation)

**Do not start until the Task 11 Step 4 end-to-end confirmation has passed on the deployed env.**

**Files:**
- Modify: `app/src/app/admin/features/page.tsx`
- Modify: `pricing.html`

**Interfaces:**
- Consumes: the now-live `crypto_import` / `crypto_autosync` flags.
- Produces: crypto sync visible in the admin flag matrix and on the pricing page.

- [ ] **Step 1: Wire the flags into the admin matrix**

In `app/src/app/admin/features/page.tsx`:
- Add `'crypto_import'` and `'crypto_autosync'` to the `WIRED` set (they now have live `canFlag` call sites).
- Add them to the `GROUPS` entry titled `'Trading Journal'`, right after `'mt5_autosync'`:
```ts
  { title: 'Trading Journal', keys: ['journal_unlimited', 'advanced_journal', 'strategy_tracking', 'mistake_tagging', 'risk_tracking', 'private_notes', 'custom_templates', 'export_journal', 'mt5_import', 'mt5_autosync', 'crypto_import', 'crypto_autosync'] },
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: compiles; `/admin/features` lists the two crypto rows as wired.

- [ ] **Step 3: Add the pricing rows**

In `pricing.html`, in the Trading Journal feature section (where the MT5 rows live), add two rows mirroring the existing MT5 markup: "Crypto exchange sync (Binance)" available on **Trader**, and "Crypto auto-sync (daily)" available on **Pro**. Match the surrounding row markup exactly (same cells/checkmark classes as the `mt5` rows).

- [ ] **Step 4: Verify pricing renders**

Open `pricing.html` in the preview; confirm the two new rows appear in the Trading Journal section with the right tier ticks and no layout break.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/admin/features/page.tsx pricing.html
git commit -m "feat(crypto): surface crypto sync in admin flags + pricing"
```

---

## Self-Review

**Spec coverage:**
- `binance.ts` verifyReadOnly (hard-reject withdraw/trade) → Task 1. ✓
- `binance.ts` fetchFillsSince (per-pair, paged, backfill floor) → Task 2. ✓
- Dedupe prefix `binance:<id>` in `mapCycleToTrade` → Task 3. ✓
- Pair-list validation → Task 4; stored in exchange form → Tasks 4/7/8. ✓
- Sync engine: pure `planImport` → Task 5; IO `syncExchangeAccount` (decrypt via service client, upsert idempotent, cursor advance, notify, failure isolation) → Task 6. ✓
- `symbols text[]` migration → Task 7. ✓
- connect (scope-check before store) / disconnect / syncNow, gated on `crypto_import` → Task 8. ✓
- Settings connect card + pair picker + Sync now → Task 9. ✓
- Autosync route (region-pinned, per-row `crypto_autosync` gate) + GitHub Actions workflow → Task 10. ✓
- Verification + manual e2e (region + scope confirmed live) → Task 11. ✓
- Rollout gated on live confirmation (admin + pricing) → Task 12. ✓
- MT5 path untouched → Global Constraints + no task edits those files. ✓
- No `trades` migration; `source:'broker'`; upsert onConflict `user_id,broker_deal_id` → Tasks 3/5/6. ✓

**Type consistency:** `Fill` and `Cycle` come from Phase 0 verbatim. `ExchangeCreds` (Task 1) is consumed unchanged in Tasks 2/6/8. `fetchFillsSince(creds, symbol, sinceMs, client?)` signature identical across Tasks 2/6. `mapCycleToTrade(cycle, { userId, isPublic, exchange })` identical in Tasks 3/5. `ExchangeRow` (Task 6) matches the select column list in Tasks 8/10. `syncExchangeAccount(svc, row, overrides?)` identical in Tasks 6/8/10. `planImport(fills, { userId, isPublic, exchange })` identical in Tasks 5/6.

**Placeholder scan:** no TBD/TODO; every code step carries full code; the region value (`sin1`) is a concrete default with an explicit live-verification step (Task 11), not a placeholder.

**Scope:** one feature (Binance sync), one plan, 12 tasks, ending in a gated rollout. Other exchanges are explicitly out of scope.
