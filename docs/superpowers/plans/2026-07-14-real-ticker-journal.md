# Real Ticker Search + Live Price Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real instrument search (Twelve Data API) plus a live-price chip with entry-price autofill in the trade-capture modal, degrading exactly to today's behavior when no API key is set.

**Architecture:** A pure library `app/src/lib/market-data.ts` holds all mapping, caching, and provider-fetch logic (injectable `fetch`, fully unit-tested). Two thin auth-gated route handlers (`/api/market/search`, `/api/market/quote`) wrap it with module-level in-memory caches. Two client components (`InstrumentCombobox`, `LivePriceChip`) replace the datalist input and add price autofill in `TradeModalProvider.tsx`.

**Tech Stack:** Next.js App Router route handlers, Supabase auth (`getUser` — required for route handlers per `app/src/lib/supabase/server.ts` comment), Vitest, Twelve Data REST API.

**Spec:** `docs/superpowers/specs/2026-07-14-real-ticker-journal-design.md`

## Global Constraints

- All commands run from `D:\Work\OneTradingSocial\Website\app` (that's the npm root).
- Tests: `npm test` runs `vitest run`. Single file: `npx vitest run tests/unit/market-data.test.ts`.
- API key env var: `TWELVEDATA_API_KEY` (server-only; never `NEXT_PUBLIC_`).
- No DB migration. `trades.instrument` stays free text.
- Route handlers use `getUser()` (NOT `getSessionUser`) — project rule for route handlers.
- Index proxies: `US30→DIA`, `NAS100→QQQ`, `SPX500→SPY`, `GER40→EWG`. Proxy prices labelled, never autofilled.
- Free-tier budget: search results cached 24 h, quotes 60 s fresh + 1 h stale window (stale served only on provider 429).
- No feature flag. Missing key ⇒ static-catalog search only, no price chip.

---

### Task 1: market-data library (types, mapping, static search, TTL cache)

**Files:**
- Create: `app/src/lib/market-data.ts`
- Test: `app/tests/unit/market-data.test.ts`

**Interfaces:**
- Consumes: `INSTRUMENTS` from `@/lib/instruments` (existing).
- Produces (used by Tasks 2–5):
  - `type Market = 'forex' | 'crypto' | 'stocks' | 'indices' | 'commodities'`
  - `type MarketSearchResult = { symbol: string; name: string; market: Market; exchange?: string }`
  - `type MarketQuote = { symbol: string; price: number; at: number; proxy?: string }`
  - `const INDEX_PROXIES: Record<string, string>`
  - `mapInstrumentType(instrumentType: string, symbol: string): Market`
  - `searchStatic(q: string): MarketSearchResult[]`
  - `mergeSearchResults(staticHits: MarketSearchResult[], apiHits: MarketSearchResult[]): MarketSearchResult[]` (static first, dedupe by uppercased symbol, cap 20)
  - `class TtlCache<T>` with `get(key) → { value: T; stale: boolean } | null` and `set(key, value, freshMs, staleMs = 0)`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/market-data.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  mapInstrumentType, searchStatic, mergeSearchResults, TtlCache, INDEX_PROXIES,
  type MarketSearchResult,
} from '@/lib/market-data'

describe('mapInstrumentType', () => {
  it('maps digital currency to crypto', () => {
    expect(mapInstrumentType('Digital Currency', 'BTC/USD')).toBe('crypto')
  })
  it('maps physical currency to forex', () => {
    expect(mapInstrumentType('Physical Currency', 'EUR/USD')).toBe('forex')
  })
  it('maps XAU pairs to commodities even when typed as currency', () => {
    expect(mapInstrumentType('Physical Currency', 'XAU/USD')).toBe('commodities')
    expect(mapInstrumentType('Physical Currency', 'XAG/USD')).toBe('commodities')
  })
  it('maps index to indices', () => {
    expect(mapInstrumentType('Index', 'SPX')).toBe('indices')
  })
  it('defaults everything else to stocks', () => {
    expect(mapInstrumentType('Common Stock', 'AAPL')).toBe('stocks')
    expect(mapInstrumentType('ETF', 'SPY')).toBe('stocks')
    expect(mapInstrumentType('', 'ZZZ')).toBe('stocks')
  })
})

