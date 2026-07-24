# Crypto Trade Sync — Phase 0 Groundwork (Design)

**Date:** 2026-07-24
**Status:** Approved design, ready for implementation plan
**Context:** `Crypto-Trade-Sync-Feasibility.docx` (23 Jul 2026) recommends CCXT + read-only exchange
API keys as the crypto equivalent of the MT5 import. Review of that document against the codebase
found its "maps 1:1 onto the existing journal schema" claim to be wrong, and two blockers it did not
account for. Phase 0 closes those gaps so Phase 1 (the actual Binance sync) is small.

## Goal

Build the plumbing a read-only exchange key sync needs, without adding CCXT, UI, or any network
call. Everything here is testable with no exchange account.

**In scope:** encrypted secret storage, the connection table, fills→trades rollup, symbol
normalization, feature-flag entries, catalog entries.

**Out of scope (Phase 1):** the `ccxt` dependency, `fetchMyTrades`, the "paste your key" form, the
`Sync now` server action, the daily cron.

## Why these four things

Findings from the code review that motivated the phase:

1. The feasibility doc's data-mapping table cites journal fields `size`, `notional` and `fees`.
   None exist. `trades` ([0002](../../../app/supabase/migrations/0002_trades.sql)) has `lots`,
   `sizing_mode`, `sl_pips NOT NULL`, `risk_amount NOT NULL`.
2. `broker_accounts` ([0019](../../../app/supabase/migrations/0019_broker_accounts.sql)) is unique
   on `user_id` alone — a crypto connection would collide with the user's MT5 one.
3. The repo has **no encryption infrastructure at all**. 0019's header comment reads "No credential
   storage: MetaApi holds broker creds." Approach B makes TradingSocial a first-time custodian of a
   user secret.
4. `instruments.ts` carries only `BTC/USD` and `ETH/USD`; exchanges return `BTCUSDT`.

Two further gaps are recorded for Phase 1, not solved here: Binance returns HTTP 451 from
restricted-region IPs (function region must be pinned), and `app/vercel.json` already holds 2 cron
jobs, the Hobby-plan cap, so autosync needs a Pro upgrade or must piggyback an existing route.

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| Phase boundary | Groundwork only | Key custody and the rollup are the two places to get it wrong; both are testable with zero exchange access. |
| Secret at rest | App-layer AES-256-GCM, master key in env | A DB dump alone is useless. No vendor, no plan upgrade. Rejected Supabase Vault: plaintext reachable to any service-role holder, key sits in the same system as the data. |
| Fills → journal rows | Roll up closed cycles only | Raw fills would make win rate, R-multiple and streaks meaningless. Open positions are skipped and picked up by a later sync, so no mutating row and no synthetic dedupe key. |
| Connection storage | New `exchange_accounts` table | Leaves the live MT5 autosync path untouched; lets a user hold MT5 + several exchanges at once; avoids MT5-only columns sitting null. |
| Fees | Netted into `pnl_amount` | Matches the MT5 precedent — [mt5.ts:178](../../../app/src/lib/mt5.ts) already stores `profit + commission + swap` as one figure. Keeps every existing stat consistent across asset classes. No schema change. |
| Symbol mapping | Stable quotes normalize to USD | `BTC/USDT`, `BTC/USDC`, `BTC/BUSD`, `BTC/FDUSD` → `BTC/USD`. One instrument per asset, so journal grouping, leaderboards and breakdowns don't fragment per stablecoin. |
| `trades.source` | Reuse `'broker'` | API-sourced fills carry the same trust level as MetaApi sync. Adding an `'exchange'` enum value would mean touching `verification.ts` and the badge/leaderboard filters for no behavioural gain. |

## Architecture

Four new units. Three are pure (plain data in, plain data out — no DB, no network); one is
server-only and knows nothing about crypto.

| Unit | Kind | Purpose | Depends on |
|---|---|---|---|
| `lib/crypto/symbols.ts` | pure | `normalizeExchangeSymbol(raw)` → catalog instrument | — |
| `lib/crypto/fills.ts` | pure | `rollupFills(fills)` → closed round-trip cycles | — |
| `lib/crypto/map.ts` | pure | `mapCycleToTrade(cycle, opts)` → trade row | symbols, instruments |
| `lib/server/secrets.ts` | server-only | AES-256-GCM envelope for any string | node:crypto |

