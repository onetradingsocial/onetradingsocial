-- Bound the lifetime of the anonymous behavioural profile. Audit item 17, F4 + F10.
--
-- ***************************************************************************
-- ** NOT APPLIED. Hand this to the owner and apply it WITH the WS7 deploy.  **
-- ***************************************************************************
--
-- WHY THIS EXISTS
--
-- `analytics_events.anon_id` is the client-side `ts_anon_id` device identifier.
-- Before WS7 it was a `crypto.randomUUID()` written once to localStorage and
-- never rotated -- localStorage has no expiry mechanism at all -- so it was the
-- longest-lived identifier on the platform, outliving every cookie on the page
-- (which top out at 400 days under Chrome's cap, and 90 days for the ad
-- pixels). Server side there was no deletion job of any kind, so the rows kept
-- forever too.
--
-- The problem is not the row. It is that `anon_id` is a JOIN KEY. A visitor
-- browses anonymously for months, then signs up; from that point the same
-- anon_id appears on rows that carry a `user_id`, and their entire pre-signup
-- browsing history is retrospectively attached to a named account. That
-- retrospective linkage is exactly what turns "anonymous analytics" into
-- personal information under the Privacy Act, and an unbounded retention of it
-- cannot be squared with APP 11.2 (destroy or de-identify when no longer
-- needed) or with the retention table in privacy.html.
--
-- WHAT WS3 ALREADY DID, AND WHY THAT IS NOT ENOUGH
--
-- 0051 scrubs `anon_id` when an account is deleted, which closes the linkage
-- for people who had an account and asked to leave. It does nothing for the
-- much larger population who never signed up at all -- nobody deletes an
-- account they never created. This file is the other half.
--
-- WHAT IT DOES
--
-- Two different treatments, because the two cases are not the same:
--
--   * Rows with `user_id IS NULL` (never-signed-up visitors) are DELETED after
--     12 months. There is no legitimate need to keep an individual anonymous
--     visitor's event rows for longer, and de-identifying them in place is not
--     enough because the anon_id IS the identifier.
--
--   * Rows with a `user_id` are NOT deleted -- they belong to an account that
--     still exists, and section 13 of the policy commits to keeping the
--     aggregate. Instead their `anon_id` is nulled after 12 months. The count
--     survives; the cross-visit device linkage does not.
--
-- The 12-month window is deliberately longer than the client-side 180-day
-- rotation in app/src/lib/track.ts, so a live browser identifier is never
-- orphaned mid-life. It is shorter than the 13-month GA4 retention set in the
-- same workstream.
--
-- HOW IT RUNS
--
-- There is no pg_cron on this project. The function is invoked from the daily
-- `/api/cron/lifecycle-emails` route (Vercel Hobby caps the number of cron
-- jobs, which is why that route is the catch-all). The caller tolerates the
-- function not existing, so the app is safe to deploy before this is applied --
-- but the retention promise in privacy.html is not honoured until it is.
--
-- Idempotent. Safe to re-run. Deletes are bounded per call so a first run
-- against a large backlog cannot hold a long transaction.

begin;

create or replace function public.purge_analytics_events(
  retain_days integer default 365,
  max_rows integer default 50000
)
returns table (deleted bigint, anonymised bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cutoff timestamptz := now() - make_interval(days => retain_days);
  del bigint := 0;
  anon bigint := 0;
begin
  -- 1) Visitors who never created an account: remove the rows outright.
  with doomed as (
    select id from public.analytics_events
    where user_id is null and created_at < cutoff
    order by id
    limit max_rows
  )
  delete from public.analytics_events e
  using doomed d
  where e.id = d.id;
  get diagnostics del = row_count;

  -- 2) Rows belonging to a live account: keep the count, drop the device link.
  with stale as (
    select id from public.analytics_events
    where user_id is not null and anon_id is not null and created_at < cutoff
    order by id
    limit max_rows
  )
  update public.analytics_events e
  set anon_id = null
  from stale s
  where e.id = s.id;
  get diagnostics anon = row_count;

  return query select del, anon;
end;
$$;

comment on function public.purge_analytics_events(integer, integer) is
  'Audit item 17 F4/F10. Deletes analytics_events rows for never-signed-up '
  'visitors after retain_days, and nulls anon_id on rows belonging to live '
  'accounts. Called daily from /api/cron/lifecycle-emails. Bounded by max_rows.';

-- Service role only. This function deletes rows and runs as definer; neither
-- client role has any business reaching it.
revoke execute on function public.purge_analytics_events(integer, integer)
  from public, anon, authenticated;
grant execute on function public.purge_analytics_events(integer, integer)
  to service_role;

-- Supports the two predicates above. Partial index: rows that still have an
-- anon_id are the only ones either branch cares about.
create index if not exists analytics_events_retention_idx
  on public.analytics_events (created_at)
  where anon_id is not null;

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying, against jmpanzrjxflovdfwcbye)
--
--   -- what is currently out of policy, before any deletion:
--   select count(*) filter (where user_id is null)     as anon_rows_over_12m,
--          count(*) filter (where user_id is not null) as account_rows_over_12m
--   from public.analytics_events
--   where created_at < now() - interval '365 days';
--
--   -- dry run on a window that should match nothing:
--   select * from public.purge_analytics_events(100000, 1);
--
--   -- real run:
--   select * from public.purge_analytics_events();
--
-- ROLLBACK
--
--   drop function if exists public.purge_analytics_events(integer, integer);
--   drop index if exists public.analytics_events_retention_idx;
--
-- Note the deletions themselves are NOT reversible. Take the backup first.
-- ---------------------------------------------------------------------------
