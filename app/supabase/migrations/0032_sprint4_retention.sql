-- Sprint 4 (retention + growth):
--   process_goals            — process-goal tracking (row 24)
--   notifications extensions — system notification types + nullable actor (row 31)
--   profiles.notification_prefs / last_weekly_email — prefs + email cadence (rows 31/32)

-- 1) Process goals ----------------------------------------------------------------
create table if not exists public.process_goals (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in (
    'journal_consistency', 'rule_compliance', 'max_risk', 'weekly_reviews', 'avoid_revenge'
  )),
  target numeric not null check (target > 0),
  -- window the goal is measured over, in days (e.g. 14-day revenge-free streak).
  window_days integer not null default 30 check (window_days > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists process_goals_user_idx on public.process_goals (user_id) where active;

alter table public.process_goals enable row level security;
drop policy if exists process_goals_select on public.process_goals;
create policy process_goals_select on public.process_goals
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists process_goals_insert on public.process_goals;
create policy process_goals_insert on public.process_goals
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists process_goals_update on public.process_goals;
create policy process_goals_update on public.process_goals
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists process_goals_delete on public.process_goals;
create policy process_goals_delete on public.process_goals
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 2) System notifications ---------------------------------------------------------
-- System events (weekly report, sync failure, goal completed, rule breach,
-- learning) have no actor, so relax the NOT NULL and widen the type check.
alter table public.notifications alter column actor_id drop not null;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'like', 'comment', 'follow', 'post_share', 'mention', 'message',
    'weekly_report', 'import_done', 'sync_failed', 'goal_completed', 'rule_breach', 'new_learning'
  ));

-- 3) Notification prefs + email cadence ------------------------------------------
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}',
  add column if not exists last_weekly_email timestamptz,
  add column if not exists last_recovery_email timestamptz;