describe('searchStatic', () => {
  it('matches by symbol substring, case-insensitive', () => {
    expect(searchStatic('eur').some((r) => r.symbol === 'EUR/USD')).toBe(true)
  })
  it('matches by name substring', () => {
    expect(searchStatic('gold').some((r) => r.symbol === 'XAU/USD')).toBe(true)
  })
  it('returns empty for blank query', () => {
    expect(searchStatic('  ')).toEqual([])
  })
})

describe('mergeSearchResults', () => {
  const s: MarketSearchResult[] = [{ symbol: 'EUR/USD', name: 'Euro / US Dollar', market: 'forex' }]
  it('keeps static hits first and dedupes by symbol', () => {
    const api: MarketSearchResult[] = [
      { symbol: 'EUR/USD', name: 'Euro US Dollar', market: 'forex', exchange: 'FOREX' },
      { symbol: 'EUR/GBP', name: 'Euro / Pound', market: 'forex' },
    ]
    const out = mergeSearchResults(s, api)
    expect(out[0]).toEqual(s[0])
    expect(out.filter((r) => r.symbol === 'EUR/USD')).toHaveLength(1)
    expect(out.some((r) => r.symbol === 'EUR/GBP')).toBe(true)
  })
  it('caps output at 20', () => {
    const api = Array.from({ length: 30 }, (_, i) => ({
      symbol: `SYM${i}`, name: `Name ${i}`, market: 'stocks' as const,
    }))
    expect(mergeSearchResults(s, api)).toHaveLength(20)
  })
})

describe('TtlCache', () => {
  it('returns fresh value within freshMs', () => {
    const c = new TtlCache<number>()
    c.set('k', 1, 1000, 0, 0)
    expect(c.get('k', 500)).toEqual({ value: 1, stale: false })
  })
  it('returns stale value between freshMs and freshMs+staleMs', () => {
    const c = new TtlCache<number>()
    c.set('k', 1, 1000, 5000, 0)
    expect(c.get('k', 2000)).toEqual({ value: 1, stale: true })
  })
  it('returns null after full expiry', () => {
    const c = new TtlCache<number>()
    c.set('k', 1, 1000, 1000, 0)
    expect(c.get('k', 3000)).toBeNull()
  })
  it('evicts oldest entry when over capacity', () => {
    const c = new TtlCache<number>(2)
    c.set('a', 1, 1000, 0, 0)
    c.set('b', 2, 1000, 0, 0)
    c.set('c', 3, 1000, 0, 0)
    expect(c.get('a', 1)).toBeNull()
    expect(c.get('c', 1)).toEqual({ value: 3, stale: false })
  })
})

