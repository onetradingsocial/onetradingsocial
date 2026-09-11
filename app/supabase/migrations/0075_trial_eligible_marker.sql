-- An explicit marker for "this account is entitled to a 14-day Pro trial on its
-- first session", so the trial latch can run on EVERY route by which a session
-- first appears without arming a trial for the accounts 0041 deliberately
-- skipped.
--
-- MUST BE APPLIED BY HAND TO BOTH PROJECTS:
--   production  jmpanzrjxflovdfwcbye
--   dev         sixixwutvrguqemqzvvw
--
-- ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
--
-- 0074 made the application the only writer of trial_started_at, at three entry
-- points (signUp with a session, /auth/confirm, /auth/callback). GoTrue confirms
-- the email inside its own /verify endpoint BEFORE redirecting to
-- /auth/confirm, so when the code exchange there fails — a confirmation email
-- opened on a different device from the signup, which lacks the PKCE verifier
-- cookie — the account ends up confirmed, sessionless and trial-less. Its first
-- session then arrives by password sign-in, a reset, or a Google sign-in on a
-- no-longer-fresh account, none of which was an entry point. It stays on Free
-- forever and nothing is logged.
--
-- The application now also starts the trial at a chokepoint that sees every
-- authenticated render (getEntitlements → trialStartForSession). A chokepoint
-- sees logins, so "trial_started_at is null" cannot be its gate: 417 production
-- rows are null ON PURPOSE (0041's backfill skipped internal/seed accounts and
-- live subscribers). This column is the gate. The latch's UPDATE requires
-- `trial_eligible = true` for every caller, so a row this migration leaves
-- false cannot be stamped by any code path.
--
-- ── WHAT IT DOES ─────────────────────────────────────────────────────────────
--
--   1. Adds the column `false` for every row that exists now. Every pre-0074
--      account without a trial — the skipped cohort — is therefore ineligible
--      by construction, not by a date comparison.
--   2. Sets the column DEFAULT to `true`. Every profile row inserted from here
--      on is eligible, whoever inserts it, so handle_new_user() is NOT replaced
--      and its display_name / avatar_url capture (0008, warned about in 0041
--      and 0074) is not put at risk.
--   3. Marks as eligible the accounts created AFTER 0074 that are still
--      unstarted — the ones this bug has already stranded (production: 3 at the
--      time of writing, one of them confirmed with no session; dev: 3). See the
--      backfill block for why it cannot reach the skipped cohort.
--
-- ── DEPLOY ORDER ─────────────────────────────────────────────────────────────
--
-- CODE FIRST, THEN THIS MIGRATION (the convention of 0063-0065 and 0074).
--
--   * Code without this migration is today's behaviour exactly. The entry
--     points' marker-filtered write fails with 42703, and they fall back to the
--     pre-0075 write (logging that 0075 is missing, so a forgotten migration is
--     loud). The chokepoint's marker read fails the same way and it stays off.
--   * The instant this lands, new rows default to eligible, the stranded rows
--     are marked, and both the entry points and the chokepoint are live.
--
-- There is no window in which an eligible new account gets no trial: before
-- the migration the entry points behave as they did yesterday, after it every
-- first session is covered. (The reverse order is also safe — the column is
-- additive and old code never reads it — but it is not the convention and buys
-- nothing.)
--
-- Wrapped in one transaction: ADD COLUMN takes an ACCESS EXCLUSIVE lock held to
-- COMMIT, so no signup can insert between step 1 (default false) and step 2
-- (default true) and be born ineligible.

begin;

alter table public.profiles
  add column if not exists trial_eligible boolean not null default false;

alter table public.profiles
  alter column trial_eligible set default true;

comment on column public.profiles.trial_eligible is
  'May this account''s 14-day Pro trial be started on its first session? Defaults TRUE for every row created from 0075 on; FALSE for every row that existed before it, which is what keeps the cohort 0041 deliberately skipped (internal/seed accounts, then-live subscribers) off the trial permanently. The latch (lib/server/trial-start.ts) writes trial_started_at only where this is true. Set it false when creating an account that must never be trialled (e.g. a new seed persona). Service-role only.';

