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

-- Defense in depth: revoke the blanket table-level SELECT that Supabase's
-- default grants give client roles, then hand back SELECT on only the
-- non-secret columns. The three *_enc columns are never granted to any
-- client role, so only the service role (which bypasses grants) can read
-- the ciphertext. RLS still restricts which rows an owner sees.
revoke select on public.exchange_accounts from authenticated, anon;
grant select (
  id, user_id, exchange, label, status,
  last_sync_at, last_fill_at, sync_error, created_at, updated_at
) on public.exchange_accounts to authenticated, anon;
