-- The first-trade email, and the latch that makes it send exactly once.
--
-- APPLY THIS *AFTER* THE CODE THAT USES IT IS DEPLOYED, same as 0063. The code
-- is written to be inert without it: sendFirstTradeEmail claims this column
-- BEFORE it sends and treats a failed claim (42703, unknown column) as "do not
-- send". So a deploy that lands ahead of this migration sends no first-trade
-- mail at all, rather than one on every trade the user logs while `count = 1`
-- keeps being true -- which, since a user can delete their only trade and log
-- another, is a state reachable more than once.
--
-- NULL means "never congratulated", which is the only state the sender acts on.
alter table public.profiles
  add column if not exists first_trade_email_at timestamptz;

comment on column public.profiles.first_trade_email_at is
  'When the first-logged-trade email was sent. NULL = never sent; the only state sendFirstTradeEmail acts on.';

-- No partial index to match 0063's. That one exists for the lifecycle cron's
-- backfill branch, which scans every un-welcomed profile on a schedule. This
-- column has no backfill and no scanner: its only reader is a lookup by
-- primary key on the one user who just logged a trade.

-- Deliberately NO column-level grant to `authenticated`, for 0063's reason: a
-- send-once latch a user can write is a latch a user can null to re-trigger
-- mail to themselves, or set to suppress mail they should get. The only writer
-- is the service client.
