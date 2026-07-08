# MT5 Auto-Sync via MetaApi — Design (Phase 2)

Date: 2026-07-06
Status: Approved for implementation
Scope: Daily automatic MT5 trade sync for Pro tier via MetaApi.cloud. Builds on Phase 1 (manual import — `mapDealToTrade`, `broker_deal_id` dedupe index, `mt5_autosync` feature flag already wired).

## Decisions (user-locked)

- **1 broker connection per user** (unique constraint; multi-account later if demanded).
- **Daily deploy→fetch→undeploy** cadence — cheapest MetaApi posture (undeployed accounts don't bill runtime); journal updates once daily. UI copy says "syncs daily".
- Hosting: **Vercel** — two daily cron jobs (fits Hobby plan's 2-cron limit).

## Key architecture choice: no credential storage

The investor (read-only) password is sent to MetaApi ONCE at provisioning; MetaApi holds broker credentials on their side. We store only the returned `metaapi_account_id` plus login + server for display. **No password column, no encryption infra.** If the broker password changes, the user reconnects (re-enters). This supersedes the original feasibility doc's encrypted-at-rest design.

## Components

### Migration `0019_broker_accounts.sql`

```sql
create table public.broker_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'mt5',
  login text not null,
  server text not null,
  metaapi_account_id text not null,
  status text not null default 'pending',   -- pending | active | error | disconnected
  last_sync_at timestamptz,
  last_deal_time timestamptz,               -- sync cursor
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index broker_accounts_user_idx on public.broker_accounts (user_id);
-- RLS: owner select/insert/delete (auth.uid() = user_id) — connect/disconnect
-- actions run on the authenticated user client. NO update policy: only the
-- sync routes update rows, and they use the service client (bypasses RLS).
```

Plus `trades_touch_updated_at`-style trigger reuse.

### MetaApi client (`app/src/lib/server/metaapi.ts`)

Thin REST wrapper (no SDK dependency — 4 endpoints), server-only, token from `METAAPI_TOKEN`:

- `provisionAccount({ login, password, server })` → POST provisioning API `/users/current/accounts` (type cloud-g2, platform mt5, magic 0) → `{ accountId }`. Password passes through; never persisted.
- `deployAccount(accountId)` / `undeployAccount(accountId)` → POST `.../deploy` `.../undeploy`.
- `removeAccount(accountId)` → DELETE (used on disconnect).
- `fetchDealsSince(accountId, since)` → GET client API `/users/current/accounts/{id}/history-deals/time/{since}/{now}` → raw MetaApi deals.
- `dealToMt5Deal(raw deals[])` → pairs/aggregates MetaApi deal records into Phase 1's `Mt5Deal` shape (position-based: entry deal + exit deal per position id; partial closes = one `Mt5Deal` per exit deal, ticket = exit deal id). Pure function, unit-tested with fixture JSON.

### Server actions (`app/src/app/actions/broker.ts`)

- `connectBroker(formData)` — auth (`getUser`), gate `canFlag(tier, 'mt5_autosync')`, reject if row exists, validate login/server/password non-empty, `provisionAccount`, insert row (status pending). Returns `{ ok }` or `{ error }`.
- `disconnectBroker()` — auth, owns-row check, `removeAccount` (best-effort), delete row.
- `getBrokerStatus()` — auth, returns row summary for settings UI (no secrets exist to leak).

### Sync routes (Vercel cron)

- `GET /api/mt5-sync/deploy` (cron 03:00 UTC): guard `Authorization: Bearer ${CRON_SECRET}`; service client lists `status in (pending,active,error)` rows → `deployAccount` each (fire-and-forget REST, seconds per account); tolerate individual failures (record `sync_error`).
- `GET /api/mt5-sync/collect` (cron 03:30 UTC): same guard; per row: `fetchDealsSince(metaapi_account_id, last_deal_time ?? account creation)` → `dealToMt5Deal` → `mapDealToTrade(deal, { userId, isPublic: profile default })` → service-client upsert `onConflict (user_id,broker_deal_id) ignoreDuplicates` → `undeployAccount` → update `last_sync_at`, `last_deal_time` (max deal time), `status: 'active'`, clear `sync_error`. Per-row try/catch: failure records `sync_error` + `status: 'error'`, still attempts undeploy, continues loop.
- `vercel.json` gains the two cron entries.

### Settings UI

`/settings` gains "Broker connection" section (or `/settings/broker` page — plan decides by existing settings layout):
- Pro-gated by `mt5_autosync` flag; below-tier → locked card (existing 🔒 pattern → billing).
- Disconnected state: form (login, investor password with "read-only investor password, never your master password" helper, server name) → `connectBroker`.
- Connected state: login/server display, status chip (pending/active/error + sync_error text), "Last synced …", "Syncs daily" note, Disconnect button (confirm).

### Env

- `METAAPI_TOKEN` — MetaApi API token (user creates MetaApi account; needed before implementation verify).
- `CRON_SECRET` — random string; set in Vercel + local .env.

## Security

- Investor password: transits our server once (connect action → MetaApi REST over TLS), never logged, never stored.
- Cron routes reject without `CRON_SECRET` bearer.
- Tier gate server-side in `connectBroker`; sync routes act only on existing rows (created gated).
- If a Pro sub lapses: connection row stays, sync skips rows whose owner no longer passes `mt5_autosync` (checked in collect loop) — status set 'error' with "Pro plan required" message. (Cheap check via subscriptions lookup per row.)

## Edge cases

- Deploy not ready by collect time → fetch fails → error recorded, undeploy attempted, retry next day.
- MetaApi provision rejects bad creds → connect action surfaces MetaApi's error message.
- Duplicate deals across days → Phase 1 unique index no-ops.
- User deletes account (profiles cascade) → broker_accounts row cascades; MetaApi orphan cleaned by disconnect path only — accepted gap, note in code.
- Timezone: MetaApi returns ISO times — stored as-is (UTC), consistent with Phase 1 caveat.

## Testing

- Unit: `dealToMt5Deal` pairing (entry+exit, partial closes, open positions excluded) with MetaApi-shaped fixture JSON; cursor advance logic if extracted pure.
- Route-level: CRON_SECRET rejection (pure request-guard function, unit-testable).
- Live verify (needs METAAPI_TOKEN + a demo MT5 account): connect → manual route invocation → trades appear → disconnect.

## Out of scope

- Real-time/WebSocket sync, multi-account, MT4, open-positions view, equity curve. Manual import (Phase 1) remains the fallback for all tiers ≥ trader.

## Amendment — 2026-07-08

Cadence changed from daily deploy→fetch→undeploy to **always-on, sync every 15 minutes** (user decision). Accounts stay deployed permanently; collect route no longer undeploys (disconnect remains the only teardown). Crons: deploy :00/:15/:30/:45 (ensure-deployed + gate), collect :05/:20/:35/:50. Cost implication accepted: full MetaApi runtime billing per connected account. Requires Vercel Pro (Hobby crons are daily-only).