describe('INDEX_PROXIES', () => {
  it('maps the four CFD indices to ETFs', () => {
    expect(INDEX_PROXIES).toEqual({ US30: 'DIA', NAS100: 'QQQ', SPX500: 'SPY', GER40: 'EWG' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/market-data.test.ts`
Expected: FAIL — cannot resolve `@/lib/market-data`.

- [ ] **Step 3: Write minimal implementation**

Create `app/src/lib/market-data.ts`:

```ts
import { INSTRUMENTS } from '@/lib/instruments'

export type Market = 'forex' | 'crypto' | 'stocks' | 'indices' | 'commodities'
export type MarketSearchResult = { symbol: string; name: string; market: Market; exchange?: string }
export type MarketQuote = { symbol: string; price: number; at: number; proxy?: string }

// Free-tier Twelve Data has no index CFD data; quote these via ETF proxies.
export const INDEX_PROXIES: Record<string, string> = {
  US30: 'DIA', NAS100: 'QQQ', SPX500: 'SPY', GER40: 'EWG',
}

export function mapInstrumentType(instrumentType: string, symbol: string): Market {
  const t = instrumentType.toLowerCase()
  const s = symbol.toUpperCase()
  if (s.startsWith('XAU') || s.startsWith('XAG')) return 'commodities'
  if (t.includes('digital')) return 'crypto'
  if (t.includes('currency')) return 'forex'
  if (t.includes('index')) return 'indices'
  return 'stocks'
}

export function searchStatic(q: string): MarketSearchResult[] {
  const s = q.trim().toUpperCase()
  if (!s) return []
  return INSTRUMENTS
    .filter((i) => i.symbol.toUpperCase().includes(s) || i.name.toUpperCase().includes(s))
    .map((i) => ({ symbol: i.symbol, name: i.name, market: i.market }))
}

export function mergeSearchResults(
  staticHits: MarketSearchResult[],
  apiHits: MarketSearchResult[],
): MarketSearchResult[] {
  const seen = new Set(staticHits.map((r) => r.symbol.toUpperCase()))
  const out = [...staticHits]
  for (const r of apiHits) {
    const key = r.symbol.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out.slice(0, 20)
}

type CacheEntry<T> = { value: T; freshUntil: number; expiresAt: number }

export class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>()
  constructor(private maxEntries = 500) {}

  get(key: string, now = Date.now()): { value: T; stale: boolean } | null {
    const e = this.map.get(key)
    if (!e) return null
    if (now >= e.expiresAt) { this.map.delete(key); return null }
    return { value: e.value, stale: now >= e.freshUntil }
  }

  set(key: string, value: T, freshMs: number, staleMs = 0, now = Date.now()) {
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, { value, freshUntil: now + freshMs, expiresAt: now + freshMs + staleMs })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/market-data.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Run full suite, then commit**

Run: `npm test` — expected all green.

```bash
git add src/lib/market-data.ts tests/unit/market-data.test.ts
git commit -m "feat(journal): market-data lib — type mapping, static search, TTL cache"
```

---

### Task 2: provider fetchers (searchSymbols, fetchQuote) with injectable fetch

**Files:**
- Modify: `app/src/lib/market-data.ts` (append)
- Test: `app/tests/unit/market-data.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces (used by Task 3):
  - `searchSymbols(q: string, apiKey: string, fetchImpl?: typeof fetch): Promise<MarketSearchResult[]>`
  - `fetchQuote(symbol: string, apiKey: string, fetchImpl?: typeof fetch): Promise<MarketQuote | { error: 'not_found' | 'rate_limited' | 'unavailable' }>`

Twelve Data response shapes used:
- `GET /symbol_search?symbol=Q&outputsize=30&apikey=K` → `{ data: [{ symbol, instrument_name, exchange, instrument_type, currency? }] }`
- `GET /price?symbol=S&apikey=K` → success `{ price: "1.08423" }`; error `{ code: 429 | 400 | 404, message, status: "error" }` (HTTP status often still 200).

- [ ] **Step 1: Write the failing tests**

Append to `app/tests/unit/market-data.test.ts`:

```ts
import { searchSymbols, fetchQuote } from '@/lib/market-data'

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  ) as unknown as typeof fetch
}

describe('searchSymbols', () => {
  it('returns static hits only when no api key', async () => {
    const out = await searchSymbols('EUR', '', fakeFetch({ data: [] }))
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((r) => r.exchange === undefined)).toBe(true)
  })
  it('merges api hits after static hits', async () => {
    const out = await searchSymbols('AAPL', 'key', fakeFetch({
      data: [{ symbol: 'AAPL', instrument_name: 'Apple Inc', exchange: 'NASDAQ', instrument_type: 'Common Stock' }],
    }))
    expect(out.some((r) => r.symbol === 'AAPL' && r.market === 'stocks' && r.exchange === 'NASDAQ')).toBe(true)
  })
  it('drops non-US stock listings', async () => {
    const out = await searchSymbols('AAPL', 'key', fakeFetch({
      data: [{ symbol: 'APC', instrument_name: 'Apple Inc', exchange: 'XETRA', instrument_type: 'Common Stock' }],
    }))
    expect(out.some((r) => r.symbol === 'APC')).toBe(false)
  })
  it('keeps forex hits regardless of exchange', async () => {
    const out = await searchSymbols('EUR/PLN', 'key', fakeFetch({
      data: [{ symbol: 'EUR/PLN', instrument_name: 'Euro Polish Zloty', exchange: 'FOREX', instrument_type: 'Physical Currency' }],
    }))
    expect(out.some((r) => r.symbol === 'EUR/PLN' && r.market === 'forex')).toBe(true)
  })
  it('falls back to static hits on fetch failure', async () => {
    const boom = (async () => { throw new Error('net') }) as unknown as typeof fetch
    const out = await searchSymbols('EUR', 'key', boom)
    expect(out.some((r) => r.symbol === 'EUR/USD')).toBe(true)
  })
})

describe('fetchQuote', () => {
  it('returns unavailable without api key', async () => {
    expect(await fetchQuote('EUR/USD', '', fakeFetch({}))).toEqual({ error: 'unavailable' })
  })
  it('parses a price', async () => {
    const r = await fetchQuote('EUR/USD', 'key', fakeFetch({ price: '1.08423' }))
    expect(r).toMatchObject({ symbol: 'EUR/USD', price: 1.08423 })
    expect('proxy' in r).toBe(false)
  })
  it('quotes index CFDs via ETF proxy and flags it', async () => {
    let requested = ''
    const f = (async (url: RequestInfo | URL) => {
      requested = String(url)
      return new Response(JSON.stringify({ price: '442.10' }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await fetchQuote('US30', 'key', f)
    expect(requested).toContain('symbol=DIA')
    expect(r).toMatchObject({ symbol: 'US30', price: 442.10, proxy: 'DIA' })
  })
  it('maps provider 429 body to rate_limited', async () => {
    const r = await fetchQuote('EUR/USD', 'key', fakeFetch({ code: 429, message: 'limit', status: 'error' }))
    expect(r).toEqual({ error: 'rate_limited' })
  })
  it('maps unknown symbol to not_found', async () => {
    const r = await fetchQuote('NOPE', 'key', fakeFetch({ code: 400, message: 'not found', status: 'error' }))
    expect(r).toEqual({ error: 'not_found' })
  })
  it('maps network failure to unavailable', async () => {
    const boom = (async () => { throw new Error('net') }) as unknown as typeof fetch
    expect(await fetchQuote('EUR/USD', 'key', boom)).toEqual({ error: 'unavailable' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/market-data.test.ts`
Expected: FAIL — `searchSymbols` / `fetchQuote` not exported.

- [ ] **Step 3: Write implementation**

Append to `app/src/lib/market-data.ts`:

```ts
const TD_BASE = 'https://api.twelvedata.com'
const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'NYSE ARCA', 'ARCA', 'BATS', 'OTC'])

type TdSearchRow = {
  symbol?: string
  instrument_name?: string
  exchange?: string
  instrument_type?: string
}

export async function searchSymbols(
  q: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MarketSearchResult[]> {
  const staticHits = searchStatic(q)
  if (!apiKey) return staticHits
  try {
    const url = `${TD_BASE}/symbol_search?symbol=${encodeURIComponent(q.trim())}&outputsize=30&apikey=${apiKey}`
    const res = await fetchImpl(url)
    if (!res.ok) return staticHits
    const json = (await res.json()) as { data?: TdSearchRow[] }
    const rows = Array.isArray(json?.data) ? json.data : []
    const apiHits: MarketSearchResult[] = []
    for (const row of rows) {
      if (!row.symbol) continue
      const market = mapInstrumentType(row.instrument_type ?? '', row.symbol)
      // Free tier only quotes US stock listings; skip foreign listings to
      // avoid offering symbols the quote endpoint will reject.
      if (market === 'stocks' && !US_EXCHANGES.has((row.exchange ?? '').toUpperCase())) continue
      apiHits.push({
        symbol: row.symbol.toUpperCase(),
        name: row.instrument_name ?? row.symbol,
        market,
        exchange: row.exchange || undefined,
      })
    }
    return mergeSearchResults(staticHits, apiHits)
  } catch {
    return staticHits
  }
}

export async function fetchQuote(
  symbol: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MarketQuote | { error: 'not_found' | 'rate_limited' | 'unavailable' }> {
  if (!apiKey) return { error: 'unavailable' }
  const sym = symbol.trim().toUpperCase()
  const proxy = INDEX_PROXIES[sym]
  const target = proxy ?? sym
  try {
    const res = await fetchImpl(`${TD_BASE}/price?symbol=${encodeURIComponent(target)}&apikey=${apiKey}`)
    const json = (await res.json().catch(() => null)) as { price?: string; code?: number } | null
    if (json && typeof json.price === 'string') {
      const price = Number(json.price)
      if (Number.isFinite(price)) {
        return proxy ? { symbol: sym, price, at: Date.now(), proxy } : { symbol: sym, price, at: Date.now() }
      }
    }
    if (res.status === 429 || json?.code === 429) return { error: 'rate_limited' }
    return { error: 'not_found' }
  } catch {
    return { error: 'unavailable' }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/market-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market-data.ts tests/unit/market-data.test.ts
git commit -m "feat(journal): Twelve Data search + quote fetchers with fallbacks"
```

---

### Task 3: API route handlers /api/market/search and /api/market/quote

**Files:**
- Create: `app/src/app/api/market/search/route.ts`
- Create: `app/src/app/api/market/quote/route.ts`

**Interfaces:**
- Consumes: `searchSymbols`, `fetchQuote`, `TtlCache`, types from `@/lib/market-data`; `createClient` from `@/lib/supabase/server`.
- Produces (used by Tasks 4–5):
  - `GET /api/market/search?q=<str>` → `200 { results: MarketSearchResult[] }` | `401`
  - `GET /api/market/quote?symbol=<str>` → `200 { quote: MarketQuote, stale?: true }` | `400` | `401` | `404 { unavailable: true }` | `503 { unavailable: true }`

All logic lives in the tested lib; routes are thin wrappers (matches project pattern — route handlers have no unit-test harness here).

- [ ] **Step 1: Create the search route**

Create `app/src/app/api/market/search/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchSymbols, TtlCache, type MarketSearchResult } from '@/lib/market-data'

const DAY_MS = 24 * 60 * 60 * 1000
const cache = new TtlCache<MarketSearchResult[]>(1000)

export async function GET(request: NextRequest) {
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2 || q.length > 30) return NextResponse.json({ results: [] })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = q.toLowerCase()
  const hit = cache.get(key)
  if (hit) return NextResponse.json({ results: hit.value })

  const results = await searchSymbols(q, process.env.TWELVEDATA_API_KEY ?? '')
  cache.set(key, results, DAY_MS)
  return NextResponse.json(
    { results },
    { headers: { 'Cache-Control': 'private, max-age=3600' } },
  )
}
```

- [ ] **Step 2: Create the quote route**

Create `app/src/app/api/market/quote/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchQuote, TtlCache, type MarketQuote } from '@/lib/market-data'

const FRESH_MS = 60 * 1000
const STALE_MS = 60 * 60 * 1000 // keep 1h; served only when provider rate-limits
const cache = new TtlCache<MarketQuote>(500)

export async function GET(request: NextRequest) {
  const symbol = (new URL(request.url).searchParams.get('symbol') ?? '').trim().toUpperCase()
  if (!symbol || symbol.length > 20) return NextResponse.json({ error: 'bad request' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const hit = cache.get(symbol)
  if (hit && !hit.stale) {
    return NextResponse.json({ quote: hit.value }, { headers: { 'Cache-Control': 'private, max-age=30' } })
  }

  const result = await fetchQuote(symbol, process.env.TWELVEDATA_API_KEY ?? '')
  if ('error' in result) {
    if (result.error === 'rate_limited' && hit) return NextResponse.json({ quote: hit.value, stale: true })
    if (result.error === 'not_found') return NextResponse.json({ unavailable: true }, { status: 404 })
    return NextResponse.json({ unavailable: true }, { status: 503 })
  }

  cache.set(symbol, result, FRESH_MS, STALE_MS)
  return NextResponse.json({ quote: result }, { headers: { 'Cache-Control': 'private, max-age=30' } })
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` and `npm run lint` (from `app/`).
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/market
git commit -m "feat(journal): market search + quote API routes with in-memory caching"
```

---

### Task 4: InstrumentCombobox component + modal wiring

**Files:**
- Create: `app/src/app/_components/InstrumentCombobox.tsx`
- Modify: `app/src/app/_components/TradeModalProvider.tsx:176-179` (instrument field)
- Modify: `app/src/app/globals.css` (append combobox styles)

**Interfaces:**
- Consumes: `GET /api/market/search` (Task 3), `INSTRUMENTS` from `@/lib/instruments`, `type MarketSearchResult` from `@/lib/market-data`.
- Produces: `<InstrumentCombobox value onChange onSelect />` where
  `onSelect(r: MarketSearchResult)` fires only when a dropdown row is picked.
  Free typing still flows through `onChange(v: string)` — custom symbols stay valid.

- [ ] **Step 1: Create the component**

Create `app/src/app/_components/InstrumentCombobox.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { INSTRUMENTS } from '@/lib/instruments'
import type { MarketSearchResult } from '@/lib/market-data'

function staticHits(q: string): MarketSearchResult[] {
  const s = q.trim().toUpperCase()
  return INSTRUMENTS
    .filter((i) => !s || i.symbol.toUpperCase().includes(s) || i.name.toUpperCase().includes(s))
    .map((i) => ({ symbol: i.symbol, name: i.name, market: i.market }))
}

export function InstrumentCombobox({ value, onChange, onSelect }: {
  value: string
  onChange: (v: string) => void
  onSelect: (r: MarketSearchResult) => void
}) {
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<MarketSearchResult[]>([])
  const [active, setActive] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const query = useCallback((q: string) => {
    if (timer.current) clearTimeout(timer.current)
    setResults(staticHits(q))
    setActive(0)
    if (q.trim().length < 2) return
    timer.current = setTimeout(async () => {
      const id = ++seq.current
      try {
        const res = await fetch(`/api/market/search?q=${encodeURIComponent(q.trim())}`)
        if (!res.ok) return
        const json = (await res.json()) as { results?: MarketSearchResult[] }
        if (id === seq.current && Array.isArray(json.results) && json.results.length) {
          setResults(json.results)
          setActive(0)
        }
      } catch { /* keep static results */ }
    }, 300)
  }, [])

  function pick(r: MarketSearchResult) {
    onSelect(r)
    setOpen(false)
  }

  return (
    <div className="ts-combobox">
      <input
        name="instrument"
        className="ts-input"
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        onFocus={() => { setOpen(true); query(value) }}
        onBlur={() => setOpen(false)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); query(e.target.value) }}
        onKeyDown={(e) => {
          if (!open || !results.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); pick(results[active]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && results.length > 0 && (
        <ul className="ts-combobox-list" role="listbox">
          {results.map((r, i) => (
            <li
              key={`${r.symbol}-${r.exchange ?? ''}`}
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(r) }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="ts-combobox-sym">{r.symbol}</span>
              <span className="ts-combobox-name">{r.name}</span>
              <span className="ts-combobox-badge" data-market={r.market}>{r.market}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Append styles**

Append to `app/src/app/globals.css`:

```css
/* Instrument search combobox (trade modal) */
.ts-combobox { position: relative; }
.ts-combobox-list {
  position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; right: 0;
  max-height: 260px; overflow-y: auto; margin: 0; padding: 4px; list-style: none;
  background: var(--surface, #fff); border: 1px solid var(--border, #e5e7eb);
  border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
.ts-combobox-list li {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border-radius: 7px; cursor: pointer; font-size: 13px;
}
.ts-combobox-list li[data-active='true'] { background: var(--violet-soft, #f3efff); }
.ts-combobox-sym { font-weight: 700; white-space: nowrap; }
.ts-combobox-name {
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--muted, #6b7280); font-size: 12px;
}
.ts-combobox-badge {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  padding: 2px 6px; border-radius: 99px; background: var(--violet-soft, #f3efff);
  color: var(--violet-deep, #5b21b6);
}
```

(If `globals.css` defines different token names for surface/border/muted, reuse those instead of the fallbacks — check the top of the file.)

- [ ] **Step 3: Wire into the trade modal**

In `app/src/app/_components/TradeModalProvider.tsx`:

Add import:

```tsx
import { InstrumentCombobox } from './InstrumentCombobox'
```

Replace the instrument field (currently lines 176-179):

```tsx
          <label className="ts-field"><span className="ts-label">Instrument</span>
            <input name="instrument" className="ts-input" value={instrument} list="instlist" onChange={(e) => setInstrument(e.target.value)} />
            <datalist id="instlist">{INSTRUMENTS.map((i) => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}</datalist>
          </label>
```

with:

```tsx
          <label className="ts-field"><span className="ts-label">Instrument</span>
            <InstrumentCombobox
              value={instrument}
              onChange={setInstrument}
              onSelect={(r) => { setInstrument(r.symbol); setMarket(r.market) }}
            />
          </label>
```

Then remove `INSTRUMENTS` from the import on line 9 (keep `pipInfo`):

```tsx
import { pipInfo } from '@/lib/instruments'
```

- [ ] **Step 4: Type-check, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all green (the `name="instrument"` input stays inside the form, so `createTrade` FormData is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/InstrumentCombobox.tsx src/app/_components/TradeModalProvider.tsx src/app/globals.css
git commit -m "feat(journal): real instrument search combobox in trade modal"
```

---

### Task 5: LivePriceChip component + entry autofill wiring

**Files:**
- Create: `app/src/app/_components/LivePriceChip.tsx`
- Modify: `app/src/app/_components/TradeModalProvider.tsx` (entry price field, ~line 200)
- Modify: `app/src/app/globals.css` (append chip styles)

**Interfaces:**
- Consumes: `GET /api/market/quote` (Task 3).
- Produces: `<LivePriceChip symbol onUse />` — renders nothing until a quote
  arrives; `onUse(price: string)` autofills entry. Proxy quotes show a
  `via DIA` label and NO Use button (spec rule).

- [ ] **Step 1: Create the component**

Create `app/src/app/_components/LivePriceChip.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Quote = { symbol: string; price: number; at: number; proxy?: string }

function fmt(price: number): string {
  if (price >= 1000) return price.toFixed(2)
  if (price >= 10) return price.toFixed(3)
  return price.toFixed(5)
}

export function LivePriceChip({ symbol, onUse }: { symbol: string; onUse: (price: string) => void }) {
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const s = symbol.trim().toUpperCase()
    const id = ++seq.current
    if (!s) { setQuote(null); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/market/quote?symbol=${encodeURIComponent(s)}`)
      const json = res.ok ? ((await res.json()) as { quote?: Quote }) : null
      if (id !== seq.current) return
      setQuote(json?.quote && Number.isFinite(json.quote.price) ? json.quote : null)
    } catch {
      if (id === seq.current) setQuote(null)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [symbol])

  // Debounce: waits out fast symbol changes (typing) before spending a quote credit.
  useEffect(() => {
    const t = setTimeout(load, 500)
    return () => clearTimeout(t)
  }, [load])

  if (!quote) return null
  return (
    <span className="ts-pricechip">
      <span className="ts-pricechip-dot" data-loading={loading} />
      <span className="ts-pricechip-val">{fmt(quote.price)}</span>
      {quote.proxy && <span className="ts-pricechip-proxy">via {quote.proxy}</span>}
      {!quote.proxy && (
        <button type="button" className="ts-pricechip-use" onClick={() => onUse(String(quote.price))}>
          Use
        </button>
      )}
      <button type="button" className="ts-pricechip-refresh" onClick={load} title="Refresh price">↻</button>
    </span>
  )
}
```

- [ ] **Step 2: Append styles**

Append to `app/src/app/globals.css`:

```css
/* Live price chip (trade modal entry field) */
.ts-pricechip {
  display: inline-flex; align-items: center; gap: 6px; margin-top: 6px;
  padding: 3px 8px; border-radius: 99px; font-size: 12px; font-weight: 600;
  background: var(--violet-soft, #f3efff); color: var(--violet-deep, #5b21b6);
  width: fit-content;
}
.ts-pricechip-dot {
  width: 6px; height: 6px; border-radius: 99px; background: #22c55e;
}
.ts-pricechip-dot[data-loading='true'] { background: #f59e0b; }
.ts-pricechip-proxy { font-weight: 500; opacity: 0.7; font-size: 11px; }
.ts-pricechip-use, .ts-pricechip-refresh {
  border: 0; background: transparent; cursor: pointer; font: inherit;
  color: var(--violet-br, #7c3aed); font-weight: 700; padding: 0 2px;
}
.ts-pricechip-use:hover, .ts-pricechip-refresh:hover { text-decoration: underline; }
```

- [ ] **Step 3: Wire into the trade modal**

In `app/src/app/_components/TradeModalProvider.tsx`:

Add import:

```tsx
import { LivePriceChip } from './LivePriceChip'
```

Replace the entry price field (currently ~lines 200-201):

```tsx
          <label className="ts-field"><span className="ts-label">Entry price</span>
            <input name="entry_price" className="ts-input ts-input--lg" value={entry} onChange={(e) => setEntry(e.target.value)} inputMode="decimal" placeholder="0.00000" /></label>
```

with:

```tsx
          <label className="ts-field"><span className="ts-label">Entry price</span>
            <input name="entry_price" className="ts-input ts-input--lg" value={entry} onChange={(e) => setEntry(e.target.value)} inputMode="decimal" placeholder="0.00000" />
            <LivePriceChip symbol={instrument} onUse={setEntry} />
          </label>
```

- [ ] **Step 4: Type-check, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/LivePriceChip.tsx src/app/_components/TradeModalProvider.tsx src/app/globals.css
git commit -m "feat(journal): live price chip with entry autofill"
```

---

### Task 6: env plumbing + end-to-end preview verification

**Files:**
- Modify: `app/.env.example` (append)
- Modify: `app/.env.local` (append — only if the user has provided a key)

- [ ] **Step 1: Document the env var**

Append to `app/.env.example`:

```bash
# Twelve Data market data (symbol search + live quotes in trade journal).
# Free tier: https://twelvedata.com — 800 credits/day. Unset = static search only, no price chip.
TWELVEDATA_API_KEY=
```

If the user has supplied a real key, add `TWELVEDATA_API_KEY=<key>` to `app/.env.local`. Never commit `.env.local`.

- [ ] **Step 2: Preview verification (no key — degraded mode)**

Start the dev server via the browser preview tooling (launch.json config), open the app logged in as a demo user, open Quick Trade Capture:
- Type `gbp` in Instrument → static catalog matches appear (GBP/USD, GBP/JPY).
- Select one with keyboard (arrows + Enter) → market select flips to `forex`.
- No price chip appears (no key). Save a trade → still works.

- [ ] **Step 3: Preview verification (with key, once provided)**

- Type `tesla` → TSLA (NASDAQ, stocks badge) appears; select → market flips to `stocks`.
- Price chip appears under Entry price; click **Use** → entry fills.
- Type `US30` → chip shows price with `via DIA` label and NO Use button.
- Check server logs for repeated identical provider calls within 60 s (should be none — cache).
- **Index check from spec:** try quoting `SPX500` directly against Twelve Data with the real key (`curl "https://api.twelvedata.com/price?symbol=SPX&apikey=..."`). If the free tier serves real index data, drop entries from `INDEX_PROXIES` accordingly (delete the mapping; direct symbol then flows through) and update the map's comment.

- [ ] **Step 4: Screenshot proof + commit**

Screenshot combobox open + price chip visible; share with user.

```bash
git add .env.example
git commit -m "docs: TWELVEDATA_API_KEY env documentation"
```
