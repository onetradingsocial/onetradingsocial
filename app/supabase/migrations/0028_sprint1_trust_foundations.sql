-- Sprint 1 foundations (Verification & Trust + Analytics):
--   1. trades.source — per-trade verification level (manual / statement / broker)
--   2. profiles.account_type — live / demo / prop / competition label
--   3. trade_audits — immutable audit trail + execution-field lock on imported trades
--   4. analytics_events — first-party funnel event store (server-write only)
--   5. feedback — verification/account categories + structured context metadata

-- 1) Trade verification source ------------------------------------------------
do $$ begin
  create type trade_source as enum ('manual', 'statement', 'broker');
exception when duplicate_object then null; end $$;

alter table public.trades
  add column if not exists source trade_source not null default 'manual';

-- Rows with a broker_deal_id predate this column and came from the phase-1
-- MT5 statement/file import, not the live MetaApi sync.
update public.trades set source = 'statement'
  where broker_deal_id is not null and source = 'manual';

create index if not exists trades_user_source_idx on public.trades (user_id, source);

-- 2) Account type label on profiles --------------------------------------------
do $$ begin
  create type trading_account_type as enum ('live', 'demo', 'prop', 'competition');
exception when duplicate_object then null; end $$;

-- Null = not yet declared; UI prompts during onboarding/settings and shows
-- "Unspecified" until the user picks one.
alter table public.profiles
  add column if not exists account_type trading_account_type;

-- 3) Immutable trade audit trail ------------------------------------------------
-- Intentionally no FK to trades: history must survive trade deletion.
create table if not exists public.trade_audits (
  id bigint generated always as identity primary key,
  trade_id uuid not null,
  user_id uuid not null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  actor uuid,                       -- auth.uid(); null = system / service job
  source trade_source,              -- trade source at time of event
  changed_fields text[] not null default '{}',
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trade_audits_trade_idx on public.trade_audits (trade_id, created_at);
create index if not exists trade_audits_user_idx on public.trade_audits (user_id, created_at desc);

alter table public.trade_audits enable row level security;

-- Owners can read their own history. No client write policies: rows are
-- inserted only by the security-definer trigger below and are never updated.
drop policy if exists trade_audits_select on public.trade_audits;
create policy trade_audits_select on public.trade_audits
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.audit_trade_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  oldj jsonb;
  newj jsonb;
  changed text[];
begin
  if tg_op = 'INSERT' then
    insert into public.trade_audits (trade_id, user_id, action, actor, source, new_values)
    values (new.id, new.user_id, 'created', auth.uid(), new.source, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    oldj := to_jsonb(old);
    newj := to_jsonb(new);
    changed := array(
      select key from jsonb_each(newj) as e(key, val)
      where val is distinct from oldj -> key and key <> 'updated_at'
    );
    if coalesce(array_length(changed, 1), 0) = 0 then return new; end if;
    insert into public.trade_audits
      (trade_id, user_id, action, actor, source, changed_fields, old_values, new_values)
    values (
      new.id, new.user_id, 'updated', auth.uid(), old.source, changed,
      (select jsonb_object_agg(k, oldj -> k) from unnest(changed) as k),
      (select jsonb_object_agg(k, newj -> k) from unnest(changed) as k)
    );
    return new;
  else
    insert into public.trade_audits (trade_id, user_id, action, actor, source, old_values)
    values (old.id, old.user_id, 'deleted', auth.uid(), old.source, to_jsonb(old));
    return old;
  end if;
end $$;

drop trigger if exists trades_audit on public.trades;
create trigger trades_audit
  after insert or update or delete on public.trades
  for each row execute function public.audit_trade_change();

-- Execution data on imported trades is locked for users. Journal fields
-- (note, screenshot, tags, emotion, confidence, visibility) stay editable.
-- Service-role jobs (auth.uid() is null) may still correct sync data.
create or replace function public.protect_imported_trade_fields()
returns trigger
language plpgsql set search_path = public as $$
begin
  if old.source = 'manual' or auth.uid() is null then return new; end if;
  if (new.market, new.instrument, new.direction, new.entry_price, new.stop_price,
      new.target_price, new.exit_price, new.sizing_mode, new.risk_percent, new.lots,
      new.risk_amount, new.sl_pips, new.tp_pips, new.planned_rr, new.r_multiple,
      new.pnl_amount, new.realized_pips, new.outcome, new.status,
      new.traded_at, new.closed_at, new.broker_deal_id, new.source)
     is distinct from
     (old.market, old.instrument, old.direction, old.entry_price, old.stop_price,
      old.target_price, old.exit_price, old.sizing_mode, old.risk_percent, old.lots,
      old.risk_amount, old.sl_pips, old.tp_pips, old.planned_rr, old.r_multiple,
      old.pnl_amount, old.realized_pips, old.outcome, old.status,
      old.traded_at, old.closed_at, old.broker_deal_id, old.source) then
    raise exception 'Imported execution data is locked; only journal fields can be edited.';
  end if;
  return new;
end $$;

drop trigger if exists trades_protect_imported on public.trades;
create trigger trades_protect_imported
  before update on public.trades
  for each row execute function public.protect_imported_trade_fields();

-- Trigger functions are not meant to be reachable through the Data API.
revoke execute on function public.audit_trade_change() from public, anon, authenticated;
revoke execute on function public.protect_imported_trade_fields() from public, anon, authenticated;

-- 4) First-party analytics events -----------------------------------------------
create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  anon_id text,                     -- client id for pre-signup attribution
  event text not null check (char_length(event) between 1 and 64),
  props jsonb not null default '{}',
  path text,
  referrer text,
  device text,                      -- mobile | tablet | desktop
  source text,                      -- utm_source / campaign code
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_event_idx
  on public.analytics_events (event, created_at desc);
create index if not exists analytics_events_user_idx
  on public.analytics_events (user_id, created_at desc) where user_id is not null;

-- Deny-all RLS: writes go through server routes using the service role;
-- reads happen in the admin dashboard (service role).
alter table public.analytics_events enable row level security;

-- 5) Feedback categories + context metadata --------------------------------------
alter table public.feedback drop constraint if exists feedback_type_check;
alter table public.feedback add constraint feedback_type_check
  check (type in ('bug', 'feedback', 'feature', 'verification', 'account', 'other'));

alter table public.feedback
  add column if not exists meta jsonb not null default '{}';

-- 6) Internal-traffic marking ------------------------------------------------------
-- Seeded demo users + admin test account are excluded from analytics.
-- Real admins are detected at request time via ADMIN_EMAILS.
alter table public.profiles
  add column if not exists is_internal boolean not null default false;

update public.profiles set is_internal = true where username in (
  'mateorivera', 'aishakhan', 'liamnguyen', 'sofiarossi', 'noahandersson',
  'priyasharma', 'ethanobrien', 'yukitanaka', 'zaraahmed', 'diegofernandez',
  'claude_admin'
);
