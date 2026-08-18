-- WS1 billing reliability: the two pieces of schema the new lifecycle notices
-- need.
--
-- APPLY THIS *AFTER* THE CODE THAT USES IT IS DEPLOYED. Both changes are
-- purely additive and the code is written to be inert without them:
--
--   * notification inserts of the new types are rejected by the old check
--     constraint, and insertSystemNotification logs the failure rather than
--     throwing, so nothing breaks — the bell entry is simply missing;
--   * the trial-expiry branch in api/cron/lifecycle-emails reads
--     last_trial_email in its OWN query and skips the whole branch when that
--     query errors, so a missing column disables the notice and cannot take
--     the weekly digests or inactivity nudges down with it.
--
-- Once applied, both start working on the next cron run / next Stripe event
-- with no further deploy.

-- 1) Billing + trial notification types ---------------------------------------
-- Same shape as the widening in 0032. These are transactional notices and are
-- deliberately NOT added to PREF_KEYS in app/src/app/actions/notifications.ts,
-- so a user cannot switch off being told that their payment failed or that
-- their trial ended.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'like', 'comment', 'follow', 'post_share', 'mention', 'message',
    'weekly_report', 'import_done', 'sync_failed', 'goal_completed', 'rule_breach', 'new_learning',
    'payment_failed', 'trial_ending', 'trial_expired'
  ));

-- 2) Trial-expiry email throttle ----------------------------------------------
-- Mirrors last_weekly_email / last_recovery_email from 0032. NULL means "never
-- notified", which is the only state the cron acts on: the expiry notice is
-- sent once per account, ever.
alter table public.profiles
  add column if not exists last_trial_email timestamptz;

-- Partial index: the cron's predicate is exactly `last_trial_email is null and
-- trial_started_at is not null`, and the set of accounts that have NOT been
-- notified shrinks over time, so the index stays small.
create index if not exists profiles_trial_notice_idx
  on public.profiles (trial_started_at)
  where last_trial_email is null and trial_started_at is not null;
