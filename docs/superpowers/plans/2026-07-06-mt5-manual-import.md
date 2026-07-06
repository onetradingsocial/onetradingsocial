# MT5 Manual Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trader-tier users import closed trades from an MT5 history report (HTML/XLSX/CSV) via a new Import tab in the add-journal popup.

**Architecture:** Pure parser + mapper in `app/src/lib/mt5.ts` (three format readers each yield `string[][]`; one shared extractor finds the Positions table). Two thin server actions (`parse` = no write, `commit` = upsert keyed on `(user_id, broker_deal_id)`). UI is a second tab inside the existing `TradeModal`. Gating via existing `canFlag` feature-flag system: `mt5_import: 'trader'`.

**Tech Stack:** Next.js 15 server actions, Supabase (postgres + RLS), Vitest, `xlsx` package (new dep, server-side only).

**Spec:** `docs/superpowers/specs/2026-07-06-mt5-manual-import-design.md`

## Global Constraints

- Working dir for all commands: `D:\Work\OneTradingSocial\Website\app` (npm scripts live there).
- Tests: `npm test` (vitest, unit tests in `app/tests/unit/`, `@/` alias resolves to `app/src/`).
- Auth in mutations uses `supabase.auth.getUser()` (project rule: getUser for mutations).
- Feature gate must be checked server-side in BOTH actions, not just UI.
- Times in MT5 reports are broker-server time; store as-is with `Z` suffix (documented caveat in spec).
- All code follows existing style: no semicolon-heavy blocks, single quotes, existing `ts-*` CSS classes reused.
- Deviation from spec (approved rationale): unique index is full, not partial — Postgres treats NULLs as distinct so manual trades (`broker_deal_id IS NULL`) are unaffected, and a full index is required for supabase-js `onConflict` upserts.

---

### Task 1: Feature gate keys

**Files:**
- Modify: `app/src/lib/entitlements.ts:53-91` (Feature type + FEATURE_MIN_TIER)
- Test: `app/tests/unit/feature-flags.test.ts`

**Interfaces:**
- Produces: `Feature` union gains `'mt5_import' | 'mt5_autosync'`; `FEATURE_MIN_TIER.mt5_import === 'trader'`, `FEATURE_MIN_TIER.mt5_autosync === 'pro'`. Later tasks call `canFlag(flags, tier, 'mt5_import')`.

- [ ] **Step 1: Write the failing test**

Append to `app/tests/unit/feature-flags.test.ts`:

```ts
describe('mt5 feature gates', () => {
  it('mt5_import is trader+', () => {
    expect(canFlag({}, 'free', 'mt5_import')).toBe(false)
    expect(canFlag({}, 'trader', 'mt5_import')).toBe(true)
    expect(canFlag({}, 'pro', 'mt5_import')).toBe(true)
  })
  it('mt5_autosync is pro only', () => {
    expect(canFlag({}, 'trader', 'mt5_autosync')).toBe(false)
    expect(canFlag({}, 'pro', 'mt5_autosync')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/feature-flags.test.ts`
Expected: FAIL — TS error / assertion fail (`'mt5_import'` not assignable to `Feature`).

- [ ] **Step 3: Implement**

In `app/src/lib/entitlements.ts`, extend the `Feature` union (after `'premium_challenges' | 'xp_boosts' | 'priority_support' | 'early_access'`):

```ts
  | 'premium_challenges' | 'xp_boosts' | 'priority_support' | 'early_access'
  | 'mt5_import' | 'mt5_autosync'
```

And in `FEATURE_MIN_TIER`, under the "Enforced in v1" block add:

```ts
  mt5_import: 'trader',
```

Under the "Wired, enforced when built" block add:

```ts
  mt5_autosync: 'pro',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/feature-flags.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/entitlements.ts tests/unit/feature-flags.test.ts
git commit -m "feat(entitlements): wire mt5_import (trader) and mt5_autosync (pro) gates"
```

---

### Task 2: Migration 0015 — broker_deal_id + nullable stop

**Files:**
- Create: `app/supabase/migrations/0015_mt5_import.sql`

**Interfaces:**
- Produces: `trades.broker_deal_id text` (null for manual trades), unique index `trades_user_broker_deal_idx (user_id, broker_deal_id)`, `trades.stop_price` nullable. Task 6's upsert uses `onConflict: 'user_id,broker_deal_id'`.

- [ ] **Step 1: Write the migration**

Create `app/supabase/migrations/0015_mt5_import.sql`:

```sql
-- MT5 manual import (phase 1): external dedupe key + optional stop.
-- broker_deal_id = MT5 position ticket. Unique per user; NULLs (manual
-- trades) are distinct so the index does not constrain them.
alter table public.trades
  add column if not exists broker_deal_id text;

create unique index if not exists trades_user_broker_deal_idx
  on public.trades (user_id, broker_deal_id);

-- Imported MT5 trades often carry no stop loss.
alter table public.trades
  alter column stop_price drop not null;
```

- [ ] **Step 2: Apply the migration**

Apply the same way previous migrations (0001–0014) were applied for this project — Supabase SQL editor paste, or if the CLI is linked:

```bash
npx supabase db push
```

Verify:

```sql
select column_name, is_nullable from information_schema.columns
where table_name = 'trades' and column_name in ('broker_deal_id', 'stop_price');
```

Expected: `broker_deal_id | YES`, `stop_price | YES`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0015_mt5_import.sql
git commit -m "feat(db): broker_deal_id dedupe key, nullable stop_price for mt5 import"
```

---

### Task 3: Parser core — decode + HTML reader + Positions extractor

**Files:**
- Create: `app/src/lib/mt5.ts`
- Create: `app/tests/fixtures/mt5/report.html` (fixture)
- Test: `app/tests/unit/mt5.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 4–6 and 8):

