-- Feature flags: admin-togglable per-tier overrides of the static
-- FEATURE_MIN_TIER matrix in app/src/lib/entitlements.ts.
-- Code registry stays the source of truth for WHICH features exist;
-- this table stores per-tier on/off overrides.

create table if not exists public.feature_flags (
  feature    text primary key,   -- matches Feature keys in entitlements.ts
  free       boolean not null,
  trader     boolean not null,
  pro        boolean not null,
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;
-- Signed-in users read; NO insert/update/delete policy -> service role only
-- (admin server actions gate on requireAdmin()).
drop policy if exists feature_flags_select on public.feature_flags;
create policy feature_flags_select on public.feature_flags
  for select to authenticated using (true);

drop trigger if exists feature_flags_touch_updated_at on public.feature_flags;
create trigger feature_flags_touch_updated_at
  before update on public.feature_flags
  for each row execute function public.touch_updated_at();

-- Seed from the static defaults (FEATURE_MIN_TIER as of this migration).
-- min_tier 'trader' -> free=f, trader=t, pro=t
-- min_tier 'pro'    -> free=f, trader=f, pro=t
insert into public.feature_flags (feature, free, trader, pro) values
  ('journal_unlimited',            false, true,  true),
  ('advanced_stats',               false, true,  true),
  ('learning_intermediate',        false, true,  true),
  ('saved_traders',                false, true,  true),
  ('strategy_tracking',            false, true,  true),
  ('mistake_tagging',              false, true,  true),
  ('risk_tracking',                false, true,  true),
  ('private_notes',                false, true,  true),
  ('weekly_review',                false, true,  true),
  ('advanced_leaderboard_filters', false, true,  true),
  ('xp_boosts',                    false, true,  true),
  ('export_journal',               false, true,  true),
  ('premium_courses',              false, false, true),
  ('pro_badge',                    false, false, true),
  ('creator_profile',              false, false, true),
  ('custom_templates',             false, false, true),
  ('strategy_breakdown',           false, false, true),
  ('advanced_reporting',           false, false, true),
  ('monthly_report',               false, false, true),
  ('ai_insights',                  false, false, true),
  ('leaderboard_placement',        false, false, true),
  ('premium_challenges',           false, false, true),
  ('priority_support',             false, false, true),
  ('early_access',                 false, false, true)
on conflict (feature) do nothing;
