# Crypto Sync Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the storage, encryption, and normalization plumbing a read-only exchange key sync needs, so Phase 1 only has to add CCXT and a form.

**Architecture:** Three pure modules under `app/src/lib/crypto/` (symbol normalization, fills→round-trip rollup, trade mapping) plus one server-only AES-256-GCM envelope module, and a new `exchange_accounts` table holding encrypted keys. No CCXT dependency, no UI, no network call in this phase.

**Tech Stack:** Next.js 15 / React 19, TypeScript, Supabase Postgres, Vitest (`npm test` = `vitest run`), Node `webcrypto`.

**Spec:** `docs/superpowers/specs/2026-07-24-crypto-sync-phase0-design.md`

## Global Constraints

- All commands run from `app/` unless stated otherwise. `npm test` runs the full unit suite; there is no watch mode in CI.
- Unit tests live in `app/tests/unit/<name>.test.ts` and import source via the `@/` alias (`@/lib/crypto/symbols`). `server-only` is aliased to a mock in `vitest.config.ts`, so server modules are unit-testable.
- Do not modify the MT5 path: `src/lib/mt5.ts`, `src/app/actions/mt5-import.ts`, `src/app/api/mt5-sync/**`, `supabase/migrations/0018_mt5_import.sql`, `supabase/migrations/0019_broker_accounts.sql`.
- No `trades` schema change in this phase. Fees net into `pnl_amount`.
- `trades.source` value for crypto rows is `'broker'` — do not add a new enum value.
- Stable quote set, exact: `USDT`, `USDC`, `BUSD`, `FDUSD`, `TUSD`, `DAI`.
- Flat tolerance, exact: `1e-8`.
- Ciphertext format, exact: `v1.<base64 iv>.<base64 ciphertext+tag>`.
- Env var name, exact: `EXCHANGE_KEY_SECRET` (base64, decodes to 32 bytes).
- Never log, return, or embed in an error message either the plaintext secret or its ciphertext.
- Migrations are applied to the **dev** Supabase project only in this phase. Prod is deferred to Phase 1.

**Deviation from the spec, deliberate:** the spec lists `fills.ts` as dependency-free. It imports `quoteCurrency` and `normalizeCurrency` from `symbols.ts` so the stable-coin list exists in exactly one place. Build Task 2 before Task 3.

## File Structure

| File | Responsibility |
|---|---|
| Create `app/src/lib/server/secrets.ts` | Generic AES-256-GCM string envelope. Knows nothing about crypto exchanges. |
| Create `app/src/lib/crypto/symbols.ts` | Exchange symbol → catalog instrument; currency helpers. |
| Create `app/src/lib/crypto/fills.ts` | Fills → closed round-trip cycles. |
| Create `app/src/lib/crypto/map.ts` | Cycle → `trades` row. |
| Create `app/supabase/migrations/0037_exchange_accounts.sql` | Connection table, RLS, column-level revoke. |
| Modify `app/src/lib/entitlements.ts` | Add `crypto_import` / `crypto_autosync` flags. |
| Modify `app/src/lib/instruments.ts` | Add five crypto catalog entries. |
| Create `app/tests/unit/secrets.test.ts` | Roundtrip, tamper, env failure. |
| Create `app/tests/unit/crypto-symbols.test.ts` | Normalization cases. |
| Create `app/tests/unit/crypto-fills.test.ts` | Rollup cases. |
| Create `app/tests/unit/crypto-map.test.ts` | Row shape. |
| Modify `app/tests/unit/instruments.test.ts` | Assert new entries. |

---

### Task 1: `secrets.ts` — AES-256-GCM envelope

**Files:**
- Create: `app/src/lib/server/secrets.ts`
- Test: `app/tests/unit/secrets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `encryptSecret(plain: string): Promise<string>` and `decryptSecret(enc: string): Promise<string>`. Phase 1 uses both; nothing else in Phase 0 does.

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/secrets.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { encryptSecret, decryptSecret } from '@/lib/server/secrets'

// 32 zero bytes, base64. Test-only key.
const KEY = Buffer.alloc(32, 7).toString('base64')
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64')

describe('secrets', () => {
  beforeEach(() => { vi.stubEnv('EXCHANGE_KEY_SECRET', KEY) })
  afterEach(() => { vi.unstubAllEnvs() })

  it('roundtrips a secret', async () => {
    const enc = await encryptSecret('binance-api-key-123')
    expect(await decryptSecret(enc)).toBe('binance-api-key-123')
  })

  it('emits the v1.<iv>.<ct> format and never the plaintext', async () => {
    const enc = await encryptSecret('binance-api-key-123')
    const parts = enc.split('.')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('v1')
    expect(enc).not.toContain('binance-api-key-123')
  })

  it('uses a fresh IV per call', async () => {
    const a = await encryptSecret('same')
    const b = await encryptSecret('same')
    expect(a).not.toBe(b)
    expect(await decryptSecret(b)).toBe('same')
  })

  it('rejects tampered ciphertext', async () => {
    const enc = await encryptSecret('tamper-me')
    const [v, iv, ct] = enc.split('.')
    const flipped = Buffer.from(ct, 'base64')
    flipped[0] ^= 0xff
    await expect(decryptSecret(`${v}.${iv}.${flipped.toString('base64')}`))
      .rejects.toThrow('authentication failed')
  })

  it('rejects a malformed envelope', async () => {
    await expect(decryptSecret('not-an-envelope')).rejects.toThrow('malformed')
    await expect(decryptSecret('v2.aaaa.bbbb')).rejects.toThrow('malformed')
  })

  it('rejects the wrong master key', async () => {
    const enc = await encryptSecret('wrong-key-test')
    vi.stubEnv('EXCHANGE_KEY_SECRET', OTHER_KEY)
    await expect(decryptSecret(enc)).rejects.toThrow('authentication failed')
  })

  it('throws when the env var is missing', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', '')
    await expect(encryptSecret('x')).rejects.toThrow('EXCHANGE_KEY_SECRET')
  })

  it('throws when the env var is not 32 bytes', async () => {
    vi.stubEnv('EXCHANGE_KEY_SECRET', Buffer.alloc(16, 1).toString('base64'))
    await expect(encryptSecret('x')).rejects.toThrow('32 bytes')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/unit/secrets.test.ts`