```ts
export type Mt5Deal = {
  ticket: string
  symbol: string
  direction: 'long' | 'short'
  lots: number
  openTime: string      // ISO, Z suffix (broker server time, documented caveat)
  closeTime: string     // ISO
  openPrice: number
  closePrice: number
  stopPrice: number | null
  targetPrice: number | null
  commission: number
  swap: number
  profit: number        // raw profit column
  netPnl: number        // profit + commission + swap
}
export type Mt5ParseResult = { deals: Mt5Deal[]; skipped: number }
export function parseMt5(buf: ArrayBuffer, filename: string): Mt5ParseResult | { error: string }
```

- [ ] **Step 1: Create the HTML fixture**

Create `app/tests/fixtures/mt5/report.html` (structurally faithful to a MetaQuotes history report: one big table, section header rows, positions with duplicate `Time`/`Price` column names, thousands separators, empty S/L):

```html
<html><head><meta charset="utf-8"><title>Trade History Report</title></head><body>
<table>
<tr><th colspan="13"><b>Trade History Report</b></th></tr>
<tr><th colspan="13"><b>Positions</b></th></tr>
<tr><td><b>Time</b></td><td><b>Position</b></td><td><b>Symbol</b></td><td><b>Type</b></td><td><b>Volume</b></td><td><b>Price</b></td><td><b>S / L</b></td><td><b>T / P</b></td><td><b>Time</b></td><td><b>Price</b></td><td><b>Commission</b></td><td><b>Swap</b></td><td><b>Profit</b></td></tr>
<tr align="right"><td>2026.06.01 09:30:00</td><td>123456</td><td>EURUSD</td><td>buy</td><td>0.50</td><td>1.08500</td><td>1.08200</td><td>1.09100</td><td>2026.06.01 14:45:10</td><td>1.09050</td><td>-2.50</td><td>0.00</td><td>272.50</td></tr>
<tr align="right"><td>2026.06.02 10:00:00</td><td>123457</td><td>XAUUSD.a</td><td>sell</td><td>0.10</td><td>2 350.00</td><td></td><td></td><td>2026.06.02 16:20:00</td><td>2 362.50</td><td>-1.20</td><td>-0.80</td><td>-1 250.00</td></tr>
<tr align="right"><td>2026.06.03 08:15:00</td><td>123458</td><td>US30</td><td>buy</td><td>1.00</td><td>39 100.0</td><td>39 000.0</td><td></td><td>2026.06.03 12:00:00</td><td>39 100.0</td><td>0.00</td><td>0.00</td><td>0.00</td></tr>
<tr><th colspan="13"><b>Orders</b></th></tr>
<tr><td>2026.06.01 09:29:58</td><td>223456</td><td>EURUSD</td><td>buy</td><td>0.50 / 0.50</td><td>1.08500</td><td></td><td></td><td>2026.06.01 09:30:00</td><td>filled</td><td></td><td></td><td></td></tr>
<tr><th colspan="13"><b>Results</b></th></tr>
<tr><td colspan="13">Total Net Profit: -977.50</td></tr>
</table>
</body></html>
```

- [ ] **Step 2: Write the failing tests**

Create `app/tests/unit/mt5.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseMt5 } from '@/lib/mt5'

const FIX = join(__dirname, '..', 'fixtures', 'mt5')
const load = (name: string) => {
  const b = readFileSync(join(FIX, name))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

describe('parseMt5 — HTML report', () => {
  const res = parseMt5(load('report.html'), 'report.html')

  it('parses all closed positions, ignores Orders/Results sections', () => {
    expect('deals' in res && res.deals).toHaveLength(3)
  })

  it('maps a buy position', () => {
    if ('error' in res) throw new Error(res.error)
    const d = res.deals[0]
    expect(d).toMatchObject({
      ticket: '123456', symbol: 'EURUSD', direction: 'long', lots: 0.5,
      openPrice: 1.085, closePrice: 1.0905, stopPrice: 1.082, targetPrice: 1.091,
      commission: -2.5, swap: 0, profit: 272.5,
    })
    expect(d.netPnl).toBeCloseTo(270)
    expect(d.openTime).toBe('2026-06-01T09:30:00Z')
    expect(d.closeTime).toBe('2026-06-01T14:45:10Z')
  })

  it('handles sell, missing S/L-T/P, suffixed symbol, thousands separators', () => {
    if ('error' in res) throw new Error(res.error)
    const d = res.deals[1]
    expect(d).toMatchObject({
      ticket: '123457', symbol: 'XAUUSD.a', direction: 'short', lots: 0.1,
      openPrice: 2350, closePrice: 2362.5, stopPrice: null, targetPrice: null,
    })
    expect(d.netPnl).toBeCloseTo(-1252)
  })

  it('breakeven position parses with zero net', () => {
    if ('error' in res) throw new Error(res.error)
    expect(res.deals[2].netPnl).toBe(0)
  })

  it('rejects a file with no Positions table', () => {
    const junk = new TextEncoder().encode('<html><body><p>hello</p></body></html>').buffer as ArrayBuffer
    const r = parseMt5(junk, 'junk.html')
    expect('error' in r).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/unit/mt5.test.ts`
Expected: FAIL — cannot resolve `@/lib/mt5`.

- [ ] **Step 4: Implement `app/src/lib/mt5.ts`**

