-- The 14-day Pro trial now starts when the account is first CONFIRMED, not
-- when the row is created. This migration removes the trigger's stamp; the
-- application becomes the only writer of trial_started_at.
--
-- ── APPLY THIS *AFTER* THE CODE THAT REPLACES IT IS DEPLOYED ─────────────────
--
-- Same rule as 0049, 0063, 0064 and 0065, and here it is not a nicety: the
-- ordering is the entire safety argument.
--
--   * Code first, migration second. `startTrialIfUnstarted`
--     (app/src/lib/server/trial-start.ts) writes only where trial_started_at is
--     null, so while this trigger is still stamping at INSERT every call finds
--     the value already set and does nothing. The deployed code is a no-op, and
--     new accounts keep getting a trial from the trigger exactly as before.
--   * The instant this migration lands, the trigger stops stamping and the
--     three application entry points — `signUp` (confirmation off),
--     `/auth/confirm` (confirmation on) and `/auth/callback` (Google) — become
--     the writers. They are already deployed, so there is no window in which a
--     new account gets no trial.
--
-- Doing it the other way round inverts that: this migration alone, ahead of the
-- code, means every account created in the gap silently lands on Free. Nothing
-- throws, nothing 500s, and the only evidence is a conversion number weeks
-- later. That is the failure this ordering exists to make impossible.
--
-- ── EXISTING USERS ARE NOT TOUCHED ───────────────────────────────────────────
--
-- No backfill, no UPDATE, no rewrite. Every trial already running keeps the
-- start it has; the application latch cannot move a non-null value. The cohort
-- 0041's backfill deliberately skipped — internal/seed accounts and users who
-- held a live subscription then — stays null, and the call sites (an
-- account-freshness test on the OAuth path, an OTP-type test on the confirm
-- path) keep it that way so a demo account is never walled and a churned
-- subscriber is never re-walled.
--
-- trial_ack_at (0041), last_trial_email (0049) and trial_email_stage (0064)
-- keep their current meanings and are untouched. The in-trial email sequence
-- keys off trial_started_at, so its days 1/7/12 shift with the trial — that is
-- the intended consequence, not drift to compensate for.
--
-- ── THE FUNCTION BODY BELOW ──────────────────────────────────────────────────
--
-- CRITICAL, and the same warning 0041 carried: this replaces the trigger as it
-- stands after 0041, which is 0008_google_avatar.sql's body plus the trial
-- stamp. display_name and avatar_url capture from OAuth metadata MUST stay or
-- Google sign-up silently loses both. The body below is 0041's with
-- trial_started_at — and only trial_started_at — removed from the column list
-- and the values list.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uname text;
begin
  uname := coalesce(
    new.raw_user_meta_data->>'username',
    'user_' || substr(new.id::text, 1, 8)
  );
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    uname,
    new.raw_user_meta_data->>'full_name',
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    )
  )
  on conflict (id) do nothing;
  return new;
end $$;

comment on column public.profiles.trial_started_at is
  '14-day free Pro trial start. NULL = never on a trial (never walled). Written ONCE by startTrialIfUnstarted (lib/server/trial-start.ts) at the first moment the account has a session — i.e. at confirmation. Set by the signup trigger before 0074.';

-- No grant to `authenticated`, unchanged from 0042: a user who can write this
-- column can push it into the future for a permanently active trial. The only
-- writers are service-client calls.