Expected: FAIL — cannot resolve `@/lib/server/secrets`.

- [ ] **Step 3: Implement**

Create `app/src/lib/server/secrets.ts`:

```ts
import 'server-only'
import { webcrypto } from 'node:crypto'

// AES-256-GCM envelope for user secrets (exchange API keys). The master key
// lives only in the environment — never in Postgres — so a database dump on
// its own is inert. Fails closed: there is no plaintext fallback path, and
// neither plaintext nor ciphertext is ever put in an error message.
const VERSION = 'v1'
const IV_BYTES = 12

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

async function masterKey(): Promise<CryptoKey> {
  const raw = process.env.EXCHANGE_KEY_SECRET
  if (!raw) throw new Error('EXCHANGE_KEY_SECRET is not set')
  const bytes = unb64(raw)
  if (bytes.length !== 32) throw new Error('EXCHANGE_KEY_SECRET must decode to 32 bytes')
  return webcrypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptSecret(plain: string): Promise<string> {
  if (!plain) throw new Error('encryptSecret: empty input')
  const key = await masterKey()
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = new Uint8Array(
    await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)),
  )
  return `${VERSION}.${b64(iv)}.${b64(ct)}`
}

export async function decryptSecret(enc: string): Promise<string> {
  const parts = enc.split('.')
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error('decryptSecret: malformed envelope')
  }
  const key = await masterKey()
  let plain: ArrayBuffer
  try {
    plain = await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(parts[1]) }, key, unb64(parts[2]),
    )
  } catch {
    throw new Error('decryptSecret: authentication failed')
  }
  return new TextDecoder().decode(plain)
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/unit/secrets.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add the env var locally**

Generate a key and append it to `app/.env.local` (do not commit `.env.local`):

```bash
node -e "console.log('EXCHANGE_KEY_SECRET=' + require('crypto').randomBytes(32).toString('base64'))"
```

Paste the printed line into `app/.env.local`. Report the fact that a key was generated — never paste the value into chat, a commit, or a log.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/server/secrets.ts app/tests/unit/secrets.test.ts
git commit -m "feat(secrets): AES-256-GCM envelope for user API secrets"
```

---

### Task 2: `symbols.ts` — exchange symbol normalization

**Files:**
- Create: `app/src/lib/crypto/symbols.ts`
- Test: `app/tests/unit/crypto-symbols.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `STABLE_QUOTES: readonly string[]`
  - `normalizeCurrency(ccy: string): string` — stable coin → `'USD'`, else upper-cased.
  - `splitSymbol(raw: string): { base: string; quote: string } | null`
  - `quoteCurrency(raw: string): string` — `''` when unsplittable.
  - `normalizeExchangeSymbol(raw: string): { instrument: string; market: 'crypto' }`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/crypto-symbols.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  normalizeExchangeSymbol, normalizeCurrency, quoteCurrency, STABLE_QUOTES,
} from '@/lib/crypto/symbols'

describe('normalizeCurrency', () => {
  it('maps every stable quote to USD', () => {
    for (const q of STABLE_QUOTES) expect(normalizeCurrency(q)).toBe('USD')
    expect(STABLE_QUOTES).toHaveLength(6)
  })
  it('upper-cases and leaves non-stables alone', () => {
    expect(normalizeCurrency('btc')).toBe('BTC')
    expect(normalizeCurrency('USD')).toBe('USD')
  })
})

describe('normalizeExchangeSymbol', () => {
  it('normalizes unified stable pairs to USD', () => {
    expect(normalizeExchangeSymbol('BTC/USDT')).toEqual({ instrument: 'BTC/USD', market: 'crypto' })
    expect(normalizeExchangeSymbol('BTC/USDC').instrument).toBe('BTC/USD')
    expect(normalizeExchangeSymbol('BTC/BUSD').instrument).toBe('BTC/USD')
    expect(normalizeExchangeSymbol('BTC/FDUSD').instrument).toBe('BTC/USD')
    expect(normalizeExchangeSymbol('BTC/TUSD').instrument).toBe('BTC/USD')
    expect(normalizeExchangeSymbol('BTC/DAI').instrument).toBe('BTC/USD')
  })
  it('handles the slashless exchange form', () => {
    expect(normalizeExchangeSymbol('BTCUSDT').instrument).toBe('BTC/USD')
    expect(normalizeExchangeSymbol('ETHUSD').instrument).toBe('ETH/USD')
    expect(normalizeExchangeSymbol('ETHBTC').instrument).toBe('ETH/BTC')
  })
  it('strips the CCXT futures settlement suffix', () => {
    expect(normalizeExchangeSymbol('BTC/USDT:USDT').instrument).toBe('BTC/USD')
  })
  it('keeps crypto-quoted pairs verbatim', () => {
    expect(normalizeExchangeSymbol('ETH/BTC').instrument).toBe('ETH/BTC')
  })
  it('upper-cases lowercase input', () => {
    expect(normalizeExchangeSymbol('sol/usdt').instrument).toBe('SOL/USD')
  })
  it('passes through an unsplittable symbol', () => {
    expect(normalizeExchangeSymbol('foobar').instrument).toBe('FOOBAR')
  })
})

describe('quoteCurrency', () => {
  it('extracts the quote from both forms', () => {
    expect(quoteCurrency('BTC/USDT')).toBe('USDT')
    expect(quoteCurrency('BTCUSDT')).toBe('USDT')
    expect(quoteCurrency('BTC/USDT:USDT')).toBe('USDT')
  })
  it('returns empty string when it cannot split', () => {
    expect(quoteCurrency('FOOBAR')).toBe('')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/unit/crypto-symbols.test.ts`
