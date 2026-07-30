-- Tier welcome popup state. Records the last tier we have celebrated for this
-- user, so the popup fires once after onboarding and again on every tier
-- change. NULL means "never celebrated" -> the popup is due.
alter table public.profiles
  add column if not exists welcome_tier_seen text;

comment on column public.profiles.welcome_tier_seen is
  'Last subscription tier celebrated by the welcome popup (free|trader|pro). NULL = never shown.';

-- Deliberately NOT added to the column-level UPDATE grant from 0042: this is
-- written only by ackWelcome() through the service client, exactly like
-- trial_ack_at. A user with a direct PostgREST grant could not do real harm
-- here, but the 0042 doctrine is that `authenticated` gets only the columns the
-- app writes with a USER client, and this is not one of them.

-- BACKFILL. Without this, every existing user's NULL fails to match their
-- current tier and the whole userbase gets a popup on their next page load.
--
-- Mirrors effectiveTier() in app/src/lib/entitlements.ts: the highest of
-- (comp grant, active/trialing Stripe subscription, active 14-day trial).
-- Ranked numerically because SQL has no tier ordering: pro=2, trader=1, free=0.
--
-- Rows with onboarding_completed <> true are left NULL on purpose, so a user
-- who is still mid-onboarding still gets their popup when they finish.
-- `onboarding_completed = true` also excludes NULLs, which is the behaviour we
-- want (NULL = not yet onboarded).
--
-- Known gap: the ADMIN_EMAILS override lives in env, not SQL, so an admin whose
-- stored tier ranks below the 'pro' the app computes will see the Pro popup
-- once. Accepted -- admin accounts only, and it self-corrects on dismissal.
with eff as (
  select
    p.id,
    greatest(
      case p.comp_tier when 'pro' then 2 when 'trader' then 1 else 0 end,
      coalesce((
        select max(case s.tier when 'pro' then 2 when 'trader' then 1 else 0 end)
        from public.subscriptions s
        where s.user_id = p.id
          and s.status in ('active', 'trialing')
      ), 0),
      case
        when p.trial_started_at is not null
         and p.trial_ack_at is null
         and p.trial_started_at > now() - interval '14 days'
        then 2 else 0
      end
    ) as rank
  from public.profiles p
  where p.onboarding_completed = true
    and p.welcome_tier_seen is null
)
update public.profiles p
set welcome_tier_seen = case eff.rank when 2 then 'pro' when 1 then 'trader' else 'free' end
from eff
where eff.id = p.id;
