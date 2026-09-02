-- Durable record of what each cron run actually did.
--
-- WHY THIS EXISTS. On 2026-09-01 the first lifecycle run after migrations 0063
-- and 0064 stamped 10 welcome emails and 4 trial-sequence stages. Whether any
-- of them were DELIVERED could not be established a day later: the counters
-- live only in the route's JSON response and the Vercel console, and
-- lib/server/log.ts records that Hobby retains runtime logs for about an hour.
-- The stamps prove selection, not delivery -- deliberately, since both branches
-- stamp whether or not the send succeeded so a missing provider cannot become a
-- nightly loop.
--
-- That is the same silently-green shape this codebase has fixed twice already
-- (the discarded sendEmail() result, the MT5 sync that reported success while
-- doing nothing), reappearing one level up: the run reports honestly, into a
-- place nobody can read by morning.
--
-- APPLY AFTER THE CODE THAT USES IT IS DEPLOYED, per 0049, 0063 and 0064.
-- recordCronRun() swallows its own failure and logs a warning, so a deploy
-- ahead of this migration loses the record and nothing else -- it can never be
-- the reason lifecycle email stops going out.
create table if not exists public.cron_runs (
  id          bigint generated always as identity primary key,
  route       text        not null,
  ran_at      timestamptz not null default now(),
  -- The route's own verdict. False when users were processed but nothing was
  -- delivered, which is the case this table exists to make visible.
  ok          boolean     not null,
  -- Counts of users PROCESSED, per branch. Shape follows the route and is
  -- deliberately schemaless: branches get added (welcomes, trialStageEmails)
  -- and a jsonb column absorbs that without a migration each time.
  processed   jsonb       not null default '{}'::jsonb,
  -- What actually left the building: { delivered, undelivered }.
  delivery    jsonb       not null default '{}'::jsonb,
  -- Failure reason -> count. 'no_provider' means RESEND_API_KEY is unset;
  -- 'resend_4xx'/'resend_5xx' mean the provider refused, which on a domain
  -- whose DKIM/SPF was confirmed 2026-08-28 is the signal worth catching early.
  failures    jsonb       not null default '{}'::jsonb
);

comment on table public.cron_runs is
  'One row per cron execution. Exists because Vercel Hobby retains runtime logs ~1h, so delivery evidence was gone by morning. Read by /admin/analytics.';

create index if not exists cron_runs_route_ran_idx
  on public.cron_runs (route, ran_at desc);

-- No retention job on purpose: two crons at one row each per day is ~730
-- rows/year. Revisit if a route ever writes per-item rows.

-- Service role only. RLS on with NO policies denies anon and authenticated
-- outright; the service client bypasses RLS and is the only writer, and
-- /admin/analytics reads through it behind requireAdmin(). Same posture as the
-- send-once latches in 0063 and 0064 -- there is no reason a user can read or
-- write operational telemetry about other people's mail.
alter table public.cron_runs enable row level security;
revoke all on public.cron_runs from anon, authenticated;
