-- Crypto sync phase 1: the pairs to query on exchanges that need a per-symbol
-- fetch (Binance). Stored in exchange form (e.g. 'BTC/USDT').
alter table public.exchange_accounts
  add column if not exists symbols text[] not null default '{}';

-- 0037 revoked table-level SELECT and re-granted an explicit column list, which
-- does NOT cover columns added later. Grant SELECT on this new non-secret column
-- so the user-session client can read it (the *_enc columns stay service-role only).
grant select (symbols) on public.exchange_accounts to authenticated, anon;
