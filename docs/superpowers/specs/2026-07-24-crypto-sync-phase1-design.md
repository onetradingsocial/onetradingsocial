# Crypto Trade Sync — Phase 1: Live Binance Sync (Design)

**Date:** 2026-07-24
**Status:** Approved design, ready for implementation plan
**Builds on:** Phase 0 groundwork (`docs/superpowers/specs/2026-07-24-crypto-sync-phase0-design.md`), shipped 2026-07-24.

## Goal

Let a Trader/Pro user connect their Binance account with a read-only API key and get their trades
into the journal — on demand ("Sync now") and daily (autosync). This is the first live, user-facing
crypto integration; Phase 0 built the plumbing (encryption, symbol normalization, fills rollup, trade
mapping, the `exchange_accounts` table) with no network, no UI. Phase 1 wires it to Binance.

**In scope:** Binance (spot) only; connect/disconnect with hard read-only enforcement; a user-picked
pair list; manual "Sync now" that imports directly; a daily autosync via GitHub Actions; the
dedupe-namespace fix booked in the Phase 0 review; gated marketing + admin rollout.

**Out of scope:** other exchanges (Kraken/Coinbase/Bybit — fast-follow, mostly CCXT config); futures
/ margin (spot only); an aggregator OAuth flow; a preview-before-import UI.

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| Scope | Manual sync **and** daily autosync | User wants both; the engine is shared so autosync is a thin cron over the same function. |
| Exchange | Binance only | The exchange the user named, and the one with the hardest quirks (per-pair queries, geo-block). Prove the chain on one venue; CCXT makes later venues cheap. |
| Pair discovery | User picks a pair list | Binance has no "all my spot fills" endpoint — you must query per pair. A user-picked list is deterministic and matches how a trader thinks; balance-derivation silently misses fully-closed positions. |
| Key scope | Hard-reject dangerous scopes on connect | Call Binance `apiRestrictions`; reject keys with withdrawal (or trading) enabled. We refuse to custody a key that can move funds. |
| Sync UX | Import directly, show result | Same code path as the cron (one path to test); the key is the user's own read-only key and re-syncs never double-count, so a preview adds friction for no safety gain. |
| Autosync trigger | GitHub Actions, own workflow | MT5 sync already runs this way (`mt5-sync.yml`) because Vercel Hobby crons are daily-only and the 2 Vercel slots are used. A new `crypto-sync.yml` curls a Vercel route with `CRON_SECRET`. No Vercel slot, no Pro upgrade. |
| Dedupe key | Prefix `broker_deal_id` with `binance:` | Phase 0 review finding: a raw exchange fill id could collide with an MT5 ticket (both `source:'broker'`) and clobber on upsert. Prefixing namespaces them. |

## Architecture

New units. Phase 0's pure modules (`symbols.ts`, `fills.ts`, `map.ts`) and `secrets.ts` are consumed
unchanged, except one deliberate additive change to `map.ts` (the dedupe prefix).

| Unit | Kind | Responsibility |
|---|---|---|
| `app/src/lib/server/binance.ts` | server-only | The ONLY file that imports CCXT. `verifyReadOnly(creds)`, `fetchFillsSince(creds, symbol, since)`. Wraps one Binance client. |
| `app/src/lib/server/crypto-sync.ts` | server-only | Shared sync engine. `syncExchangeAccount(svc, row)`: decrypt → fetch per pair → rollup → map → upsert → advance cursor → notify. Knows nothing about HTTP or React. |
| `app/src/app/actions/exchange.ts` | server action | `connectExchange`, `disconnectExchange`, `syncNow`. Mirrors `actions/broker.ts`. |
| `app/src/app/api/cron/crypto-sync/route.ts` | route | `authorizedCron` → iterate `active`/`error` rows → `syncExchangeAccount` each. Mirrors `api/mt5-sync/collect/route.ts` minus the deploy/undeploy dance. Region-pinned (see Operational). |
| `app/src/app/settings/ExchangeCard.tsx` | client | Connect form + pair multi-select + Sync-now + status + disconnect. Mirrors `settings/BrokerCard.tsx`. |
| `.github/workflows/crypto-sync.yml` | CI | Daily curl of the route with `CRON_SECRET`. Mirrors `.github/workflows/mt5-sync.yml`. |

