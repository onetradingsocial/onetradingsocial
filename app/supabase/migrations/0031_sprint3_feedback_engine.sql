-- Sprint 3 (feedback engine):
--   trading_rules      — user-defined rules (row 18) + compliance analysis (19)
--   trade_reports      — verification dispute/report tools (row 10)
--   feature_requests   — public feature-request board (row 26) + votes/comments

-- 1) Trading rules ----------------------------------------------------------------
-- One row per user; each column is an opt-in rule (null = not set).
create table if not exists public.trading_rules (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  max_trades_per_day integer check (max_trades_per_day is null or max_trades_per_day > 0),
  min_rr numeric check (min_rr is null or min_rr > 0),
  max_risk_percent numeric check (max_risk_percent is null or max_risk_percent > 0),
  require_stop boolean not null default false,
  session text check (session is null or session in ('london', 'newyork', 'asia', 'sydney')),
  no_trade_after_losses integer check (no_trade_after_losses is null or no_trade_after_losses > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trading_rules_touch on public.trading_rules;
create trigger trading_rules_touch before update on public.trading_rules
  for each row execute function public.touch_updated_at();

alter table public.trading_rules enable row level security;

drop policy if exists trading_rules_select on public.trading_rules;
create policy trading_rules_select on public.trading_rules
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists trading_rules_insert on public.trading_rules;
create policy trading_rules_insert on public.trading_rules
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists trading_rules_update on public.trading_rules;
create policy trading_rules_update on public.trading_rules
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 2) Trade / profile reports ------------------------------------------------------
create table if not exists public.trade_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete cascade,
  trade_id uuid,                    -- optional: a specific trade
  reason text not null check (reason in (
    'suspicious_performance', 'misleading_claims', 'impersonation',
    'manipulated_screenshots', 'spam', 'advice_violation'
  )),
  detail text check (detail is null or char_length(detail) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists trade_reports_status_idx on public.trade_reports (status, created_at desc);
create index if not exists trade_reports_reported_idx on public.trade_reports (reported_user_id);
-- One open report per reporter+target+reason (stops spam-reporting).
create unique index if not exists trade_reports_dedupe_idx
  on public.trade_reports (reporter_id, reported_user_id, reason)
  where status = 'open';

alter table public.trade_reports enable row level security;

-- Reporters may file and see their own reports; triage is service-role (admin).
drop policy if exists trade_reports_insert on public.trade_reports;
create policy trade_reports_insert on public.trade_reports
  for insert to authenticated with check ((select auth.uid()) = reporter_id);
drop policy if exists trade_reports_select on public.trade_reports;
create policy trade_reports_select on public.trade_reports
  for select to authenticated using ((select auth.uid()) = reporter_id);

-- 3) Feature-request board --------------------------------------------------------
create table if not exists public.feature_requests (
  id bigint generated always as identity primary key,
  author_id uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(title) between 3 and 120),
  body text check (body is null or char_length(body) <= 2000),
  status text not null default 'under_review' check (status in (
    'under_review', 'planned', 'in_progress', 'released', 'not_planned'
  )),
  created_at timestamptz not null default now()
);
create index if not exists feature_requests_status_idx on public.feature_requests (status, created_at desc);

create table if not exists public.feature_request_votes (
  request_id bigint not null references public.feature_requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

create table if not exists public.feature_request_comments (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.feature_requests(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists frc_request_idx on public.feature_request_comments (request_id, created_at);

alter table public.feature_requests enable row level security;
alter table public.feature_request_votes enable row level security;
alter table public.feature_request_comments enable row level security;

-- Board is public to authenticated users; status changes are service-role only.
drop policy if exists fr_select on public.feature_requests;
create policy fr_select on public.feature_requests for select to authenticated using (true);
drop policy if exists fr_insert on public.feature_requests;
create policy fr_insert on public.feature_requests
  for insert to authenticated with check ((select auth.uid()) = author_id);

drop policy if exists frv_select on public.feature_request_votes;
create policy frv_select on public.feature_request_votes for select to authenticated using (true);
drop policy if exists frv_insert on public.feature_request_votes;
create policy frv_insert on public.feature_request_votes
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists frv_delete on public.feature_request_votes;
create policy frv_delete on public.feature_request_votes
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists frc_select on public.feature_request_comments;
create policy frc_select on public.feature_request_comments for select to authenticated using (true);
drop policy if exists frc_insert on public.feature_request_comments;
create policy frc_insert on public.feature_request_comments
  for insert to authenticated with check ((select auth.uid()) = author_id);
