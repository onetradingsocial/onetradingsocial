-- Make the moderation retention period an actual job. Audit item 1 (retention),
-- closing the last of the periods printed in privacy.html section 13.
--
-- ***************************************************************************
-- ** NOT APPLIED. Hand this to the owner and apply it WITH the WS8 deploy.  **
-- ***************************************************************************
--
-- WHERE THIS SITS
--
-- privacy.html now states a retention period per class of record. Three of
-- those periods are ours to enforce; the rest are somebody else's:
--
--   Usage and analytics records .... 12 months .... purge_analytics_events()
--                                                   (0055, applied by WS7)
--   Administrator access records ... 24 months .... admin_audit_prune()
--                                                   (0052 -- exists, and was
--                                                   never scheduled. WS8 calls
--                                                   it from the daily cron.)
--   Moderation reports ............. 3 years ...... THIS FILE
--   Billing records ................ 5 years ...... held by Stripe
--   Emails we have sent ............ provider ..... held by Resend
--   Account content ................ until you delete your account -- handled
--                                    by the deletion flow, not by a timer
--
-- 0054 created the retention and said so plainly: "There is no purge job for
-- this table, here or anywhere." This is that job.
--
-- WHAT "3 YEARS OR UNTIL RESOLVED, WHICHEVER IS LONGER" MEANS IN SQL
--
-- The policy wording is deliberate and the implementation has to honour both
-- halves of it. `whichever is longer` means age alone is NEVER sufficient: an
-- open report is kept indefinitely, because the matter is not finished and
-- deleting it would mean an unresolved abuse report ages out of existence
-- while the account it concerns is still active. So the predicate is
--
--     created_at < now() - 3 years   AND   status IN ('actioned','dismissed')
--
-- and never `created_at` alone. Reports in 'open' or 'reviewing' are untouched
-- at any age; if a three-year-old report is still 'reviewing', that is a
-- moderation backlog to work through, not a row to delete.
--
-- WHY THE DELETION IS FULL, NOT A SCRUB
--
-- 0051 already replaces the reported user's identity with a salted hash when
-- their account is deleted, so a surviving row is not necessarily identifying.
-- But the row still holds `reason`, free-text `detail` (up to 1,000 characters
-- written by another member about a person), and `reporter_id`. Past the
-- retention period there is no purpose left to serve, and APP 11.2 says destroy
-- or de-identify when no longer needed. Deleting is the honest reading.
--
-- HOW IT RUNS
--
-- No pg_cron on this project, and Vercel Hobby caps cron jobs at 2 (both
-- taken). Like the analytics purge, it is invoked from the existing daily
-- /api/cron/lifecycle-emails route, which tolerates the function not existing
-- so the app can deploy ahead of the migration.
--
-- There are 0 rows in `trade_reports` in production today and the platform is
-- under a year old, so this function will not delete anything for years. That
-- is the point: the job exists BEFORE there is data for it to act on, rather
-- than being written in a hurry when someone notices the period has lapsed.

begin;

create or replace function public.purge_trade_reports(
  retain_years integer default 3,
  max_rows integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare removed integer;
begin
  with doomed as (
    select id from public.trade_reports
     where created_at < now() - make_interval(years => retain_years)
       and status in ('actioned', 'dismissed')
     order by id
     limit max_rows
  )
  delete from public.trade_reports r
   using doomed d
   where r.id = d.id;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.purge_trade_reports(integer, integer) is
  'Deletes moderation reports past the retention period stated in '
  'privacy.html section 13: 3 years from the report AND resolved. Open or '
  'reviewing reports are never deleted by age -- "whichever is longer". '
  'Called daily from /api/cron/lifecycle-emails. Bounded by max_rows.';

revoke execute on function public.purge_trade_reports(integer, integer)
  from public, anon, authenticated;
grant execute on function public.purge_trade_reports(integer, integer)
  to service_role;

-- Supports the predicate. Partial: only resolved reports are ever candidates.
create index if not exists trade_reports_retention_idx
  on public.trade_reports (created_at)
  where status in ('actioned', 'dismissed');

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying, against jmpanzrjxflovdfwcbye)
--
--   -- what is currently out of policy (expect 0 -- the table is empty today):
--   select count(*) from public.trade_reports
--    where created_at < now() - interval '3 years'
--      and status in ('actioned','dismissed');
--
--   -- an open report must survive any age. Prove it without writing data by
--   -- checking the predicate directly:
--   select status, count(*) from public.trade_reports group by status;
--
--   -- real run (returns the number deleted):
--   select public.purge_trade_reports();
--
--   -- client roles must be shut out:
--   select has_function_privilege('authenticated',
--     'public.purge_trade_reports(integer,integer)', 'execute');   -- expect f
--
-- ROLLBACK
--
--   drop function if exists public.purge_trade_reports(integer, integer);
--   drop index if exists public.trade_reports_retention_idx;
--
-- The deletions are NOT reversible. Take the backup first.
-- ---------------------------------------------------------------------------
