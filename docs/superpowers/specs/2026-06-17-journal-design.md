# TradingSocial App — Phase 2: Trade Journal

**Date:** 2026-06-17
**Status:** Approved (design)
**Depends on:** Phase 0+1 (auth, profiles, Supabase Storage). Builds the trade journal: capture, lifecycle, metrics, public display.

---

## 1. Goals

Let a trader log trades fast ("capture while fresh"), review them, and see honest, risk-adjusted metrics. Trades drive the public profile's stats and (later) leaderboards/XP.

**Confirmed decisions:**
- **Computed from prices** — user enters prices; we derive R:R, pips, P/L, outcome.
- **Lifecycle:** open → closed. Capture at entry (planned R:R); add exit later → realized. Exit may also be entered at capture (one-shot closed log) and the trade **date is editable** (backfill past trades).
- **Per-trade visibility** (`is_public`, defaults to the profile setting).
- **Tags:** predefined mistake tags + preset/custom strategy ("setup") tags.
- **P/L money via account balance:** `pnl_amount = r_multiple × risk_amount`; `risk_amount` from Risk% or Lot Size.
- **Lot Size + pips included** using a static USD instrument catalog (no live FX).
- **Deferred:** AI Insight, Save-as-template, live FX cross-rates, broker import, open-position price feeds.

---

## 2. Trade lifecycle & capture

### Capture modal ("Quick Trade Capture")
A client modal opened from `/app/journal`. Fields:
- **Market** (forex/crypto/stocks/indices/commodities), **Instrument** (catalog combobox + free-text custom), **Direction** (Buy=long / Sell=short).
- **Sizing toggle:** Risk % *or* Lot Size.
- **Entry**, **Stop Loss**, **Take Profit**, optional **Exit Price**.
- **Trade date** (defaults now; editable for backfill).
- **Setup type** (preset chips: Breakout, Retest, Trend Continuation, News Play, + custom), **Confidence** (low/medium/high), **Emotion** (calm/focused/excited/anxious), **Note**, **Chart** (image upload), **Visibility** (public/private, default from profile).
- Live computed panel: **R:R**, **pips** (SL/TP), **Est. P/L**.

On save:
- **Exit empty →** `status = open` (planned values stored, realized null).
- **Exit present →** `status = closed` (realized values computed immediately).

### Close modal
For an open trade: enter **exit price** (and optional close date) → `computeClose` fills realized R, pips, P/L, outcome; `status = closed`.

---

## 3. Sizing, pips & money

### Instrument catalog (`lib/instruments.ts`)
Static array of ~15–20 common instruments: `{ symbol, name, market, pip_size, pip_value_per_lot_usd }` (majors, gold, BTC, major indices). Account currency assumed **USD** for pip-value math in MVP.

**Custom instrument** (not in catalog): allowed. `pip_size` inferred — forex JPY-quote `0.01`, other forex `0.0001`, non-forex `1` (label "points"). Lot-mode $ needs a catalog `pip_value_per_lot_usd`; if absent, the modal disables Lot mode for that instrument and uses Risk %.

### Sizing
- **Risk %:** `risk_amount = account_balance × risk_percent / 100`. Instrument-agnostic.
- **Lot Size:** `risk_amount = sl_pips × pip_value_per_lot_usd × lots`.

`account_balance` + `account_currency` live on the profile (set in Settings). If balance is 0/unset and Risk% mode is used, `risk_amount = 0` → money metrics show "—" but R metrics still work.

---

## 4. Pure computation (`lib/trade.ts`, unit-tested)

```
sign(direction): long → +1, short → −1
pip_size(instrument): catalog value, else inferred
sl_pips   = |entry − stop| / pip_size
tp_pips   = |target − entry| / pip_size          (when target set)
planned_rr = |target − entry| / |entry − stop|    (when target set; stop ≠ entry)
```

`computeOpen(input)` → `{ sl_pips, tp_pips, planned_rr, risk_amount, est_pnl }`
- `est_pnl = risk_amount × planned_rr` (planned reward at TP).
- Validation: `stop ≠ entry` (else error "Stop cannot equal entry").

`computeClose(open, exit, closeDate)` →
- `realized_pips = (exit − entry) × sign / pip_size`
- `r_multiple = realized_pips / sl_pips`
- `pnl_amount = r_multiple × risk_amount`
- `outcome = r_multiple > ε ? win : r_multiple < −ε ? loss : breakeven`

`computeMetrics(trades[])` over **closed** trades →
`{ total, wins, losses, win_rate, avg_rr (mean r_multiple), profit_factor (Σ r>0 / |Σ r<0|), best (max r), worst (min r), current_streak (sign run from latest by date), net_pnl (Σ pnl_amount), mistake_counts (map) }`. Open trades counted separately for the Open filter only.

---

## 5. Data model — `0002_trades.sql`

### profiles (alter)
Add `account_balance numeric not null default 0`, `account_currency text not null default 'USD'`.

