-- Make a broker sync failure say WHICH phase failed, and stop the collect phase
-- from erasing the deploy phase's error.
--
-- THE PROBLEM THIS SOLVES
--
-- The MT5 sync runs in two phases an hour apart (mt5-sync.yml): deploy at :00,
-- collect at :10. Both write public.broker_accounts.sync_error, and collect
-- always runs second, so it always wins.
--
-- On 2026-08-24 the deploy phase was failing with the real cause:
--
--     deploy: To allow trading account deployment please top up your account.
--
-- Ten minutes later collect could not read an account that had never been
-- deployed, and overwrote that with its own downstream symptom:
--
--     fetch: It seems like the account ... is not connected to broker yet
--     or request URL you use does not match the account region.
--
-- The second message points at a region misconfiguration that does not exist.
-- Every hour the root cause was replaced by a misleading symptom, so the row
-- only ever showed the wrong answer. That turned a one-minute diagnosis into a
-- multi-step investigation.
--
-- THE FIX
--
-- Two columns, both service-role only:
--
--   sync_error_phase  which phase wrote the current sync_error ('deploy' |
--                     'collect'). Nullable, and null whenever sync_error is
--                     null, so a healthy row carries no stale phase.
--
--   sync_error_at     when it was written. collect uses this to decide whether
--                     a deploy error is still current (same hourly cycle) and
--                     therefore must be preserved rather than overwritten --
--                     see the fail() helper in api/mt5-sync/collect/route.ts.
--
-- NO GRANTS NEEDED. 0046 revoked table-wide insert/update from anon and
-- authenticated and re-granted insert on exactly five columns (user_id, login,
-- server, metaapi_account_id, region). New columns are not in that list, so
-- they are service-role only by construction -- which is what we want: these
-- are written by the sync job, never by a user. Adding them cannot widen the
-- badge-minting vector 0046 closed.
--
-- BACKFILL. Existing error rows get phase 'collect': collect is the only phase
-- that has ever been able to leave a lasting error, precisely because of the
-- bug above. sync_error_at is left null rather than guessed -- updated_at is
-- not a safe proxy, since any write to the row touches it.

alter table public.broker_accounts
  add column if not exists sync_error_phase text,
  add column if not exists sync_error_at timestamptz;

alter table public.broker_accounts
  drop constraint if exists broker_accounts_sync_error_phase_check;

alter table public.broker_accounts
  add constraint broker_accounts_sync_error_phase_check
  check (sync_error_phase is null or sync_error_phase in ('deploy', 'collect'));

update public.broker_accounts
   set sync_error_phase = 'collect'
 where sync_error is not null
   and sync_error_phase is null;

comment on column public.broker_accounts.sync_error_phase is
  'Which mt5-sync phase wrote sync_error: deploy | collect. Service-role only.';
comment on column public.broker_accounts.sync_error_at is
  'When sync_error was written. Lets collect preserve a same-cycle deploy error.';
