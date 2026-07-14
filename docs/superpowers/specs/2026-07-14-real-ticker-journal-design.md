# Real Ticker Search + Live Price in Trade Journal — Design

**Date:** 2026-07-14
**Status:** Approved approach A (Twelve Data single provider, free tier)

## Goal

Replace the static 16-symbol datalist in the trade-capture modal with real
instrument search across forex, metals, crypto, US stocks, and indices, and
show a live price for the selected symbol with one-tap autofill of the entry
price field.

## Scope

**In:**
- Symbol autocomplete backed by the Twelve Data `symbol_search` API, merged
  with the existing static catalog.
- Live quote display for the selected symbol with a "Use" button that fills
  the entry price input.
- Server-side proxy routes with caching so the free tier (800 credits/day,
  8 req/min) is never exceeded and the API key never reaches the browser.

**Out:**
- Price streaming/websockets, historical charts, price alerts.
- Any schema/migration change — `trades.instrument` remains free text.
- Non-US stock exchanges (free tier limitation; revisit on paid plan).

## Provider

- **Twelve Data free tier** — one API key, env var `TWELVEDATA_API_KEY`
  (server-only, added to `.env.local` and production env).
- Forex (`EUR/USD`), metals (`XAU/USD`), crypto (`BTC/USD`), US stocks
  (`AAPL`) all covered on free tier. Symbol format matches what the app
  already stores — no data conversion needed.
- **Indices:** free-tier access uncertain. Verify with the real key at build
  time. If blocked, keep static index entries in search results and price
  them via ETF proxies, clearly labelled "proxy":
  `US30→DIA`, `NAS100→QQQ`, `SPX500→SPY`, `GER40→EWG`. Proxy prices are for
  reference only and are never autofilled into the entry field.

## Architecture

### Server routes (Next.js route handlers)

1. `GET /api/market/search?q=<query>`
   - Calls Twelve Data `symbol_search`, maps results to
     `{ symbol, name, market, exchange }` using the app's market vocabulary
     (`forex | crypto | stocks | indices | commodities`).
   - Merges/deduplicates with the static `INSTRUMENTS` catalog so core CFD
     symbols always appear first even offline.
   - Cache: in-memory LRU (per server instance) keyed by normalized query,
     TTL 24 h, plus `Cache-Control: s-maxage=86400`.
   - Auth: requires a logged-in session (reuse existing route-handler auth
     pattern) so the proxy can't be farmed anonymously.

2. `GET /api/market/quote?symbol=<sym>`
   - Calls Twelve Data `price` (1 credit). Returns
     `{ symbol, price, at, proxy?: string }`.
   - Cache: in-memory, TTL 60 s per symbol, shared across all users, plus
     `Cache-Control: s-maxage=60, stale-while-revalidate=300`.
   - On provider 429 / credit exhaustion: serve stale cache if present,
     otherwise `503` with `{ unavailable: true }`.
   - Auth: same as search.

### Client (trade-capture modal)

- New `InstrumentCombobox` component replaces the `<input list>` + datalist
  in `TradeModalProvider.tsx`:
  - Debounced search (300 ms, min 2 chars); before that, shows the static
    catalog filtered locally.
  - Result rows show symbol, name, and a market badge; keyboard navigation
    (arrows + enter) and click both select.
  - Free text remains valid — typing a custom symbol and tabbing away keeps
    it, exactly like today.
  - Selecting a result also sets the `market` select automatically.
- New `LivePriceChip` next to the entry price field:
  - Fetches `/api/market/quote` when the selected symbol changes (no
    polling); shows price + relative age + refresh button.
  - "Use" button copies the price into the entry input.
  - Hidden entirely when the quote route reports unavailable — never blocks
    saving a trade.
- Pip metadata continues to come from `instruments.ts` (`pipInfo`), which
  already infers values for unknown symbols. No change to P/L preview math.

## Error handling

- Search API failure → combobox silently falls back to static catalog.
- Quote failure → chip hidden; no error surfaced in the form.
- Rate-limit protection is server-side (cache + single upstream key);
  client also debounces.
- Provider quirks (symbol not found) → quote route returns 404, chip hidden.

## Testing

- Unit tests (Jest) for both route handlers with mocked `fetch`: mapping,
  cache hit/miss, stale-on-429, auth rejection.
- Unit test for market-vocabulary mapping (Twelve Data `instrument_type` →
  app market).
- Manual preview verification of combobox keyboard flow, market auto-set,
  price autofill, and graceful degradation with the key removed.

## Rollout

- Ships behind nothing — feature is additive and degrades to current
  behavior without a key. If `TWELVEDATA_API_KEY` is unset, search uses the
  static catalog and the price chip never renders.
