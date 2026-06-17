-- Account fields on profiles
alter table public.profiles
  add column if not exists account_balance numeric not null default 0,
  add column if not exists account_currency text not null default 'USD';

-- Enums
do $$ begin create type trade_direction as enum ('long','short'); exception when duplicate_object then null; end $$;
do $$ begin create type sizing_mode as enum ('risk_percent','lots'); exception when duplicate_object then null; end $$;
do $$ begin create type trade_outcome as enum ('open','win','loss','breakeven'); exception when duplicate_object then null; end $$;
do $$ begin create type trade_status as enum ('open','closed'); exception when duplicate_object then null; end $$;
do $$ begin create type trade_confidence as enum ('low','medium','high'); exception when duplicate_object then null; end $$;
do $$ begin create type trade_emotion as enum ('calm','focused','excited','anxious'); exception when duplicate_object then null; end $$;

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  market text not null,
  instrument text not null,
  direction trade_direction not null,
  entry_price numeric not null,
  stop_price numeric not null,
  target_price numeric,
  exit_price numeric,
  sizing_mode sizing_mode not null,
  risk_percent numeric,
  lots numeric,
  risk_amount numeric not null default 0,
  sl_pips numeric not null default 0,
  tp_pips numeric,
  planned_rr numeric,
  r_multiple numeric,
  pnl_amount numeric,
  realized_pips numeric,
  outcome trade_outcome not null default 'open',
  status trade_status not null default 'open',
  setup_type text,
  confidence trade_confidence,
  emotion trade_emotion,
  note text,
  screenshot_url text,
  is_public boolean not null default true,
  mistake_tags text[] not null default '{}',
  strategy_tags text[] not null default '{}',
  traded_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trades_user_traded_idx on public.trades (user_id, traded_at desc);
create index if not exists trades_public_idx on public.trades (is_public) where is_public = true;

drop trigger if exists trades_touch_updated_at on public.trades;
create trigger trades_touch_updated_at
  before update on public.trades
  for each row execute function public.touch_updated_at();

alter table public.trades enable row level security;

drop policy if exists trades_select on public.trades;
create policy trades_select on public.trades
  for select using (is_public = true or auth.uid() = user_id);

drop policy if exists trades_insert on public.trades;
create policy trades_insert on public.trades
  for insert with check (auth.uid() = user_id);

drop policy if exists trades_update on public.trades;
create policy trades_update on public.trades
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists trades_delete on public.trades;
create policy trades_delete on public.trades
  for delete using (auth.uid() = user_id);
