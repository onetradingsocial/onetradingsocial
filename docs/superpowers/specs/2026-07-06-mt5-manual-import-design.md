# MT5 Manual Import — Design (Phase 1)

Date: 2026-07-06
Status: Approved for implementation
Scope: Manual MT5 statement import for Trader tier. Auto-sync (MetaApi, Pro tier) is Phase 2 — feature flag wired now, built later.

## Goal

Trader-tier users import closed trades from an MT5 history report (HTML / XLSX / CSV) instead of hand-entering them. Import lives in the existing add-journal popup. Pro-tier auto-sync comes later and builds on the same field mapping and dedupe key.

## Feature gating

Add to `FEATURE_MIN_TIER` in `app/src/lib/entitlements.ts`:

- `mt5_import: 'trader'` — enforced in v1.
- `mt5_autosync: 'pro'` — wired, enforced when Phase 2 ships.

UI checks `canFlag(flags, tier, 'mt5_import')`; both server actions re-check server-side (fail closed). Below-tier users see the Import tab with the existing locked pattern (`🔒 Trader` link to `/settings/billing`, as in `StatCards.tsx`).

## UI flow

`TradeModal` (in `app/src/app/_components/TradeModalProvider.tsx`) gets two tabs:

1. **Manual** — current form, unchanged.
2. **Import from MT5** — new. Locked state when below Trader.

Import tab states:

- **Upload**: dropzone + file picker accepting `.html`, `.htm`, `.xlsx`, `.csv`. Short helper text: "In MT5: right-click Account History → Report → HTML or Open XML."
- **Review**: after parse, popup widens; table of candidate trades — checkbox (default on), symbol, direction, lots, open time, close time, net P&L. Rows already imported are pre-marked "duplicate" and unchecked/disabled. Footer: `n selected · m duplicates skipped`, Confirm / Back buttons.
- **Done**: inserted count, popup closes on confirm, `router.refresh()`.

## Server actions

Two-step, both in a new `app/src/app/actions/mt5-import.ts`:

### `parseMt5Report(formData)`

- Auth via `getUser` (mutation-adjacent path), tier check via `canFlag`.
- Reads file (size cap ~5 MB), detects format, parses deals/positions section:
  - HTML: MT5 report table parse (server-side DOM/regex parse).
  - XLSX: `xlsx` package.
  - CSV: tolerant delimiter/locale handling.
- Normalizes to candidate rows; skips open positions and non-trade rows (balance ops, deposits) and reports skipped count.
- Fetches user's existing `broker_deal_id`s and flags duplicates.
- **No DB write.** Returns `{ rows, skipped, duplicates }` or `{ error }`.

### `commitMt5Import(rows)`

- Auth + tier re-check.
- Server-side re-validation of every row (numbers finite, times valid, direction enum, ticket present).
- Upsert into `trades` keyed on `(user_id, broker_deal_id)` — re-import is a no-op.
- Returns inserted count.

## Schema migration (`0015_mt5_import.sql`)

- `alter table trades add column broker_deal_id text;`
- Unique partial index: `create unique index trades_user_broker_deal_idx on trades (user_id, broker_deal_id) where broker_deal_id is not null;`
- `alter table trades alter column stop_price drop not null;` — MT5 trades often carry no SL. Where stop is null: `sl_pips` stays 0, `r_multiple`/`planned_rr` null, UI renders "—".
- No new tables. `broker_accounts` is Phase 2.

## Field mapping (MT5 deal → trades)

| trades column | MT5 source | Rule |
|---|---|---|
| broker_deal_id | position/deal ticket | dedupe key |
| instrument | Symbol | as-is (e.g. EURUSD) |
| market | derived from symbol | forex-pair pattern match, else fallback default |
| direction | type buy/sell | buy→long, sell→short |
| entry_price / exit_price | open / close price | direct |
| lots | volume | `sizing_mode='lots'` |
| pnl_amount | profit + commission + swap | net convention |
| traded_at / closed_at | open / close time | report local time → timestamptz (documented caveat: MT5 reports use server time) |
| status / outcome | — | `closed`; win/loss/breakeven from P&L sign |
| stop_price / target_price | S/L, T/P if present | null when absent |
| setup_type, confidence, emotion, tags, note | — | empty; user enriches via existing edit flow |
| is_public | — | user's `defaultPublic` setting |

## Errors & edge cases

- Unparseable file → error naming the expected export path in MT5.
- Broker variance (column order, symbol suffixes like `EURUSD.a`) → parser matches by header names, tolerates unknown columns, skips unrecognized rows and reports the count.
- Re-upload of same file → all rows flagged duplicate, zero inserts.
- Partial closes appear as separate deals with distinct tickets → imported as separate trades (documented behavior for v1).
- Free-tier 30-trade journal cap: not an issue — import requires Trader, which has `journal_unlimited`.

## Testing

- Vitest parser units with fixture files: MT5 HTML report, XLSX, CSV; at least two broker variants; junk file.
- Mapping unit tests (direction, net P&L, breakeven boundary, missing SL).
- Dedupe test (same ticket twice).
- Action-level test: free-tier user rejected by both actions.

## Out of scope (Phase 2+)

- MetaApi auto-sync, `broker_accounts` table, investor-password encryption, sync worker, open-positions view, MT4.
