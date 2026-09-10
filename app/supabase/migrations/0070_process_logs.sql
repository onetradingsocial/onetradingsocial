-- Process logs: the data the reward system pays for after volume quotas are removed.
-- Audit 2026-09-05, P0 ("the reward system pays people to place and close trades").
--
-- THE PROBLEM THIS BACKS
--
-- Daily quests were "log a trade" + "close a trade". Weekly quests were "log 10"
-- + "close 5". Badges counted closed trades (1/10/50/100/500) and win streaks
-- (5/10). Every one of those is satisfied only by transacting, in a product whose
-- stated purpose is helping traders trade LESS and better. A week in which the
-- correct decision was to stand aside scored zero on every axis and broke every
-- streak.
--
-- The replacement rewards three things a trader can do without touching the
-- market, and this table is where they are recorded:
--
--   review          -- "I sat down and reviewed my trading."
--   rule_reflection -- "Did I follow my rules?" with outcome followed/broke/unknown.
--   no_trade        -- "I was at the desk and deliberately took nothing."
--   rest            -- "Scheduled day away from the screens."
--
-- WHY `day` IS SERVER-STAMPED AND UNIQUE
--
-- Audit item 15 F7 is the precedent: quest bonuses used to bucket on
-- user-supplied trade timestamps, and backdating -- which the product permits on
-- purpose -- turned a bulk insert into months of retroactive bonuses. The same
-- hole is not reopened here. `day` defaults to the UTC date at insert time and is
-- NOT granted to the client roles below, so it cannot be chosen; the unique index
-- caps a user at one row per kind per day, which caps the whole process reward
-- surface at four entries a day no matter how the endpoint is driven.
--
-- Consequence worth stating plainly: there is no backfill. A user cannot record
-- "I rested last Tuesday". That is deliberate -- a habit mechanic that can be
-- filled in afterwards measures nothing.

create table if not exists public.process_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('review', 'rule_reflection', 'no_trade', 'rest')),
  -- UTC calendar day this entry belongs to. Server default only -- see above.
  day date not null default ((now() at time zone 'utc')::date),
  -- Only a rule reflection carries an outcome, and it MUST carry one. 'unknown'
  -- is a first-class answer: a reward that only paid for 'followed' would be
  -- paying for the answer rather than for the reflection.
  outcome text,
  created_at timestamptz not null default now(),
  constraint process_logs_outcome_shape check (
    case
      when kind = 'rule_reflection' then outcome in ('followed', 'broke', 'unknown')
      else outcome is null
    end
  )
);

-- One row per kind per day. This is the anti-farm control, not a convenience:
-- without it the daily quest is satisfiable N times and the XP it feeds is
-- unbounded.
create unique index if not exists process_logs_user_day_kind_uidx
  on public.process_logs (user_id, day, kind);
-- Read path: every log for one user, newest first (streaks, quests, badges).
create index if not exists process_logs_user_day_idx
  on public.process_logs (user_id, day desc);

alter table public.process_logs enable row level security;

drop policy if exists process_logs_select on public.process_logs;
create policy process_logs_select on public.process_logs
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists process_logs_insert on public.process_logs;
create policy process_logs_insert on public.process_logs
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists process_logs_update on public.process_logs;
create policy process_logs_update on public.process_logs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists process_logs_delete on public.process_logs;
create policy process_logs_delete on public.process_logs
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Column grants, same idiom as 0042/0045. RLS says WHICH ROW; these say WHICH
-- COLUMN. `day` and `created_at` appear in neither list, so the calendar bucket a
-- reward lands in is not client-settable. `kind` is insert-only: changing a rest
-- day into a review after the fact would launder the unique index.
revoke insert, update on public.process_logs from anon, authenticated;
grant insert (user_id, kind, outcome) on public.process_logs to authenticated;
grant update (outcome) on public.process_logs to authenticated;