```ts
// MT5 history-report parser + trade mapper. Pure module: no server deps,
// fully unit-testable. Three format readers (HTML/CSV/XLSX) each produce
// string[][]; one extractor locates the Positions table and normalizes rows.
import { pipInfo } from '@/lib/instruments'

export type Mt5Deal = {
  ticket: string
  symbol: string
  direction: 'long' | 'short'
  lots: number
  openTime: string
  closeTime: string
  openPrice: number
  closePrice: number
  stopPrice: number | null
  targetPrice: number | null
  commission: number
  swap: number
  profit: number
  netPnl: number
}

export type Mt5ParseResult = { deals: Mt5Deal[]; skipped: number }

const NO_POSITIONS =
  'No closed trades found. In MT5: right-click Account History → Report → HTML (or Open XML), then upload that file.'

/** MT5 saves reports as UTF-16LE (BOM FF FE) or UTF-8. */
function decodeReport(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf)
  }
  return new TextDecoder('utf-8').decode(buf)
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

/** HTML → rows of cell text. */
function htmlToRows(html: string): string[][] {
  const rows: string[][] = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
  let tr: RegExpExecArray | null
  while ((tr = trRe.exec(html))) {
    const cells: string[] = []
    let td: RegExpExecArray | null
    cellRe.lastIndex = 0
    while ((td = cellRe.exec(tr[1]))) cells.push(stripTags(td[1]))
    if (cells.length) rows.push(cells)
  }
  return rows
}

/** Minimal CSV reader with quoted-field support. Auto-detects , or ; */
function csvToRows(text: string): string[][] {
  const sep = (text.split(';').length > text.split(',').length) ? ';' : ','
  const rows: string[][] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (ch === '"') inQ = false
        else cur += ch
      } else if (ch === '"') inQ = true
      else if (ch === sep) { cells.push(cur.trim()); cur = '' }
      else cur += ch
    }
    cells.push(cur.trim())
    rows.push(cells)
  }
  return rows
}

/** '1 234.56' / '−12.3' / '' → number | null. */
function num(v: string | undefined): number | null {
  if (v == null) return null
  const cleaned = v.replace(/[\s  ]/g, '').replace(/−/g, '-').replace(/,/g, '.')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** '2026.06.01 09:30:00' → '2026-06-01T09:30:00Z' (broker server time). */
function toIso(v: string | undefined): string | null {
  if (!v) return null
  const m = v.trim().match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}Z`
}

/** Locate the Positions header row and parse rows beneath it. Column layout
 *  (MetaQuotes report): Time, Position, Symbol, Type, Volume, Price, S/L,
 *  T/P, Time, Price, Commission, Swap, Profit. Rows stop at the next
 *  section header (Orders/Deals/Results) or first unparseable row. */
function extractPositions(rows: string[][]): Mt5ParseResult | { error: string } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
  let header = -1
  for (let i = 0; i < rows.length; i++) {
    const n = rows[i].map(norm)
    if (n.includes('position') && n.includes('symbol') && n.includes('type') && n.includes('volume')) {
      header = i
      break
    }
  }
  if (header === -1) return { error: NO_POSITIONS }

  const cols = rows[header].map(norm)
  const idx = {
    openTime: cols.indexOf('time'),
    ticket: cols.indexOf('position'),
    symbol: cols.indexOf('symbol'),
    type: cols.indexOf('type'),
    volume: cols.indexOf('volume'),
    openPrice: cols.indexOf('price'),
    sl: cols.indexOf('sl'),
    tp: cols.indexOf('tp'),
    closeTime: cols.indexOf('time', cols.indexOf('time') + 1),
    closePrice: cols.indexOf('price', cols.indexOf('price') + 1),
    commission: cols.indexOf('commission'),
    swap: cols.indexOf('swap'),
    profit: cols.indexOf('profit'),
  }

  const deals: Mt5Deal[] = []
  let skipped = 0
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i]
    const first = norm(r[0] ?? '')
    if (r.length <= 3 || first === 'orders' || first === 'deals' || first === 'results') break

    const ticket = (r[idx.ticket] ?? '').trim()
    const type = (r[idx.type] ?? '').trim().toLowerCase()
    const openTime = toIso(r[idx.openTime])
    const closeTime = toIso(r[idx.closeTime])
    const lots = num(r[idx.volume]?.split('/')[0])
    const openPrice = num(r[idx.openPrice])
    const closePrice = num(r[idx.closePrice])
    const profit = num(r[idx.profit])

    if (!ticket || !openTime || !closeTime || lots == null || openPrice == null ||
        closePrice == null || profit == null || (type !== 'buy' && type !== 'sell')) {
      skipped++
      continue
    }

    const commission = num(r[idx.commission]) ?? 0
    const swap = num(r[idx.swap]) ?? 0
    deals.push({
      ticket,
      symbol: (r[idx.symbol] ?? '').trim(),
      direction: type === 'buy' ? 'long' : 'short',
      lots,
      openTime,
      closeTime,
      openPrice,
      closePrice,
      stopPrice: idx.sl === -1 ? null : num(r[idx.sl]),
      targetPrice: idx.tp === -1 ? null : num(r[idx.tp]),
      commission,
      swap,
      profit,
      netPnl: Math.round((profit + commission + swap) * 100) / 100,
    })
  }
  if (deals.length === 0) return { error: NO_POSITIONS }
  return { deals, skipped }
}

export function parseMt5(buf: ArrayBuffer, filename: string): Mt5ParseResult | { error: string } {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  try {
    if (ext === 'html' || ext === 'htm') return extractPositions(htmlToRows(decodeReport(buf)))
    if (ext === 'csv') return extractPositions(csvToRows(decodeReport(buf)))
    if (ext === 'xlsx') return extractPositions(xlsxToRows(buf))
    return { error: 'Unsupported file type. Upload an MT5 report as HTML, XLSX, or CSV.' }
  } catch {
    return { error: 'Could not read this file. Export a fresh report from MT5 and try again.' }
  }
}

/** Placeholder until Task 4 — keeps parseMt5 compiling for HTML/CSV. */
function xlsxToRows(_buf: ArrayBuffer): string[][] {
  throw new Error('xlsx not supported yet')
}
```

Note: `pipInfo` import is used by Task 5's mapper — if the linter flags it as unused at this stage, add it in Task 5 instead.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/unit/mt5.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/mt5.ts tests/unit/mt5.test.ts tests/fixtures/mt5/report.html
git commit -m "feat(mt5): report parser core with html reader and positions extractor"
```

---