### The one change to Phase 0 code

`mapCycleToTrade(cycle, opts)` gains `opts.exchange: string`, used to set
`broker_deal_id = `${opts.exchange}:${cycle.dedupeId}``. Its 5 existing tests update to expect the
prefixed id. Nothing else in `map.ts` changes. (Phase 0 callers do not exist yet — this is the first
consumer — so no other call site is affected.)

## Data flow (identical for Sync-now and cron)

```
exchange_accounts row (api_key_enc, api_secret_enc, symbols[], last_fill_at cursor)
  → decryptSecret (service client — only role that can read the *_enc columns)
  → for each pair in symbols[]:
       binance.fetchFillsSince(creds, pair, since=last_fill_at)   [paged, enableRateLimit]
  → rollupFills(allFills)                                         [Phase 0]
  → mapCycleToTrade(cycle, {userId, isPublic, exchange:'binance'})[Phase 0 + prefix]
  → upsert trades onConflict (user_id, broker_deal_id) ignoreDuplicates  [idempotent]
  → advance last_fill_at to max fill ts; status='active'; sync_error=null
  → insertSystemNotification('import_done') when rows landed
```

## Connect flow (`connectExchange`)

Mirrors `connectBroker` (`actions/broker.ts`).

1. Auth; gate on `crypto_import` (trader tier). Not gated → "Crypto sync is available on the Trader
   plan and above."
2. Read form: `apiKey`, `apiSecret`, and the selected pair list.
3. **Verify + scope-check before storing anything** — `binance.verifyReadOnly({apiKey, apiSecret})`:
   - Calls Binance `sapi/v1/account/apiRestrictions` through the CCXT client.
   - **Reject** if `enableWithdrawals` is true, or if spot/margin/futures trading is enabled →
     "This key can trade or withdraw. Create a new key with only 'Enable Reading' checked."
   - The call succeeding is also the read test. Failure → "Couldn't reach Binance with that key —
     check it's correct and read-only." (Runs in the region-pinned path; see Operational.)
   - `verifyReadOnly` returns a verdict only — it never echoes the key into a message or log.
4. Only on a clean read-only verdict: `encryptSecret` the key and secret; insert the
   `exchange_accounts` row (`exchange:'binance'`, `status:'active'`, `symbols`, `api_key_enc`,
   `api_secret_enc`). `passphrase_enc` stays null (Binance needs no third factor).
5. The unique `(user_id, exchange)` index rejects a second Binance row → UI: "Binance already
   connected. Disconnect it first."

**Pair list.** Stored in a new `symbols text[]` column (migration `0038`), in **exchange form**
(`BTC/USDT`) because that is what CCXT is handed; normalization to `BTC/USD` happens only at map time
(`symbols.ts`). The connect UI pre-checks the ~15 catalog majors and allows adding any splittable
`BASE/QUOTE` pair; each entered pair is validated (via `splitSymbol`) before save.

**Disconnect** = delete the row. Already-imported trades stay. No external teardown (unlike MT5's
MetaApi account).

## Schema

`0038_exchange_symbols.sql` — one additive column:

```sql
alter table public.exchange_accounts
  add column if not exists symbols text[] not null default '{}';
```

No other schema change. `last_fill_at` (the sync cursor) already exists from Phase 0's `0037`.

## Autosync