Expected: FAIL — cannot resolve `@/lib/crypto/symbols`.

- [ ] **Step 3: Implement**

Create `app/src/lib/crypto/symbols.ts`:

```ts
// Exchange symbols come in two shapes: the CCXT unified form ('BTC/USDT',
// futures 'BTC/USDT:USDT') and the raw exchange form ('BTCUSDT'). Stablecoin
// quotes all collapse to USD so one asset is one journal instrument — without
// this, BTC/USDT and BTC/USDC fragment every breakdown and leaderboard.
export const STABLE_QUOTES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'DAI'] as const

const KNOWN_QUOTES: readonly string[] = [...STABLE_QUOTES, 'USD', 'BTC', 'ETH', 'BNB', 'EUR', 'GBP']

export function normalizeCurrency(ccy: string): string {
  const c = ccy.trim().toUpperCase()
  return (STABLE_QUOTES as readonly string[]).includes(c) ? 'USD' : c
}

export function splitSymbol(raw: string): { base: string; quote: string } | null {
  const s = raw.trim().toUpperCase()
  if (!s) return null
  const slash = s.indexOf('/')
  if (slash > 0) {
    const quote = s.slice(slash + 1).split(':')[0]
    return quote ? { base: s.slice(0, slash), quote } : null
  }
  const quote = KNOWN_QUOTES
    .filter((k) => s.endsWith(k) && s.length > k.length)
    .sort((a, b) => b.length - a.length)[0]
  return quote ? { base: s.slice(0, s.length - quote.length), quote } : null
}

export function quoteCurrency(raw: string): string {
  return splitSymbol(raw)?.quote ?? ''
}

export type NormalizedSymbol = { instrument: string; market: 'crypto' }

export function normalizeExchangeSymbol(raw: string): NormalizedSymbol {
  const parts = splitSymbol(raw)
  if (!parts) return { instrument: raw.trim().toUpperCase(), market: 'crypto' }
  return { instrument: `${parts.base}/${normalizeCurrency(parts.quote)}`, market: 'crypto' }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/unit/crypto-symbols.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/crypto/symbols.ts app/tests/unit/crypto-symbols.test.ts
git commit -m "feat(crypto): normalize exchange symbols to catalog instruments"
```

---

### Task 3: `fills.ts` — roll fills into closed round trips

**Files:**
- Create: `app/src/lib/crypto/fills.ts`
- Test: `app/tests/unit/crypto-fills.test.ts`

**Interfaces:**
- Consumes: `quoteCurrency`, `normalizeCurrency` from Task 2.
- Produces:
  - `type Fill = { id: string; symbol: string; timestamp: number; side: 'buy' | 'sell'; price: number; amount: number; fee?: { cost: number; currency: string } | null }`
  - `type Cycle = { dedupeId: string; symbol: string; direction: 'long' | 'short'; size: number; entryPrice: number; exitPrice: number; fees: number; pnl: number; openedAt: string; closedAt: string }`
  - `rollupFills(fills: Fill[]): { cycles: Cycle[]; skippedOpen: number; warnings: string[] }`

`skippedOpen` counts **unclosed positions** (at most one per symbol), not unclosed fills.

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/crypto-fills.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rollupFills, type Fill } from '@/lib/crypto/fills'

const f = (o: Partial<Fill> & { id: string; side: 'buy' | 'sell'; price: number; amount: number }): Fill => ({
  symbol: 'BTC/USDT', timestamp: Date.parse('2026-07-01T00:00:00Z'), ...o,
})