### Task 4: CSV + XLSX readers

**Files:**
- Modify: `app/src/lib/mt5.ts` (replace `xlsxToRows` placeholder)
- Create: `app/tests/fixtures/mt5/report.csv`
- Test: `app/tests/unit/mt5.test.ts` (append)

**Interfaces:**
- Consumes: `extractPositions(rows: string[][])` from Task 3.
- Produces: `parseMt5` handles `.csv` and `.xlsx` inputs. New dependency: `xlsx` package.

- [ ] **Step 1: Install the xlsx package**

```bash
npm install xlsx
```

- [ ] **Step 2: Create the CSV fixture**

Create `app/tests/fixtures/mt5/report.csv` (broker-variant headers — different names, same semantics):

```csv
Time;Position;Symbol;Type;Volume;Price;S / L;T / P;Time;Price;Commission;Swap;Profit
2026.06.01 09:30:00;123456;EURUSD;buy;0.50;1.08500;1.08200;1.09100;2026.06.01 14:45:10;1.09050;-2.50;0.00;272.50
2026.06.02 10:00:00;123457;GBPJPY;sell;1.00;198.500;;;2026.06.02 11:05:00;198.900;0.00;0.00;-263.94
```

- [ ] **Step 3: Write the failing tests**

Append to `app/tests/unit/mt5.test.ts`:

```ts
describe('parseMt5 — CSV', () => {
  it('parses semicolon CSV with same headers', () => {
    const r = parseMt5(load('report.csv'), 'report.csv')
    if ('error' in r) throw new Error(r.error)
    expect(r.deals).toHaveLength(2)
    expect(r.deals[1]).toMatchObject({ ticket: '123457', symbol: 'GBPJPY', direction: 'short', lots: 1 })
  })
})

describe('parseMt5 — XLSX', () => {
  it('parses a generated xlsx with the positions layout', () => {
    const XLSX = require('xlsx')
    const rows = [
      ['Positions'],
      ['Time', 'Position', 'Symbol', 'Type', 'Volume', 'Price', 'S / L', 'T / P', 'Time', 'Price', 'Commission', 'Swap', 'Profit'],
      ['2026.06.01 09:30:00', '123456', 'EURUSD', 'buy', '0.50', '1.08500', '1.08200', '1.09100', '2026.06.01 14:45:10', '1.09050', '-2.50', '0.00', '272.50'],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Report')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const r = parseMt5(buf, 'report.xlsx')
    if ('error' in r) throw new Error(r.error)
    expect(r.deals).toHaveLength(1)
    expect(r.deals[0].ticket).toBe('123456')
  })
})
```

- [ ] **Step 4: Run tests to verify XLSX fails**

Run: `npm test -- tests/unit/mt5.test.ts`
Expected: CSV test PASS already (reader existed from Task 3); XLSX test FAIL with "xlsx not supported yet".

- [ ] **Step 5: Implement xlsxToRows**

In `app/src/lib/mt5.ts`, add at the top:

```ts
import * as XLSX from 'xlsx'
```

Replace the placeholder `xlsxToRows` with:

```ts
function xlsxToRows(buf: ArrayBuffer): string[][] {
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' })
  return raw.map((row) => row.map((c) => String(c ?? '').trim()))
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/unit/mt5.test.ts`
Expected: PASS (all).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/mt5.ts tests/unit/mt5.test.ts tests/fixtures/mt5/report.csv
git commit -m "feat(mt5): csv and xlsx report readers"
```

---

### Task 5: Mapper + market inference + row validation

**Files:**
- Modify: `app/src/lib/mt5.ts` (append)
- Test: `app/tests/unit/mt5.test.ts` (append)

**Interfaces:**
- Consumes: `Mt5Deal` from Task 3; `pipInfo(instrument, market)` from `@/lib/instruments`.
- Produces (consumed by Task 6's commit action):

```ts
export function inferMarket(symbol: string): string
export function validateDeals(input: unknown): { deals: Mt5Deal[] } | { error: string }
export function mapDealToTrade(deal: Mt5Deal, opts: { userId: string; isPublic: boolean }): Record<string, unknown>
```

- [ ] **Step 1: Write the failing tests**

Append to `app/tests/unit/mt5.test.ts`:

```ts
import { inferMarket, mapDealToTrade, validateDeals, type Mt5Deal } from '@/lib/mt5'

const deal = (over: Partial<Mt5Deal> = {}): Mt5Deal => ({
  ticket: '123456', symbol: 'EURUSD', direction: 'long', lots: 0.5,
  openTime: '2026-06-01T09:30:00Z', closeTime: '2026-06-01T14:45:10Z',
  openPrice: 1.085, closePrice: 1.0905, stopPrice: 1.082, targetPrice: 1.091,
  commission: -2.5, swap: 0, profit: 272.5, netPnl: 270,
  ...over,
})

describe('inferMarket', () => {
  it('classifies symbols including broker suffixes', () => {
    expect(inferMarket('EURUSD')).toBe('forex')
    expect(inferMarket('GBPJPY.a')).toBe('forex')
    expect(inferMarket('XAUUSD')).toBe('commodities')
    expect(inferMarket('BTCUSD')).toBe('crypto')
    expect(inferMarket('US30')).toBe('indices')
    expect(inferMarket('AAPL')).toBe('stocks')
  })
})

