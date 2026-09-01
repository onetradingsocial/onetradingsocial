-- The in-trial email sequence (days 1, 7, 12) and the throttle it needs.
--
-- APPLY THIS *AFTER* THE CODE THAT USES IT IS DEPLOYED, same rule as 0049 and
-- 0063. The sequence branch in api/cron/lifecycle-emails reads this column in
-- its OWN query and logs-and-skips when that query errors, so a deploy ahead of
-- the migration disables the sequence and cannot take the weekly digests,
-- inactivity nudges, welcome backfill or trial-expiry notice down with it.
--
-- Deliberately NOT reusing `last_trial_email` (0049). That column is the
-- send-once latch for the post-expiry notice and its predicate is
-- `last_trial_email is null` — writing in-trial sends to it would silently
-- suppress the expiry notice for every user who got a day-1 email, which is the
-- exact silence 0049 existed to end.
--
-- Stores the HIGHEST stage sent, not a count and not a flag per stage: the
-- sequence only ever moves forward, and dueTrialStage() picks the highest stage
-- reached so a late user skips to the right message rather than replaying the
-- sequence from the start. NULL means nothing sent yet.
alter table public.profiles
  add column if not exists trial_email_stage smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_trial_email_stage_check'
  ) then
    alter table public.profiles
      add constraint profiles_trial_email_stage_check
      check (trial_email_stage is null or trial_email_stage in (1, 7, 12));
  end if;
end $$;

comment on column public.profiles.trial_email_stage is
  'Highest in-trial email stage sent (1, 7 or 12). NULL = none sent. Distinct from last_trial_email, which is the post-expiry notice latch from 0049.';

-- The branch's predicate is `trial_started_at is not null and trial_ack_at is
-- null`, over accounts still inside a 14-day window — a set that is always
-- small and always draining.
create index if not exists profiles_trial_sequence_idx
  on public.profiles (trial_started_at)
  where trial_ack_at is null and trial_started_at is not null;

-- No column-level grant to `authenticated`, for the reason 0063 gives: this is
-- a send-once ratchet. A user who can write it can replay the sequence to
-- themselves or suppress the day-12 notice. The only writer is the cron's
-- service client. Contrast 0062's intended_source, where the worst a caller
-- could do was misdescribe their own preference.