### `lib/crypto/symbols.ts`

`normalizeExchangeSymbol(raw: string): { instrument: string; market: 'crypto' }`

Stable quote set: `USDT`, `USDC`, `BUSD`, `FDUSD`, `TUSD`, `DAI`. A stable quote is rewritten to
`USD`; anything else is kept verbatim (`ETH/BTC` stays `ETH/BTC` and falls through to the existing
custom-instrument inference). Accepts both the CCXT unified form (`BTC/USDT`) and the raw
slashless exchange form (`BTCUSDT`). Input is upper-cased before matching.

### `lib/crypto/fills.ts`

Input:

```ts
type Fill = {
  id: string
  symbol: string        // 'BTC/USDT'
  timestamp: number     // ms
  side: 'buy' | 'sell'
  price: number
  amount: number        // base qty
  fee?: { cost: number; currency: string }
}
```

Per symbol, fills sorted by `timestamp` then `id`:

- Track signed `net` (buy `+amount`, sell `−amount`). A cycle opens when `net` leaves flat; its
  `direction` is the sign of that first fill — `long` on buy-first, `short` on sell-first.
- Fills that grow `|net|` feed the entry weighted average; fills that shrink it feed the exit
  weighted average.
- `|net| <= 1e-8` counts as flat. Exchanges return dust remainders, and exact-zero float comparison
  would leak cycles.
- **Flip through zero** (sell 3 while long 2): the fill is split at the crossing. 2 closes the long
  cycle; 1 opens a new short cycle at the same price and timestamp. The fill's fee is apportioned
  pro-rata by the split ratio.
- On reaching flat, emit the cycle: `size` = total base qty closed,
  `pnl = (exitAvg − entryAvg) × dirSign × size − fees`, `openedAt` = first fill timestamp,
  `closedAt` = flattening fill timestamp, `dedupeId` = **the flattening fill's exchange id**. That
  id is immutable once the cycle closes, so re-syncs upsert onto the same row.
- Fills still open at the end of the batch are not emitted; they are counted in `skippedOpen` and
  closed by a later sync.

Return shape mirrors `parseMt5` — a result object, not an exception:

```ts
{ cycles: Cycle[], skippedOpen: number, warnings: string[] }
```