describe('mapDealToTrade', () => {
  const opts = { userId: 'u1', isPublic: true }

  it('maps core fields for a closed win', () => {
    const row = mapDealToTrade(deal(), opts)
    expect(row).toMatchObject({
      user_id: 'u1', broker_deal_id: '123456', instrument: 'EURUSD', market: 'forex',
      direction: 'long', sizing_mode: 'lots', lots: 0.5,
      entry_price: 1.085, exit_price: 1.0905, stop_price: 1.082, target_price: 1.091,
      pnl_amount: 270, status: 'closed', outcome: 'win', is_public: true,
      traded_at: '2026-06-01T09:30:00Z', closed_at: '2026-06-01T14:45:10Z',
    })
  })

  it('computes risk/r-multiple when stop present', () => {
    const row = mapDealToTrade(deal(), opts) as { sl_pips: number; risk_amount: number; r_multiple: number }
    expect(row.sl_pips).toBeCloseTo(30)           // (1.085-1.082)/0.0001
    expect(row.risk_amount).toBeCloseTo(150)      // 30 pips * $10/lot * 0.5
    expect(row.r_multiple).toBeCloseTo(1.8)       // 270 / 150
  })

  it('null stop → zero sl_pips, null r_multiple, null stop_price', () => {
    const row = mapDealToTrade(deal({ stopPrice: null, targetPrice: null }), opts) as Record<string, unknown>
    expect(row.stop_price).toBeNull()
    expect(row.sl_pips).toBe(0)
    expect(row.r_multiple).toBeNull()
    expect(row.risk_amount).toBe(0)
  })

  it('outcome from net pnl sign', () => {
    expect(mapDealToTrade(deal({ netPnl: -50 }), opts).outcome).toBe('loss')
    expect(mapDealToTrade(deal({ netPnl: 0 }), opts).outcome).toBe('breakeven')
  })
})

