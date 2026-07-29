-- 14-day free Pro trial. No Stripe object exists for a trial — these two
-- timestamps are the whole state. NULL trial_started_at means "never on a
-- trial", which is also the fail-open value: such a user is never walled.
alter table public.profiles
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ack_at     timestamptz;

comment on column public.profiles.trial_started_at is
  '14-day free Pro trial start. NULL = never on a trial (never walled).';
comment on column public.profiles.trial_ack_at is
  'When the user answered the end-of-trial modal (Continue on Free, or first paid subscription).';

-- New signups start their trial at account creation.
--
-- CRITICAL: this replaces the trigger as it stands after 0008_google_avatar.sql,
-- NOT the original 0001_profiles.sql version. 0008 added display_name and
-- avatar_url capture from OAuth metadata — dropping those columns here would
-- silently break Google sign-up. The body below is 0008's, with
-- trial_started_at added. Verified against the live definition on dev.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uname text;
begin
  uname := coalesce(
    new.raw_user_meta_data->>'username',
    'user_' || substr(new.id::text, 1, 8)
  );
  insert into public.profiles (id, username, display_name, avatar_url, trial_started_at)
  values (
    new.id,
    uname,
    new.raw_user_meta_data->>'full_name',
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    ),
    now()
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Backfill existing users. Deliberately skipped:
--   * internal/seed accounts — the demo users and the 3-hourly activity
--     routine must keep working untouched;
--   * anyone with a live subscription — they never had a trial, so if they
--     churn later they must not be walled for one.
update public.profiles p set trial_started_at = now()
where p.trial_started_at is null
  and coalesce(p.is_internal, false) = false
  and not exists (
    select 1 from public.subscriptions s
    where s.user_id = p.id and s.status in ('active', 'trialing')
  );