Warnings (never throws): fee in a non-quote currency (excluded from P&L rather than converted at a
rate we don't have), unparseable symbol, sell-first cycle on a spot-only venue.

### `lib/crypto/map.ts`

`mapCycleToTrade(cycle, opts)` mirrors
[`mapDealToTrade`](../../../app/src/lib/mt5.ts) field for field:

| Column | Value |
|---|---|
| `broker_deal_id` | `cycle.dedupeId` |
| `source` | `'broker'` |
| `market` | `'crypto'` |
| `instrument` | normalized symbol |
| `direction` | `long` / `short` |
| `sizing_mode` | `'lots'` |
| `lots` | `cycle.size` (base qty) |
| `entry_price` / `exit_price` | weighted averages |
| `stop_price` / `target_price` | `null` |
| `sl_pips` / `risk_amount` | `0` |
| `planned_rr` / `r_multiple` / `tp_pips` | `null` |
| `pnl_amount` | net of fees |
| `realized_pips` | via existing `pipInfo` |
| `outcome` | win / loss / breakeven from `pnl_amount` |
| `status` | `'closed'` |
| `traded_at` / `closed_at` | cycle open / close timestamps |

Imported crypto trades carry no stop, so `r_multiple` stays null and R-based stats simply exclude
them — the same behaviour MT5 statement imports already have.

Total function: no throw path. A missing catalog entry falls through to existing inference.

### `lib/server/secrets.ts`

```ts
encryptSecret(plain: string): Promise<string>
decryptSecret(enc: string): Promise<string>
```

AES-256-GCM via `node:crypto` webcrypto. Master key from `EXCHANGE_KEY_SECRET` (base64, 32 bytes).
Random 12-byte IV per encryption. Stored format `v1.<base64 iv>.<base64 ciphertext+tag>` — the
version prefix leaves room to rotate the scheme later.

Throws on: missing env, malformed ciphertext, GCM auth-tag failure. There is no plaintext fallback
path — it fails closed. Neither plaintext nor ciphertext ever appears in an error message, a log
line, or a URL.

## Schema

`0037_exchange_accounts.sql`. **No `trades` migration is required** — netting fees into
`pnl_amount`, `stop_price` already nullable (0018), and `market` being free text mean crypto rows
fit the existing table unchanged.

```sql
create table if not exists public.exchange_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exchange text not null,              -- ccxt id: binance | coinbase | kraken | bybit
  label text,
  api_key_enc text not null,           -- v1.<iv>.<ciphertext+tag>
  api_secret_enc text not null,
  passphrase_enc text,                 -- coinbase / okx / kucoin need a third factor
  status text not null default 'pending',  -- pending | active | error | disconnected
  last_sync_at timestamptz,
  last_fill_at timestamptz,            -- sync cursor
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists exchange_accounts_user_exchange_idx
  on public.exchange_accounts (user_id, exchange);
```

RLS mirrors `broker_accounts`: owner `select` / `insert` / `delete`, **no update policy** (sync
writes use the service role). `touch_updated_at` trigger as elsewhere. Plus one control MT5 did not
need — hide the ciphertext columns from client roles:

```sql
revoke select on public.exchange_accounts from authenticated, anon;
grant select (
  id, user_id, exchange, label, status,
  last_sync_at, last_fill_at, sync_error, created_at, updated_at
) on public.exchange_accounts to authenticated, anon;
```

Note the shape: a *column-level* `revoke` does **not** subtract from Supabase's default table-level
SELECT grant (access passes if either level allows it), so it would be a no-op. Instead we revoke
the whole-table grant and re-grant SELECT on only the ten non-secret columns. The three `*_enc`
columns are never granted to a client role, so only the service role (which bypasses grants) reads
the ciphertext; RLS still restricts which rows an owner sees. Phase 1 client reads must name columns
explicitly — a bare `select('*')` as `authenticated` will error on the ungranted columns.

### Supporting changes

- **`lib/entitlements.ts`** — add `crypto_import: 'trader'` and `crypto_autosync: 'pro'` to the
  `Feature` union and `FEATURE_MIN_TIER`, in the "wired, enforced when built" set. Mirrors
  `mt5_import` / `mt5_autosync`.
- **`lib/instruments.ts`** — add `SOL/USD`, `XRP/USD`, `BNB/USD`, `DOGE/USD`, `ADA/USD` alongside
  the existing BTC/ETH entries, `pipValuePerLot: 1` per the crypto convention already there.

### New environment variable

`EXCHANGE_KEY_SECRET` — base64-encoded 32 bytes. Required in Vercel and `.env.local`. Absent means
`secrets.ts` throws; nothing degrades to plaintext.

## Testing

Unit only. Phase 0 has no UI and no network, so there is nothing for e2e to drive.

| Module | Cases |
|---|---|
| `symbols` | stable-quote → USD (all six); slashless `BTCUSDT`; `ETH/BTC` verbatim; lowercase input; unknown quote |
| `fills` | single-fill cycle; multi-fill weighted average; short cycle; flip through zero including fee apportioning; 1e-8 dust treated as flat; open remainder skipped; fee netting; dedupe id equals flattening fill; two symbols interleaved |
| `map` | field-shape parity with `mapDealToTrade`; outcome win/loss/breakeven; `source: 'broker'`; null stop → `sl_pips` 0 and `r_multiple` null |
| `secrets` | roundtrip; distinct IV per call; tampered ciphertext rejected; missing env throws; wrong key rejected |

Roughly 25 new tests on top of the existing unit suite, which must stay green.

**Phase verification:** `npm test` green, `tsc` clean, migration applied to the **dev** Supabase
project (not prod), Supabase advisors clean.

## Security notes

- Read-only keys only. Phase 1's UI must instruct users to enable read/query permission and nothing
  else; a read key cannot move funds. Where an exchange exposes key scope, Phase 1 rejects keys
  carrying trade or withdrawal permission.
- The master key never enters Postgres, and the ciphertext never enters the browser.
- IP allowlisting is not available to us on serverless egress; noted as a Phase 1 limitation, not a
  Phase 0 task.

## What Phase 1 inherits

With this landed, Phase 1 is: add `ccxt` (per-exchange subpath import, not the 100-exchange
barrel), a connect form that encrypts through `secrets.ts`, a `Sync now` server action calling
`fetchMyTrades` → `rollupFills` → `mapCycleToTrade` → the existing idempotent upsert on
`(user_id, broker_deal_id)`, gated on `crypto_import`.