describe('validateDeals', () => {
  it('accepts a valid array and rejects junk', () => {
    expect('deals' in validateDeals([deal()])).toBe(true)
    expect('error' in validateDeals('nope')).toBe(true)
    expect('error' in validateDeals([{ ...deal(), lots: Infinity }])).toBe(true)
    expect('error' in validateDeals([{ ...deal(), ticket: '' }])).toBe(true)
    expect('error' in validateDeals([{ ...deal(), direction: 'sideways' }])).toBe(true)
    expect('error' in validateDeals(Array(501).fill(deal()))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/mt5.test.ts`
Expected: FAIL — `inferMarket` etc. not exported.

- [ ] **Step 3: Implement (append to `app/src/lib/mt5.ts`)**

```ts
const CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'SGD', 'NOK', 'SEK', 'ZAR', 'MXN', 'PLN', 'TRY', 'CNH', 'HKD'])
const CRYPTO = /^(BTC|ETH|XRP|LTC|SOL|ADA|DOGE|DOT|BNB|AVAX)/
const INDICES = /^(US30|US100|US500|USTEC|NAS100|SPX|SP500|DJ30|GER30|GER40|DAX|DE40|UK100|FTSE|FRA40|EU50|JP225|JPN225|NIKKEI|HK50|AUS200)/
const METALS = /^(XAU|XAG|XPT|XPD|XTI|XBR|GOLD|SILVER|OIL|BRENT|WTI|NGAS|UKOIL|USOIL)/

/** Best-effort market class from a raw broker symbol (suffixes stripped). */
export function inferMarket(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9].*$/, '')
  if (METALS.test(s)) return 'commodities'
  if (CRYPTO.test(s)) return 'crypto'
  if (INDICES.test(s)) return 'indices'
  if (s.length >= 6 && CURRENCIES.has(s.slice(0, 3)) && CURRENCIES.has(s.slice(3, 6))) return 'forex'
  return 'stocks'
}

const MAX_COMMIT_ROWS = 500

/** Server-side re-validation of client-echoed rows before commit. */
export function validateDeals(input: unknown): { deals: Mt5Deal[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Nothing to import.' }
  if (input.length > MAX_COMMIT_ROWS) return { error: `Too many rows (max ${MAX_COMMIT_ROWS} per import).` }
  const deals: Mt5Deal[] = []
  for (const raw of input) {
    if (typeof raw !== 'object' || raw == null) return { error: 'Invalid import payload.' }
    const d = raw as Record<string, unknown>
    const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
    const finOrNull = (v: unknown) => v === null || fin(v)
    const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
    if (
      typeof d.ticket !== 'string' || !d.ticket.trim() || d.ticket.length > 32 ||
      typeof d.symbol !== 'string' || !d.symbol.trim() || d.symbol.length > 32 ||
      (d.direction !== 'long' && d.direction !== 'short') ||
      !fin(d.lots) || (d.lots as number) <= 0 ||
      !fin(d.openPrice) || !fin(d.closePrice) || !fin(d.netPnl) ||
      !fin(d.commission) || !fin(d.swap) || !fin(d.profit) ||
      !finOrNull(d.stopPrice) || !finOrNull(d.targetPrice) ||
      typeof d.openTime !== 'string' || !isoRe.test(d.openTime) ||
      typeof d.closeTime !== 'string' || !isoRe.test(d.closeTime)
    ) return { error: 'Invalid import payload.' }
    deals.push({
      ticket: d.ticket.trim(), symbol: d.symbol.trim(), direction: d.direction,
      lots: d.lots as number, openTime: d.openTime, closeTime: d.closeTime,
      openPrice: d.openPrice as number, closePrice: d.closePrice as number,
      stopPrice: (d.stopPrice ?? null) as number | null,
      targetPrice: (d.targetPrice ?? null) as number | null,
      commission: d.commission as number, swap: d.swap as number,
      profit: d.profit as number, netPnl: d.netPnl as number,
    })
  }
  return { deals }
}

/** Mt5Deal → trades insert row. Journaling fields stay empty for the user
 *  to enrich. r_multiple only when a stop exists (risk is defined). */
export function mapDealToTrade(deal: Mt5Deal, opts: { userId: string; isPublic: boolean }): Record<string, unknown> {
  const market = inferMarket(deal.symbol)
  const { pipSize, pipValuePerLot } = pipInfo(deal.symbol, market)

  let slPips = 0
  let riskAmount = 0
  let rMultiple: number | null = null
  if (deal.stopPrice != null && deal.stopPrice > 0) {
    slPips = Math.abs(deal.openPrice - deal.stopPrice) / pipSize
    riskAmount = slPips * pipValuePerLot * deal.lots
    if (riskAmount > 0) rMultiple = Math.round((deal.netPnl / riskAmount) * 100) / 100
  }

  const dirSign = deal.direction === 'long' ? 1 : -1
  const realizedPips = ((deal.closePrice - deal.openPrice) * dirSign) / pipSize

  return {
    user_id: opts.userId,
    broker_deal_id: deal.ticket,
    market,
    instrument: deal.symbol,
    direction: deal.direction,
    sizing_mode: 'lots',
    lots: deal.lots,
    risk_percent: null,
    entry_price: deal.openPrice,
    exit_price: deal.closePrice,
    stop_price: deal.stopPrice,
    target_price: deal.targetPrice,
    risk_amount: riskAmount,
    sl_pips: slPips,
    tp_pips: null,
    planned_rr: null,
    r_multiple: rMultiple,
    pnl_amount: deal.netPnl,
    realized_pips: Math.round(realizedPips * 10) / 10,
    outcome: deal.netPnl > 0 ? 'win' : deal.netPnl < 0 ? 'loss' : 'breakeven',
    status: 'closed',
    is_public: opts.isPublic,
    traded_at: deal.openTime,
    closed_at: deal.closeTime,
  }
}
```

Check `pipInfo('EURUSD', 'forex')` returns `pipSize 0.0001`, `pipValuePerLot 10` (read `app/src/lib/instruments.ts` to confirm; adjust the risk test numbers if the actual pip values differ — the assertions in Step 1 assume 0.0001/$10).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/mt5.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mt5.ts tests/unit/mt5.test.ts
git commit -m "feat(mt5): deal-to-trade mapper, market inference, commit validation"
```

---

### Task 6: Server actions — parse + commit

**Files:**
- Create: `app/src/app/actions/mt5-import.ts`

**Interfaces:**
- Consumes: `parseMt5`, `validateDeals`, `mapDealToTrade`, `Mt5Deal` (lib/mt5); `getTier` (`@/lib/server/entitlements`); `getFeatureFlags` (`@/lib/server/feature-flags`); `canFlag` (`@/lib/feature-flags`); `createClient` (`@/lib/supabase/server`).
- Produces (consumed by Task 8 UI):

```ts
export type ParsedRow = Mt5Deal & { duplicate: boolean }
export type Mt5ParseState = { rows?: ParsedRow[]; skipped?: number; error?: string }
export async function parseMt5Statement(formData: FormData): Promise<Mt5ParseState>
export type Mt5CommitState = { inserted?: number; error?: string }
export async function commitMt5Import(deals: Mt5Deal[]): Promise<Mt5CommitState>
```

- [ ] **Step 1: Implement `app/src/app/actions/mt5-import.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { parseMt5, validateDeals, mapDealToTrade, type Mt5Deal } from '@/lib/mt5'
import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_BYTES = 5 * 1024 * 1024
const GATE_ERROR = 'MT5 import is available on the Trader plan and above.'

async function gate(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const tier = await getTier(supabase, userId)
  const flags = await getFeatureFlags()
  return canFlag(flags, tier, 'mt5_import') ? null : GATE_ERROR
}

export type ParsedRow = Mt5Deal & { duplicate: boolean }
export type Mt5ParseState = { rows?: ParsedRow[]; skipped?: number; error?: string }

export async function parseMt5Statement(formData: FormData): Promise<Mt5ParseState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gateErr = await gate(supabase, user.id)
  if (gateErr) return { error: gateErr }

  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'No file received.' }
  if (file.size > MAX_BYTES) return { error: 'File too large (max 5 MB).' }

  const parsed = parseMt5(await file.arrayBuffer(), file.name)
  if ('error' in parsed) return { error: parsed.error }

  const tickets = parsed.deals.map((d) => d.ticket)
  const { data: existing } = await supabase
    .from('trades').select('broker_deal_id')
    .eq('user_id', user.id).in('broker_deal_id', tickets)
  const dupes = new Set((existing ?? []).map((r) => r.broker_deal_id))

  return {
    rows: parsed.deals.map((d) => ({ ...d, duplicate: dupes.has(d.ticket) })),
    skipped: parsed.skipped,
  }
}

export type Mt5CommitState = { inserted?: number; error?: string }

export async function commitMt5Import(deals: Mt5Deal[]): Promise<Mt5CommitState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const gateErr = await gate(supabase, user.id)
  if (gateErr) return { error: gateErr }

  const valid = validateDeals(deals)
  if ('error' in valid) return { error: valid.error }

  const { data: profile } = await supabase
    .from('profiles').select('is_public').eq('id', user.id).single()
  const isPublic = profile?.is_public ?? true

  const rows = valid.deals.map((d) => mapDealToTrade(d, { userId: user.id, isPublic }))
  const { data, error } = await supabase
    .from('trades')
    .upsert(rows, { onConflict: 'user_id,broker_deal_id', ignoreDuplicates: true })
    .select('id')
  if (error) return { error: error.message }

  revalidatePath('/journal')
  return { inserted: data?.length ?? 0 }
}
```

- [ ] **Step 2: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests PASS. (Action logic is thin glue over the tested lib; no supabase-mocking infra exists in this repo, so no action-level unit test — the gate helper's `canFlag` behavior is covered by Task 1's tests.)

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/mt5-import.ts
git commit -m "feat(mt5): parse and commit server actions with trader-tier gate"
```

---

### Task 7: Layout plumbing — canMt5Import into modal config

**Files:**
- Modify: `app/src/app/layout.tsx:20-28`
- Modify: `app/src/app/_components/TradeModalProvider.tsx:13` (Config type)

**Interfaces:**
- Consumes: `getTier`, `getFeatureFlags`, `canFlag` (same as Task 6).
- Produces: `Config` gains `canMt5Import: boolean`; Task 8 reads `config.canMt5Import`.

- [ ] **Step 1: Extend Config type**

In `app/src/app/_components/TradeModalProvider.tsx` change:

```ts
type Config = { accountBalance: number; defaultPublic: boolean }
```

to:

```ts
type Config = { accountBalance: number; defaultPublic: boolean; canMt5Import: boolean }
```

- [ ] **Step 2: Compute it in layout**

In `app/src/app/layout.tsx`, add imports:

```ts
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
```

Replace the config block inside `if (user) { ... }`:

```ts
  if (user) {
    const [{ data }, tier, flags] = await Promise.all([
      supabase.from('profiles').select('account_balance, is_public').eq('id', user.id).single(),
      getTier(supabase, user.id),
      getFeatureFlags(),
    ])
    config = {
      accountBalance: data?.account_balance ?? 0,
      defaultPublic: data?.is_public ?? true,
      canMt5Import: canFlag(flags, tier, 'mt5_import'),
    }
  }
```

Note: `getTier` calls `supabase.auth.getUser()` internally — this is layout (read path), but the call already happens per-request in middleware; acceptable here since tier gating must be trustworthy. If review flags it, swap to reading `subscriptions` directly; do not silently weaken the gate.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (`TradeModal` doesn't use the new field yet — added in Task 8.)

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/_components/TradeModalProvider.tsx
git commit -m "feat(mt5): expose canMt5Import through trade-modal config"
```

---

### Task 8: Import tab UI — upload → review → commit

**Files:**
- Create: `app/src/app/_components/Mt5ImportTab.tsx`
- Modify: `app/src/app/_components/TradeModalProvider.tsx` (tab switcher in `TradeModal`)
- Modify: `app/src/app/globals.css` (small table styles, appended)

**Interfaces:**
- Consumes: `parseMt5Statement`, `commitMt5Import`, `ParsedRow` (Task 6); `config.canMt5Import` (Task 7); existing CSS classes `ts-field`, `ts-label`, `ts-dropzone`, `ts-error`, `ts-modal-foot`, `btn btn-primary`, `ts-subtabs`, `faint`.
- Produces: `<Mt5ImportTab canImport onDone />` component.

- [ ] **Step 1: Create `app/src/app/_components/Mt5ImportTab.tsx`**

```tsx
'use client'

import { useRef, useState } from 'react'
import { parseMt5Statement, commitMt5Import, type ParsedRow } from '@/app/actions/mt5-import'

const fmtTime = (iso: string) => iso.replace('T', ' ').replace('Z', '').slice(0, 16)
const fmtPnl = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}`

export function Mt5ImportTab({ canImport, onDone }: { canImport: boolean; onDone: () => void }) {
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [skipped, setSkipped] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  if (!canImport) {
    return (
      <div className="ts-mt5-locked">
        <span style={{ fontSize: 28 }}>🔒</span>
        <p className="ts-sub" style={{ margin: '8px 0 12px' }}>
          Import your MT5 trade history automatically with the Trader plan.
        </p>
        <a href="/settings/billing" className="btn btn-primary">Upgrade to Trader</a>
      </div>
    )
  }

  async function onFile(file: File | null) {
    if (!file) return
    setPending(true); setError('')
    const fd = new FormData()
    fd.set('file', file)
    const res = await parseMt5Statement(fd)
    setPending(false)
    if (res.error) { setError(res.error); return }
    setRows(res.rows ?? [])
    setSkipped(res.skipped ?? 0)
    setExcluded(new Set())
  }

  async function onConfirm() {
    if (!rows) return
    const selected = rows.filter((r) => !r.duplicate && !excluded.has(r.ticket))
      .map(({ duplicate: _d, ...deal }) => deal)
    if (selected.length === 0) { setError('Nothing selected.'); return }
    setPending(true); setError('')
    const res = await commitMt5Import(selected)
    setPending(false)
    if (res.error) { setError(res.error); return }
    onDone()
  }

  if (!rows) {
    return (
      <div>
        <button type="button" className="ts-dropzone" onClick={() => fileRef.current?.click()} disabled={pending}>
          <span className="ts-dropzone-icon">⬆</span>
          <span className="ts-dropzone-main">{pending ? 'Parsing…' : 'Upload MT5 history report'}</span>
          <span className="faint" style={{ fontSize: 12 }}>HTML, XLSX or CSV up to 5MB</span>
        </button>
        <input
          ref={fileRef} type="file" accept=".html,.htm,.xlsx,.csv" className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <p className="faint mt-3" style={{ fontSize: 12 }}>
          In MT5: right-click your Account History → Report → HTML (or Open XML), then upload the file here.
          Trade times use your broker&#39;s server time.
        </p>
        {error && <p className="ts-error mt-4">{error}</p>}
      </div>
    )
  }

  const dupes = rows.filter((r) => r.duplicate).length
  const selectedCount = rows.length - dupes - excluded.size

  return (
    <div>
      <div className="ts-mt5-tablewrap">
        <table className="ts-mt5-table">
          <thead>
            <tr><th></th><th>Symbol</th><th>Side</th><th>Lots</th><th>Opened</th><th>Closed</th><th>Net P&L</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticket} data-dupe={r.duplicate || undefined}>
                <td>
                  <input
                    type="checkbox" disabled={r.duplicate}
                    checked={!r.duplicate && !excluded.has(r.ticket)}
                    onChange={(e) => {
                      const next = new Set(excluded)
                      if (e.target.checked) next.delete(r.ticket); else next.add(r.ticket)
                      setExcluded(next)
                    }}
                  />
                </td>
                <td>{r.symbol}</td>
                <td>{r.direction === 'long' ? '↗ Buy' : '↘ Sell'}</td>
                <td>{r.lots}</td>
                <td>{fmtTime(r.openTime)}</td>
                <td>{r.duplicate ? <span className="faint">already imported</span> : fmtTime(r.closeTime)}</td>
                <td className={r.netPnl >= 0 ? 'ts-pos' : 'ts-neg'}>{fmtPnl(r.netPnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="faint mt-2" style={{ fontSize: 12 }}>
        {selectedCount} selected · {dupes} duplicate{dupes === 1 ? '' : 's'} skipped
        {skipped > 0 ? ` · ${skipped} unreadable row${skipped === 1 ? '' : 's'} ignored` : ''}
      </p>
      {error && <p className="ts-error mt-4">{error}</p>}
      <div className="ts-modal-foot mt-5">
        <button type="button" className="btn" onClick={() => { setRows(null); setError('') }} disabled={pending}>← Back</button>
        <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={pending || selectedCount === 0}>
          {pending ? 'Importing…' : `✓ Import ${selectedCount} trade${selectedCount === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the tab switcher to `TradeModal`**

In `app/src/app/_components/TradeModalProvider.tsx`:

Import at top:

```ts
import { Mt5ImportTab } from './Mt5ImportTab'
```

Inside `TradeModal`, add state next to `pending`/`error`:

```ts
const [tab, setTab] = useState<'manual' | 'import'>('manual')
```

The modal is currently a single `<form>`. Restructure the return so the shell (backdrop, head, tabs) wraps whichever tab is active — the manual `<form>` stays byte-identical inside:

```tsx
return (
  <div className="ts-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className="ts-modal ts-modal--wide">
      <div className="ts-modal-head">
        <div className="flex items-center gap-3">
          <span className="ts-modal-icon">⚡</span>
          <div>
            <h2 className="ts-h2">Quick Trade Capture</h2>
            <p className="ts-sub">Log your trade in seconds. Stay consistent.</p>
          </div>
        </div>
        <button type="button" className="ts-modal-close" onClick={onClose}>✕</button>
      </div>

      <div className="ts-subtabs mt-4" style={{ maxWidth: 320 }}>
        <button type="button" data-active={tab === 'manual'} onClick={() => setTab('manual')}>Manual entry</button>
        <button type="button" data-active={tab === 'import'} onClick={() => setTab('import')}>
          Import from MT5{!config.canMt5Import && ' 🔒'}
        </button>
      </div>

      {tab === 'import' ? (
        <div className="mt-4">
          <Mt5ImportTab canImport={config.canMt5Import} onDone={onSaved} />
        </div>
      ) : (
        <form action={onSubmit}>
          {/* everything from the current form body: hidden inputs through ts-modal-foot,
              UNCHANGED — only the outer <form className="ts-modal ts-modal--wide">
              wrapper moved up and lost its classes */}
        </form>
      )}
    </div>
  </div>
)
```

Concretely: change `<form action={onSubmit} className="ts-modal ts-modal--wide">` to plain `<form action={onSubmit}>`, move `ts-modal ts-modal--wide` to a new wrapping `<div>`, move the `ts-modal-head` block out of the form into that div, and close tags accordingly. No other line of the form changes.

- [ ] **Step 3: Append styles to `app/src/app/globals.css`**

```css
/* MT5 import tab */
.ts-mt5-locked { text-align: center; padding: 32px 16px; }
.ts-mt5-tablewrap { max-height: 320px; overflow-y: auto; border: 1px solid var(--line, #e5e7eb); border-radius: 10px; }
.ts-mt5-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ts-mt5-table th { position: sticky; top: 0; background: var(--surface, #fff); text-align: left; padding: 8px 10px; font-weight: 600; }
.ts-mt5-table td { padding: 6px 10px; border-top: 1px solid var(--line, #e5e7eb); }
.ts-mt5-table tr[data-dupe] td { opacity: 0.45; }
```

If `globals.css` defines its own color variables (check the top of the file), use those instead of the `--line`/`--surface` fallbacks.

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean, all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/Mt5ImportTab.tsx src/app/_components/TradeModalProvider.tsx src/app/globals.css
git commit -m "feat(mt5): import tab in trade modal with review-before-save flow"
```

---

### Task 9: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite + typecheck + build**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: all PASS, build succeeds.

- [ ] **Step 2: Preview verification**

Start the dev server (preview tools / launch.json). Then verify in browser. NOTE (project quirk): hidden preview tab freezes React 19 hydration — keep the preview tab visible; server actions can be tested via Next-Action fetch if the UI stalls.

1. Log in as an admin/test account (admins get `pro` tier → import unlocked).
2. Open the add-journal popup → "Import from MT5" tab visible.
3. Upload `app/tests/fixtures/mt5/report.html` → review table shows 3 rows.
4. Confirm → journal shows 3 imported trades with correct P&L; popup closed.
5. Re-upload same file → all rows marked "already imported", import button disabled at 0 selected.
6. Verify a free-tier user (e.g. seeded demo account, no subscription) sees the locked panel with the billing link, and a direct server-action call returns the gate error.

- [ ] **Step 3: Final commit of any fixups, then report**

```bash
git status
```

Expected: clean tree. Report results with screenshots/log output.

---

## Self-Review (done at write time)

- **Spec coverage:** gating (T1/T6/T7/T8), migration (T2), parser HTML/CSV/XLSX (T3/T4), mapping rules incl. net P&L, breakeven, missing SL, market inference (T5), two actions with no-write parse and idempotent commit (T6), popup tabs + review table + locked state (T8), errors/edge cases (parser tolerance T3, size cap T6, dupe re-upload T6/T9), tests (T1/T3/T4/T5), out-of-scope respected.
- **Deviations from spec, both intentional:** (1) full unique index instead of partial — required for `onConflict` upsert, NULLs stay unconstrained; (2) no supabase-mocked action-level test — repo has no mocking infra, gate logic is one tested `canFlag` call, and T9 step 6 covers the free-tier rejection manually.
- **Type consistency:** `Mt5Deal`/`ParsedRow`/`parseMt5Statement`/`commitMt5Import` names match across T3–T8.