### trades
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | FK→profiles, cascade |
| `market` | text | from market list |
| `instrument` | text | symbol (catalog or custom) |
| `direction` | enum `trade_direction` | long \| short |
| `entry_price` | numeric | required |
| `stop_price` | numeric | required (≠ entry) |
| `target_price` | numeric | nullable |
| `exit_price` | numeric | null = open |
| `sizing_mode` | enum `sizing_mode` | risk_percent \| lots |
| `risk_percent` | numeric | nullable |
| `lots` | numeric | nullable |
| `risk_amount` | numeric | computed, stored |
| `sl_pips` | numeric | computed |
| `tp_pips` | numeric | computed, nullable |
| `planned_rr` | numeric | computed, nullable |
| `r_multiple` | numeric | computed on close, nullable |
| `pnl_amount` | numeric | computed on close, nullable |
| `realized_pips` | numeric | nullable |
| `outcome` | enum `trade_outcome` | open \| win \| loss \| breakeven |
| `status` | enum `trade_status` | open \| closed |
| `setup_type` | text | nullable |
| `confidence` | enum `trade_confidence` | low \| medium \| high, nullable |
| `emotion` | enum `trade_emotion` | calm \| focused \| excited \| anxious, nullable |
| `note` | text | nullable |
| `screenshot_url` | text | nullable |
| `is_public` | boolean | default true |
| `mistake_tags` | text[] | default '{}' |
| `strategy_tags` | text[] | default '{}' |
| `traded_at` | timestamptz | trade date (editable) |
| `closed_at` | timestamptz | nullable |
| `created_at` / `updated_at` | timestamptz | trigger-maintained |

Indexes: `(user_id, traded_at desc)`, `(is_public)`.

### RLS
- SELECT: `is_public = true OR auth.uid() = user_id`.
- INSERT/UPDATE/DELETE: `auth.uid() = user_id`.
(Profile-level privacy already enforced at the profile page; no cross-leak.)

---

## 6. Routes, components, files

```
app/src/lib/instruments.ts              # static catalog + pip inference (unit-tested)
app/src/lib/trade.ts                    # types, enums, MISTAKE_TAGS, SETUP_PRESETS,
                                         # computeOpen/computeClose/computeMetrics (unit-tested)
app/supabase/migrations/0002_trades.sql # profiles alter + trades + enums + RLS
app/src/app/actions/trade.ts            # createTrade, closeTrade, updateTrade, deleteTrade
app/src/app/actions/account.ts          # saveAccount (balance, currency) — or extend settings
app/src/lib/storage.ts                  # generalize: add signTradeChartUpload(userId, tradeId, ct)
app/src/app/journal/page.tsx            # stats + recent trades + filters + Log-trade button
app/src/app/journal/_components/
    TradeCaptureModal.tsx               # the capture form (live compute)
    CloseTradeModal.tsx                 # exit entry for open trades
    StatsBar.tsx                        # aggregate metric cards
    TradeRow.tsx                        # one row (Entry/Exit/P/L/R:R/Tags/status)
    TradeFilters.tsx                    # All / Open / Closed
app/src/app/settings/page.tsx           # += account balance/currency section
app/src/app/[username]/page.tsx         # replace placeholder with real stats + public trades
```

**Visual:** match `app/TradingSocial Journal (offline) (1).html` (stats row, Recent Trades table) and the capture modal screenshot, using the Phase-1 brand system (tokens/components in `globals.css`). Extend `globals.css` with journal-specific component classes (modal, stat card, trade row, sizing toggle).

---

## 7. Error handling

- Validation (client + server): required entry/stop/exit numeric; `stop ≠ entry`; direction/market/instrument set; risk% or lots present per mode.
- Lot mode with a custom (uncatalogued) instrument → disabled with a hint to use Risk %.
- RLS denial / not-owner edit → 404 / no-op.
- Chart upload failure → retryable; chart is optional, save proceeds.

---

## 8. Testing

- **Vitest:** `computeOpen` (pips, planned R:R, both sizing modes, stop==entry error), `computeClose` (long & short, win/loss/breakeven, realized R & P/L), `computeMetrics` (win rate, profit factor, best/worst, streak, net P/L), `instruments` (catalog lookup + pip inference incl. JPY).
- **Playwright:** open capture modal → save an **open** trade → it shows under Open → close it → moves to Closed, stats update → public closed trade appears on the public profile; a **private** trade is hidden from a logged-out viewer.

---

## 9. Out of scope (later phases)

AI Insight / pattern match, Save-as-template, live FX cross-rate pip values, multi-currency accounts, broker/CSV import, verified P/L, open-position live pricing, XP/leaderboard wiring (Phase 4/5 read journal data later).

---

## 10. Deliverables checklist

- [ ] `instruments.ts` catalog + pip inference (+ tests).
- [ ] `trade.ts` compute + metrics (+ tests).
- [ ] `0002_trades.sql` (profiles alter, trades, enums, RLS, indexes).
- [ ] Trade server actions (create/close/update/delete) + account save.
- [ ] Storage `signTradeChartUpload`.
- [ ] Journal page: StatsBar, TradeRow, TradeFilters, Capture + Close modals.
- [ ] Settings account balance/currency.
- [ ] Public profile real stats + public trades.
- [ ] Vitest + Playwright suites.
