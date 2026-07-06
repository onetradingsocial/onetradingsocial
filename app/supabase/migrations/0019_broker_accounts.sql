-- MT5 auto-sync (phase 2): one MetaApi-backed broker connection per user.
-- No credential storage: MetaApi holds broker creds after one-time provisioning.
create table if not exists public.broker_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'mt5',
  login text not null,
  server text not null,
  metaapi_account_id text not null,
  region text not null default 'london',
  status text not null default 'pending',   -- pending | active | error | disconnected
  last_sync_at timestamptz,
  last_deal_time timestamptz,               -- sync cursor (max closed-deal time seen)
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists broker_accounts_user_idx
  on public.broker_accounts (user_id);

drop trigger if exists broker_accounts_touch_updated_at on public.broker_accounts;
create trigger broker_accounts_touch_updated_at
  before update on public.broker_accounts
  for each row execute function public.touch_updated_at();

alter table public.broker_accounts enable row level security;

-- Owner select/insert/delete; NO update policy (sync routes use service role).
drop policy if exists broker_accounts_select on public.broker_accounts;
create policy broker_accounts_select on public.broker_accounts
  for select using (auth.uid() = user_id);

drop policy if exists broker_accounts_insert on public.broker_accounts;
create policy broker_accounts_insert on public.broker_accounts
  for insert with check (auth.uid() = user_id);

drop policy if exists broker_accounts_delete on public.broker_accounts;
create policy broker_accounts_delete on public.broker_accounts
  for delete using (auth.uid() = user_id);
