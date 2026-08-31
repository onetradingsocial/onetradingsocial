-- The day-0 email, and the throttle that makes it send exactly once.
--
-- APPLY THIS *AFTER* THE CODE THAT USES IT IS DEPLOYED, same as 0049. The code
-- is written to be inert without it: sendWelcomeEmail stamps this column BEFORE
-- it sends, and treats a failed stamp (42703, unknown column) as "do not send".
-- So a deploy that lands ahead of this migration sends no welcome mail at all
-- rather than sending one per attempt, and starts working on the next signup
-- once the column exists. Nothing else in the lifecycle cron depends on it —
-- the backfill branch reads it in its OWN query for the reason the trial notice
-- documents, so a missing column cannot take the digests or nudges down.
--
-- NULL means "never welcomed", which is the only state either sender acts on.
alter table public.profiles
  add column if not exists welcome_email_at timestamptz;

comment on column public.profiles.welcome_email_at is
  'When the day-0 welcome email was sent. NULL = never sent; the only state sendWelcomeEmail acts on.';

-- The backfill predicate is exactly `welcome_email_at is null`, over a set that
-- shrinks to nothing as accounts are welcomed, so the partial index stays small
-- and the branch stops costing anything once it has drained.
create index if not exists profiles_welcome_pending_idx
  on public.profiles (created_at)
  where welcome_email_at is null;

-- Deliberately NO column-level grant to `authenticated`. Contrast 0062, which
-- granted update on intended_source because the worst a caller could do was
-- misdescribe their own intent. This one is a send-once latch: a user who can
-- write it can null it and re-trigger mail to themselves, or set it and
-- suppress a mail they should get. Both writers here are the service client.