-- Service-role only, like trial_started_at (0042) and every trial column: a
-- user who could set this on an old account could hand themselves a trial.
-- 0042/0047 replaced the table-wide grants with column lists, so a new column
-- is already ungranted; this makes the intent explicit and re-asserts it.
revoke select (trial_eligible), update (trial_eligible) on public.profiles from anon, authenticated;

-- ── BACKFILL: accounts 0074 has already stranded ─────────────────────────────
--
-- Eligible = no trial AND created after 0074 was applied. That cutoff differs
-- per project (production 2026-09-10 08:04:33 UTC, dev 08:04:56 UTC) and is not
-- hardcoded: it is read from THIS database's own migration history.
--
-- Two independent bounds, both required, both fail CLOSED (a null bound makes
-- the predicate null and marks nothing):
--
--   (a) created_at >= the time 0074 was recorded in
--       supabase_migrations.schema_migrations. Accepted only in the 14-digit
--       UTC form apply_migration writes; anything else (a local `db reset`,
--       where the version is '0074') yields no cutoff rather than a bogus one.
--   (b) created_at > the newest row the OLD trigger stamped. Between 0041 and
--       0074 the trigger wrote trial_started_at = now() in the same INSERT that
--       defaulted created_at = now(), so trigger-stamped rows have the two
--       exactly equal (the application latch never can — it writes later).
--       Every skipped-cohort row predates 0041 and therefore predates every
--       trigger-stamped row. This bound alone excludes the whole cohort.
--
-- Verified read-only before writing this, on both projects: every null-trial
-- row created before 0074 is from July or earlier (latest 2026-07-16 prod,
-- 2026-07-23 dev), the last trigger-stamped signup precedes 0074 (2026-09-08
-- prod, 2026-08-21 dev), and every row after 0074 is null-trial.
--
-- Deliberately NOT filtered on is_internal: eligibility follows when the
-- account was created, as the three entry points always have. A post-0074 test
-- account someone later flagged internal (dev's 5ce16331) is exactly the
-- account this bug stranded.

do $$
declare
  cut_0074 timestamptz;
  last_trigger_stamp timestamptz;
  marked integer := 0;
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute $q$
      select to_timestamp(version, 'YYYYMMDDHH24MISS')::timestamp at time zone 'UTC'
        from supabase_migrations.schema_migrations
       where name like '%trial_starts_at_confirmation'
         and version ~ '^[0-9]{14}$'
       order by version
       limit 1
    $q$ into cut_0074;
  end if;

  select max(created_at) into last_trigger_stamp
    from public.profiles
   where trial_started_at = created_at;

  if cut_0074 is null or last_trigger_stamp is null then
    raise notice '0075: no backfill (0074 cutoff %, last trigger-stamped signup %) — new accounts are still eligible by default',
      cut_0074, last_trigger_stamp;
    return;
  end if;

  update public.profiles
     set trial_eligible = true
   where trial_started_at is null
     and created_at >= cut_0074
     and created_at > last_trigger_stamp;
  get diagnostics marked = row_count;

  raise notice '0075: marked % post-0074 unstarted account(s) trial-eligible (0074 applied %, last trigger-stamped signup %)',
    marked, cut_0074, last_trigger_stamp;
end $$;

commit;

-- ── VERIFY AFTER APPLYING, ON EACH PROJECT ───────────────────────────────────
--
--   select column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'profiles'
--      and column_name = 'trial_eligible';                         -- true
--
--   select count(*) filter (where trial_eligible)                  as eligible,
--          count(*) filter (where trial_eligible and trial_started_at is not null) as eligible_started,
--          count(*) filter (where not trial_eligible and trial_started_at is null) as skipped_cohort
--     from public.profiles;
--   -- eligible = the post-0074 accounts (3 and 3 at the time of writing);
--   -- skipped_cohort = the pre-0074 null rows (417 production, 13 dev).
--
--   -- MUST return zero rows: nothing that existed before 0074 is eligible.
--   select id from public.profiles p, supabase_migrations.schema_migrations m
--    where m.name like '%trial_starts_at_confirmation'
--      and p.trial_eligible
--      and p.created_at < to_timestamp(m.version, 'YYYYMMDDHH24MISS')::timestamp at time zone 'UTC';