`.github/workflows/crypto-sync.yml`, daily (`0 6 * * *`), curls
`https://app.tradingsocial.io/api/cron/crypto-sync` with `Authorization: Bearer ${CRON_SECRET}` —
the exact shape of `mt5-sync.yml`. The route:
- `authorizedCron`-gates (fails closed without `CRON_SECRET`).
- Selects `exchange_accounts` rows in `status in ('active','error')`.
- Runs `syncExchangeAccount` per row; per-row tier-gate on `crypto_autosync` (pro) — a row whose
  owner is no longer Pro is set to `error` with a clear message and skipped, mirroring the MT5 collect
  route's gate.

## Operational risks (written into the plan)

- **Binance 451 / region.** Binance.com returns HTTP 451 from restricted-jurisdiction IPs (incl. US).
  Both the cron route and the connect action hit Binance, so both pin to a non-US Vercel region via
  `export const preferredRegion` on the route segment. Candidate `sin1` or `fra1`; the working region
  is **verified empirically during build** (Binance blocks by jurisdiction — this is a test-and-confirm
  item, not a value locked in the design). Binance.US is a separate API+key and is out of scope.
- **Rate limits / per-pair fan-out.** `enableRateLimit: true` on the client. A user with 15 pairs =
  15 sequential paged calls; acceptable for a daily/manual sync, and the `last_fill_at` cursor keeps
  every run after the first incremental.
- **First-sync backfill.** `last_fill_at` null → window the backfill from a floor (1 year) rather
  than pulling all history, per pair.
- **CCXT import size.** Import the single Binance class via CCXT's per-exchange entry point, not the
  100-exchange barrel, to keep the serverless bundle and cold start small. Exact import path is pinned
  against the installed CCXT version during the plan.

## Testing

Unit only (no live network):
- `binance.ts` — mock the CCXT client: `verifyReadOnly` rejects withdrawal-enabled and
  trading-enabled keys, accepts a read-only key, surfaces a read failure; `fetchFillsSince` shapes the
  since/symbol args and flattens pages.
- `crypto-sync.ts` — mock the service client + the binance module: cursor advances to max fill ts,
  `broker_deal_id` is `binance:`-prefixed, duplicate fills skip on upsert, a per-account error sets
  `status:'error'` + notifies without aborting the batch, `import_done` fires only when rows land.
- `map.ts` — its 5 tests update for the `exchange` prefix.

Verification for the phase: `npm test` green, `tsc` clean, `next build` passes. Then a **manual
end-to-end confirmation** with a real read-only Binance key syncing real fills into a journal, and the
region + scope-reject behaviour confirmed live.

## Rollout — final task, gated on "tested and confirmed"

Only after the end-to-end confirmation above:

1. **Admin** (`app/src/app/admin/features/page.tsx`): add `crypto_import`, `crypto_autosync` to the
   `WIRED` set and to the "Trading Journal" `GROUPS` row (beside `mt5_import`/`mt5_autosync`).
2. **Marketing** (`pricing.html`): add the crypto-sync feature rows to the Trading Journal section
   next to the MT5 rows — import at Trader, autosync at Pro.

These ship in a separate commit after live confirmation, never before — so nothing is advertised or
toggled on until it demonstrably works.

## Security notes

- Only read-only keys are accepted (hard-rejected otherwise); a read key cannot move funds.
- Key + secret are stored only as AES-256-GCM envelopes (`secrets.ts`); the master key is env-only;
  the ciphertext columns are service-role-only (Phase 0's column grant, REST-verified on dev).
- The service client (not the user session) performs sync reads, because only the service role can
  read the `*_enc` columns.
- No key material ever enters a log, an error message, or a URL.

## What a later phase inherits

Adding Kraken/Coinbase/Bybit: each is mostly a CCXT config entry + a `verifyReadOnly` variant (some
expose scope differently) + a passphrase field for the venues that need one (`passphrase_enc` already
exists). Kraken/Coinbase return account-wide fills, so they skip the pair-list requirement. Autosync
cadence and the aggregator-OAuth option remain future decisions.
