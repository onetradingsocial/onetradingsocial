-- Persist the answer to onboarding step 5, "How will you add your trades?".
--
-- The step is mandatory — OnboardingForm's step 5 sets `nextDisabled` until one
-- of broker / statement / manual is picked — so every completed onboarding has
-- an answer. Until now that answer was rendered as a tag on the reveal card and
-- fired as an analytics prop (`onboarding_step` step 6, `connect`), and then
-- discarded. It never reached the profile.
--
-- That made it usable only in aggregate. Measured on 2026-08-26 the aggregate
-- was already stark: of 23 real users who answered, 17 said manual (6 of them
-- went on to log a trade) and 6 said broker — of whom none logged a trade, none
-- connected a broker, and one ever opened /settings, where the broker card
-- lives. Six people asked for the product's differentiator and could not be
-- identified afterwards by anything except an analytics query.
--
-- Stored on the row it belongs to, the intent becomes actionable: the lifecycle
-- cron can segment on it, the win-back can address it, and when the MetaApi
-- account is funded the broker cohort can be found and contacted rather than
-- reconstructed.
--
-- Nullable by design. Every user who onboarded before this migration has no
-- answer on their row, and inventing one would be worse than the null — their
-- declared intent lives only in analytics_events and should be read from there
-- if it is ever backfilled. NULL means "never asked", not "declined to say".
alter table public.profiles
  add column if not exists intended_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_intended_source_check'
  ) then
    alter table public.profiles
      add constraint profiles_intended_source_check
      check (intended_source is null or intended_source in ('broker', 'statement', 'manual'));
  end if;
end $$;

comment on column public.profiles.intended_source is
  'Onboarding step 5: how the user said they would add trades (broker|statement|manual). NULL = onboarded before the column existed, or never asked.';

-- saveOnboarding writes profiles with a USER client, so this column needs an
-- explicit column-level UPDATE grant or the write fails — 0042 dropped the
-- blanket grant precisely so that new columns are closed by default.
--
-- Safe to hand to the user: it is a self-declared preference with no
-- entitlement, billing or analytics-integrity consequence. Contrast
-- trial_started_at, comp_tier and is_internal, which 0042 deliberately withheld
-- because a user who can write them can grant themselves Pro or hide from
-- reporting. The worst a caller can do here is misdescribe their own intent.
grant update (intended_source) on public.profiles to authenticated;