describe('rollupFills', () => {
  it('emits one long cycle from a buy then a sell', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 2, timestamp: 1_000 }),
      f({ id: '2', side: 'sell', price: 110, amount: 2, timestamp: 2_000 }),
    ])
    expect(res.skippedOpen).toBe(0)
    expect(res.warnings).toEqual([])
    expect(res.cycles).toHaveLength(1)
    expect(res.cycles[0]).toMatchObject({
      dedupeId: '2', symbol: 'BTC/USDT', direction: 'long',
      size: 2, entryPrice: 100, exitPrice: 110, fees: 0, pnl: 20,
      openedAt: '1970-01-01T00:00:01.000Z', closedAt: '1970-01-01T00:00:02.000Z',
    })
  })

  it('weights entry and exit across multiple fills', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1 }),
      f({ id: '2', side: 'buy', price: 200, amount: 1, timestamp: 2 }),
      f({ id: '3', side: 'sell', price: 300, amount: 1, timestamp: 3 }),
      f({ id: '4', side: 'sell', price: 100, amount: 1, timestamp: 4 }),
    ])
    expect(res.cycles).toHaveLength(1)
    expect(res.cycles[0].entryPrice).toBeCloseTo(150)
    expect(res.cycles[0].exitPrice).toBeCloseTo(200)
    expect(res.cycles[0].pnl).toBeCloseTo(100)
    expect(res.cycles[0].dedupeId).toBe('4')
  })

  it('handles a short cycle (sell first)', () => {
    const res = rollupFills([
      f({ id: '1', side: 'sell', price: 110, amount: 2, timestamp: 1 }),
      f({ id: '2', side: 'buy', price: 100, amount: 2, timestamp: 2 }),
    ])
    expect(res.cycles[0]).toMatchObject({ direction: 'short', entryPrice: 110, exitPrice: 100 })
    expect(res.cycles[0].pnl).toBeCloseTo(20)
  })

  it('splits a fill that flips through zero and apportions its fee', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 2, timestamp: 1 }),
      f({ id: '2', side: 'sell', price: 110, amount: 3, timestamp: 2, fee: { cost: 3, currency: 'USDT' } }),
      f({ id: '3', side: 'buy', price: 105, amount: 1, timestamp: 3 }),
    ])
    expect(res.cycles).toHaveLength(2)
    expect(res.cycles[0]).toMatchObject({ direction: 'long', size: 2, dedupeId: '2' })
    expect(res.cycles[0].fees).toBeCloseTo(2)      // 2 of the 3 units
    expect(res.cycles[0].pnl).toBeCloseTo(18)      // 20 gross - 2 fee
    expect(res.cycles[1]).toMatchObject({ direction: 'short', size: 1, dedupeId: '3' })
    expect(res.cycles[1].fees).toBeCloseTo(1)      // remaining 1 unit
    expect(res.cycles[1].pnl).toBeCloseTo(4)       // (110-105)*1 - 1
  })

  it('treats sub-1e-8 dust as flat', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1 }),
      f({ id: '2', side: 'sell', price: 100, amount: 0.999999999, timestamp: 2 }),
    ])
    expect(res.cycles).toHaveLength(1)
    expect(res.skippedOpen).toBe(0)
  })

  it('skips a position still open at the end of the batch', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 2, timestamp: 1 }),
      f({ id: '2', side: 'sell', price: 110, amount: 1, timestamp: 2 }),
    ])
    expect(res.cycles).toEqual([])
    expect(res.skippedOpen).toBe(1)
  })

  it('nets a quote-currency fee out of pnl', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1, fee: { cost: 0.5, currency: 'USDT' } }),
      f({ id: '2', side: 'sell', price: 110, amount: 1, timestamp: 2, fee: { cost: 0.5, currency: 'USDT' } }),
    ])
    expect(res.cycles[0].fees).toBeCloseTo(1)
    expect(res.cycles[0].pnl).toBeCloseTo(9)
  })

  it('warns and excludes a fee paid in a non-quote currency', () => {
    const res = rollupFills([
      f({ id: '1', side: 'buy', price: 100, amount: 1, timestamp: 1, fee: { cost: 0.01, currency: 'BNB' } }),
      f({ id: '2', side: 'sell', price: 110, amount: 1, timestamp: 2 }),
    ])
    expect(res.cycles[0].fees).toBe(0)
    expect(res.cycles[0].pnl).toBeCloseTo(10)
    expect(res.warnings.join(' ')).toContain('BNB')
  })

  it('keeps two symbols independent and sorts by timestamp', () => {
    const res = rollupFills([
      f({ id: 'e2', symbol: 'ETH/USDT', side: 'sell', price: 2100, amount: 1, timestamp: 4 }),
      f({ id: 'b2', side: 'sell', price: 110, amount: 1, timestamp: 3 }),
      f({ id: 'e1', symbol: 'ETH/USDT', side: 'buy', price: 2000, amount: 1, timestamp: 2 }),
      f({ id: 'b1', side: 'buy', price: 100, amount: 1, timestamp: 1 }),
    ])
    expect(res.cycles).toHaveLength(2)
    expect(res.cycles.map((c) => c.dedupeId).sort()).toEqual(['b2', 'e2'])
    const eth = res.cycles.find((c) => c.symbol === 'ETH/USDT')!
    expect(eth.pnl).toBeCloseTo(100)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/unit/crypto-fills.test.ts`
Expected: FAIL — cannot resolve `@/lib/crypto/fills`.

- [ ] **Step 3: Implement**

Create `app/src/lib/crypto/fills.ts`:

```ts
import { quoteCurrency, normalizeCurrency } from '@/lib/crypto/symbols'

// Exchanges return individual fills, not trades: one position may be a dozen
// fills. Roll them into round trips (open -> flat) so the journal's win rate,
// expectancy and streaks stay meaningful. Only completed cycles are emitted —
// a position still open when the batch ends is picked up by a later sync, so
// no row ever has to mutate and the dedupe key stays immutable.
export type Fill = {
  id: string
  symbol: string
  timestamp: number // ms
  side: 'buy' | 'sell'
  price: number
  amount: number // base qty
  fee?: { cost: number; currency: string } | null
}

export type Cycle = {
  dedupeId: string // id of the fill that flattened the position
  symbol: string
  direction: 'long' | 'short'
  size: number
  entryPrice: number
  exitPrice: number
  fees: number
  pnl: number
  openedAt: string // ISO
  closedAt: string
}

export type RollupResult = { cycles: Cycle[]; skippedOpen: number; warnings: string[] }

// Exchanges return dust remainders; exact-zero comparison would leak cycles.
const EPS = 1e-8

const iso = (ms: number) => new Date(ms).toISOString()

export function rollupFills(fills: Fill[]): RollupResult {
  const cycles: Cycle[] = []
  const warnings: string[] = []
  let skippedOpen = 0

  const bySymbol = new Map<string, Fill[]>()
  for (const fill of fills) {
    const list = bySymbol.get(fill.symbol)
    if (list) list.push(fill)
    else bySymbol.set(fill.symbol, [fill])
  }

  for (const [symbol, list] of bySymbol) {
    const quote = normalizeCurrency(quoteCurrency(symbol))
    const sorted = [...list].sort(
      (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id, undefined, { numeric: true }),
    )

    let net = 0
    let dir: 1 | -1 | 0 = 0
    let entryQty = 0, entryNotional = 0
    let exitQty = 0, exitNotional = 0
    let fees = 0
    let openedAt = 0

    for (const fill of sorted) {
      const sign = fill.side === 'buy' ? 1 : -1

      // Fee is only netted when it was charged in the pair's quote currency —
      // a BNB-denominated fee would need a rate we do not have here.
      let feePerUnit = 0
      if (fill.fee && fill.fee.cost !== 0) {
        if (quote && normalizeCurrency(fill.fee.currency) === quote && fill.amount > 0) {
          feePerUnit = fill.fee.cost / fill.amount
        } else {
          warnings.push(
            `${symbol} fill ${fill.id}: fee in ${fill.fee.currency.toUpperCase()} excluded from P&L`,
          )
        }
      }

      let remaining = fill.amount
      while (remaining > EPS) {
        if (dir === 0) {
          dir = sign
          openedAt = fill.timestamp
        }
        const closing = sign === -dir
        const qty = closing ? Math.min(remaining, Math.abs(net)) : remaining

        if (closing) {
          exitQty += qty
          exitNotional += qty * fill.price
        } else {
          entryQty += qty
          entryNotional += qty * fill.price
        }
        fees += qty * feePerUnit
        net += sign * qty
        remaining -= qty

        if (Math.abs(net) <= EPS) {
          const entryPrice = entryNotional / entryQty
          const exitPrice = exitNotional / exitQty
          const size = exitQty
          cycles.push({
            dedupeId: fill.id,
            symbol,
            direction: dir === 1 ? 'long' : 'short',
            size,
            entryPrice,
            exitPrice,
            fees,
            pnl: (exitPrice - entryPrice) * dir * size - fees,
            openedAt: iso(openedAt),
            closedAt: iso(fill.timestamp),
          })
          net = 0
          dir = 0
          entryQty = 0; entryNotional = 0
          exitQty = 0; exitNotional = 0
          fees = 0
        }
      }
    }

    if (dir !== 0) skippedOpen += 1
  }

  return { cycles, skippedOpen, warnings }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/unit/crypto-fills.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/crypto/fills.ts app/tests/unit/crypto-fills.test.ts
git commit -m "feat(crypto): roll exchange fills into closed round trips"
```

---

### Task 4: Feature flags + instrument catalog entries

**Files:**
- Modify: `app/src/lib/entitlements.ts` (the `Feature` union near line 61, and `FEATURE_MIN_TIER` near line 74/96)
- Modify: `app/src/lib/instruments.ts` (the `INSTRUMENTS` array, after the existing BTC/ETH entries near line 22)
- Modify: `app/tests/unit/instruments.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: features `crypto_import` (trader) and `crypto_autosync` (pro); catalog entries `SOL/USD`, `XRP/USD`, `BNB/USD`, `DOGE/USD`, `ADA/USD`. Task 5 relies on these catalog entries resolving through `pipInfo`.

- [ ] **Step 1: Write the failing tests**

Append to `app/tests/unit/instruments.test.ts`:

```ts
describe('crypto catalog', () => {
  it('carries the majors the exchange sync will emit', () => {
    for (const s of ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'BNB/USD', 'DOGE/USD', 'ADA/USD']) {
      const found = findInstrument(s)
      expect(found, s).toBeDefined()
      expect(found!.market).toBe('crypto')
    }
  })
})
```

If `findInstrument` is not already imported at the top of that file, add it to the existing import from `@/lib/instruments`.

Append to `app/tests/unit/entitlements.test.ts`:

```ts
describe('crypto feature gates', () => {
  it('gates import at trader and autosync at pro', () => {
    expect(can('free', 'crypto_import')).toBe(false)
    expect(can('trader', 'crypto_import')).toBe(true)
    expect(can('trader', 'crypto_autosync')).toBe(false)
    expect(can('pro', 'crypto_autosync')).toBe(true)
  })
})
```

If `can` is not already imported at the top of that file, add it to the existing import from `@/lib/entitlements`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test -- tests/unit/instruments.test.ts tests/unit/entitlements.test.ts`
Expected: FAIL — `findInstrument('SOL/USD')` undefined, and TypeScript rejects `'crypto_import'` as a `Feature`.

- [ ] **Step 3: Add the flags**

In `app/src/lib/entitlements.ts`, extend the `Feature` union — add to the line that currently ends the union:

```ts
  | 'mt5_import' | 'mt5_autosync'
  | 'crypto_import' | 'crypto_autosync'
```

In `FEATURE_MIN_TIER`, add the two entries in the "Wired, enforced when built" block, immediately after `mt5_autosync: 'pro',`:

```ts
  crypto_import: 'trader',
  crypto_autosync: 'pro',
```

- [ ] **Step 4: Add the catalog entries**

In `app/src/lib/instruments.ts`, insert after the existing `ETH/USD` entry:

```ts
  { symbol: 'SOL/USD', name: 'Solana / US Dollar', market: 'crypto', pipSize: 0.01, pipValuePerLot: 1 },
  { symbol: 'XRP/USD', name: 'XRP / US Dollar', market: 'crypto', pipSize: 0.0001, pipValuePerLot: 1 },
  { symbol: 'BNB/USD', name: 'BNB / US Dollar', market: 'crypto', pipSize: 0.1, pipValuePerLot: 1 },
  { symbol: 'DOGE/USD', name: 'Dogecoin / US Dollar', market: 'crypto', pipSize: 0.00001, pipValuePerLot: 1 },
  { symbol: 'ADA/USD', name: 'Cardano / US Dollar', market: 'crypto', pipSize: 0.0001, pipValuePerLot: 1 },
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- tests/unit/instruments.test.ts tests/unit/entitlements.test.ts tests/unit/feature-flags.test.ts`
Expected: PASS. `feature-flags.test.ts` is included because it asserts `FEATURE_KEYS` covers every `FEATURE_MIN_TIER` key — it must stay green.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/entitlements.ts app/src/lib/instruments.ts app/tests/unit/instruments.test.ts app/tests/unit/entitlements.test.ts
git commit -m "feat(crypto): wire crypto_import/crypto_autosync flags and catalog majors"
```

---

### Task 5: `map.ts` — cycle to trade row

**Files:**
- Create: `app/src/lib/crypto/map.ts`
- Test: `app/tests/unit/crypto-map.test.ts`

**Interfaces:**
- Consumes: `Cycle` from Task 3, `normalizeExchangeSymbol` from Task 2, `pipInfo` from `@/lib/instruments`, catalog entries from Task 4.
- Produces: `mapCycleToTrade(cycle: Cycle, opts: { userId: string; isPublic: boolean }): Record<string, unknown>` — the row Phase 1 upserts on `(user_id, broker_deal_id)`.

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/crypto-map.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapCycleToTrade } from '@/lib/crypto/map'
import type { Cycle } from '@/lib/crypto/fills'

const cycle = (o: Partial<Cycle> = {}): Cycle => ({
  dedupeId: 'fill-9', symbol: 'BTC/USDT', direction: 'long', size: 0.5,
  entryPrice: 60000, exitPrice: 61000, fees: 12, pnl: 488,
  openedAt: '2026-07-01T10:00:00.000Z', closedAt: '2026-07-01T12:00:00.000Z', ...o,
})

describe('mapCycleToTrade', () => {
  it('produces a closed, broker-sourced crypto row', () => {
    expect(mapCycleToTrade(cycle(), { userId: 'u1', isPublic: true })).toMatchObject({
      user_id: 'u1', broker_deal_id: 'fill-9', source: 'broker',
      market: 'crypto', instrument: 'BTC/USD', direction: 'long',
      sizing_mode: 'lots', lots: 0.5,
      entry_price: 60000, exit_price: 61000,
      pnl_amount: 488, outcome: 'win', status: 'closed',
      is_public: true,
      traded_at: '2026-07-01T10:00:00.000Z', closed_at: '2026-07-01T12:00:00.000Z',
    })
  })

  it('leaves every stop/risk field neutral because imports carry no stop', () => {
    const row = mapCycleToTrade(cycle(), { userId: 'u1', isPublic: false })
    expect(row).toMatchObject({
      stop_price: null, target_price: null, tp_pips: null,
      planned_rr: null, r_multiple: null, risk_percent: null,
      sl_pips: 0, risk_amount: 0, is_public: false,
    })
  })

  it('marks a losing short and rounds pnl to cents', () => {
    const row = mapCycleToTrade(
      cycle({ direction: 'short', entryPrice: 100, exitPrice: 110, pnl: -10.005 }),
      { userId: 'u1', isPublic: true },
    )
    expect(row.outcome).toBe('loss')
    expect(row.pnl_amount).toBe(-10.01)
  })

  it('treats a zero-pnl cycle as breakeven', () => {
    const row = mapCycleToTrade(cycle({ pnl: 0 }), { userId: 'u1', isPublic: true })
    expect(row.outcome).toBe('breakeven')
  })

  it('computes realized_pips from the catalog pip size', () => {
    // BTC/USD pipSize is 1, so 61000 - 60000 = 1000 pips.
    expect(mapCycleToTrade(cycle(), { userId: 'u1', isPublic: true }).realized_pips).toBe(1000)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/unit/crypto-map.test.ts`
Expected: FAIL — cannot resolve `@/lib/crypto/map`.

- [ ] **Step 3: Implement**

Create `app/src/lib/crypto/map.ts`:

```ts
import { pipInfo } from '@/lib/instruments'
import { normalizeExchangeSymbol } from '@/lib/crypto/symbols'
import type { Cycle } from '@/lib/crypto/fills'

// Mirrors mapDealToTrade (lib/mt5.ts) so crypto and MT5 rows are the same
// shape. source stays 'broker': an API-sourced fill carries the same trust
// level as a MetaApi sync, so verification badges need no new case.
export function mapCycleToTrade(
  cycle: Cycle,
  opts: { userId: string; isPublic: boolean },
): Record<string, unknown> {
  const { instrument, market } = normalizeExchangeSymbol(cycle.symbol)
  const { pipSize } = pipInfo(instrument, market)
  const dirSign = cycle.direction === 'long' ? 1 : -1
  const realizedPips = ((cycle.exitPrice - cycle.entryPrice) * dirSign) / pipSize
  const pnl = Math.round(cycle.pnl * 100) / 100

  return {
    user_id: opts.userId,
    broker_deal_id: cycle.dedupeId,
    source: 'broker',
    market,
    instrument,
    direction: cycle.direction,
    sizing_mode: 'lots',
    lots: cycle.size,
    risk_percent: null,
    entry_price: cycle.entryPrice,
    exit_price: cycle.exitPrice,
    // Exchange fills carry no stop, so R-based stats exclude these rows —
    // same behaviour as MT5 statement imports.
    stop_price: null,
    target_price: null,
    risk_amount: 0,
    sl_pips: 0,
    tp_pips: null,
    planned_rr: null,
    r_multiple: null,
    pnl_amount: pnl,
    realized_pips: Math.round(realizedPips * 10) / 10,
    outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
    status: 'closed',
    is_public: opts.isPublic,
    traded_at: cycle.openedAt,
    closed_at: cycle.closedAt,
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/unit/crypto-map.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/crypto/map.ts app/tests/unit/crypto-map.test.ts
git commit -m "feat(crypto): map round-trip cycles onto journal trade rows"
```

---

### Task 6: `0037_exchange_accounts.sql` — connection table

**Files:**
- Create: `app/supabase/migrations/0037_exchange_accounts.sql`

**Interfaces:**
- Consumes: `public.profiles`, and the existing `public.touch_updated_at()` trigger function (used by `0019_broker_accounts.sql`).
- Produces: table `public.exchange_accounts` — Phase 1's connect form inserts into it and the sync route reads it with the service role.

- [ ] **Step 1: Write the migration**

Create `app/supabase/migrations/0037_exchange_accounts.sql`:

```sql
-- Crypto exchange connections (CCXT, phase 0 groundwork).
-- Separate from broker_accounts so a user can hold an MT5 connection and
-- several exchanges at once, and so the live MetaApi path is untouched.
-- Secrets are AES-256-GCM envelopes ('v1.<iv>.<ct>') produced by
-- lib/server/secrets.ts; the master key lives in the environment, never here.
create table if not exists public.exchange_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exchange text not null,                   -- ccxt id: binance | coinbase | kraken | bybit
  label text,
  api_key_enc text not null,
  api_secret_enc text not null,
  passphrase_enc text,                      -- coinbase / okx / kucoin need a third factor
  status text not null default 'pending',   -- pending | active | error | disconnected
  last_sync_at timestamptz,
  last_fill_at timestamptz,                 -- sync cursor (max fill time seen)
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists exchange_accounts_user_exchange_idx
  on public.exchange_accounts (user_id, exchange);

drop trigger if exists exchange_accounts_touch_updated_at on public.exchange_accounts;
create trigger exchange_accounts_touch_updated_at
  before update on public.exchange_accounts
  for each row execute function public.touch_updated_at();

alter table public.exchange_accounts enable row level security;

-- Owner select/insert/delete; NO update policy (sync routes use service role).
drop policy if exists exchange_accounts_select on public.exchange_accounts;
create policy exchange_accounts_select on public.exchange_accounts
  for select using (auth.uid() = user_id);

drop policy if exists exchange_accounts_insert on public.exchange_accounts;
create policy exchange_accounts_insert on public.exchange_accounts
  for insert with check (auth.uid() = user_id);

drop policy if exists exchange_accounts_delete on public.exchange_accounts;
create policy exchange_accounts_delete on public.exchange_accounts
  for delete using (auth.uid() = user_id);

-- Defense in depth: the row stays readable for status/label, but no client
-- role can ever select the ciphertext columns.
revoke select (api_key_enc, api_secret_enc, passphrase_enc)
  on public.exchange_accounts from authenticated, anon;
```

- [ ] **Step 2: Apply it to the dev project**

Apply against the **dev** Supabase project (the `sixixw…` one), not prod. Either:
- the Supabase MCP `apply_migration` tool, if the connector is authorized in this session; or
- paste the file into the dev project's SQL editor and run it.

Expected: no error. Re-running is safe — every statement is `if not exists` / `drop … create`.

- [ ] **Step 3: Verify the table and the revoke landed**

Run this in the dev SQL editor:

```sql
select count(*) from public.exchange_accounts;
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_name = 'exchange_accounts' and column_name = 'api_secret_enc';
```

Expected: count `0`; the second query returns no `authenticated` or `anon` row for `api_secret_enc`.

- [ ] **Step 4: Check Supabase advisors**

Run the security + performance advisors on the dev project. Expected: no new warnings attributable to `exchange_accounts`. If an "RLS enabled, no policy" or "unindexed foreign key" warning appears for it, fix it in this migration before committing.

- [ ] **Step 5: Commit**

```bash
git add app/supabase/migrations/0037_exchange_accounts.sql
git commit -m "feat(crypto): exchange_accounts table with encrypted key columns"
```

---

### Task 7: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit suite**

Run from `app/`: `npm test`
Expected: all pass, including the four new files and the pre-existing suite.

- [ ] **Step 2: Type check**

Run from `app/`: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 3: Build**

Run from `app/`: `npm run build`
Expected: succeeds. This catches a `server-only` import leaking into a client bundle — `secrets.ts` must never be reachable from a client component.

- [ ] **Step 4: Confirm no secret leaked into the repo**

Run from the repo root:

```bash
git log -p -7 | grep -i "EXCHANGE_KEY_SECRET=" || echo "clean"
```

Expected: `clean`. The generated key belongs in `.env.local` and Vercel only.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "test: verify crypto sync phase 0 groundwork"
```

---

## Handover notes for Phase 1

- `EXCHANGE_KEY_SECRET` must be added to Vercel (all environments) before any connect UI ships.
- Pin the sync route's function region — Binance returns HTTP 451 from restricted-region IPs.
- `app/vercel.json` already holds 2 cron jobs, the Hobby-plan cap. Autosync needs a Pro upgrade or must piggyback an existing cron route.
- Import CCXT per-exchange (`ccxt/js/src/binance.js` style subpath), never the 100-exchange barrel, or the serverless bundle balloons.
- The connect form must tell users to enable read/query permission only, and reject keys carrying trade or withdrawal scope where the venue exposes it.

## Self-Review

**Spec coverage:**
- `lib/server/secrets.ts` AES-256-GCM, v1 envelope, fail-closed → Task 1. ✓
- `lib/crypto/symbols.ts` stable-quote normalization, slashless form → Task 2. ✓
- `lib/crypto/fills.ts` rollup, 1e-8 dust, flip-through-zero with pro-rata fee, `skippedOpen`, warnings-not-throws → Task 3. ✓
- `crypto_import` / `crypto_autosync` flags, five catalog entries → Task 4. ✓
- `lib/crypto/map.ts` field parity, `source: 'broker'`, null stop → Task 5. ✓
- `0037_exchange_accounts.sql`, RLS parity with `broker_accounts`, column-level revoke → Task 6. ✓
- No `trades` migration → asserted in Global Constraints, and no task touches `trades`. ✓
- `EXCHANGE_KEY_SECRET` env → Task 1 Step 5 (local) + handover note (Vercel). ✓
- Test matrix from the spec → Tasks 1–5, all four suites. ✓
- Phase verification (tests, tsc, dev migration, advisors) → Task 6 Step 4 + Task 7. ✓

**Type consistency:** `Fill` and `Cycle` are defined once in Task 3 and consumed verbatim in Task 5. `normalizeExchangeSymbol` returns `{ instrument, market }` in Task 2 and is destructured as such in Task 5. `quoteCurrency` / `normalizeCurrency` signatures in Task 2 match their use in Task 3. `mapCycleToTrade(cycle, { userId, isPublic })` is identical in the interface block, the implementation, and every test.

**Scope:** one phase, seven tasks, no UI, no dependency added. Phase 1 is a separate plan.
