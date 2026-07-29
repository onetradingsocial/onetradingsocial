-- Column-level UPDATE grants on public.profiles.
--
-- The profiles_update RLS policy (0001, hardened in 0013) is row-level only:
-- `using (auth.uid() = id) with check (auth.uid() = id)`. It decides WHICH ROW a
-- caller may write, never WHICH COLUMNS. Combined with Supabase's default
-- table-level grant to `authenticated`, any logged-in user could PATCH their own
-- row through PostgREST and set any column on it -- including:
--
--   * trial_started_at -- push it into the future for a permanently 'active'
--     14-day Pro trial (effectiveTier grants 'pro' while active);
--   * trial_ack_at     -- self-resolve the end-of-trial wall without answering;
--   * comp_tier        -- grant themselves 'pro' outright (pre-existing since
--     0039, same class of hole, fixed here in the same change);
--   * stripe_customer_id -- point their profile at another user's Stripe
--     customer, which is exactly the key the webhook's resolveUserId() maps a
--     subscription back to a user with;
--   * is_internal      -- hide from analytics and the interviews funnel.
--
-- Fix: drop the blanket UPDATE grant and hand back only the columns the app
-- actually lets a user edit about themselves. Every other column becomes
-- service-role-only (the service role bypasses grants and RLS alike).
--
-- SELECT is deliberately untouched: reads are already governed by the
-- profiles_select policy, and the checkout route still needs to read
-- stripe_customer_id as the user.
--
-- The grant list below is derived from every write to public.profiles made with
-- a USER client (`createClient()` from @/lib/supabase/server); service-client
-- writes are excluded by design:
--
--   app/src/app/actions/profile.ts:50-52   saveOnboarding ->
--       onboardingToRow() (lib/profile.ts:24-26) = username, experience_level,
--       main_markets, trading_styles, goal, is_public, onboarding_completed
--       ... plus account_type
--   app/src/app/actions/profile.ts:168-186 saveProfileSettings -> username,
--       display_name, bio, goal, experience_level, main_markets, trading_styles,
--       account_type, is_public, custom_badge, theme_color, tagline, cta_label,
--       cta_url, pinned_post_id, leaderboard_optout
--   app/src/app/actions/avatar.ts:26       avatar_url
--   app/src/app/actions/cover.ts:35        cover_url
--   app/src/app/actions/account.ts:21      account_balance, account_currency
--   app/src/app/actions/notifications.ts:35 notification_prefs
--
-- Service-client writers, intentionally NOT granted:
--   actions/admin.ts:243                   comp_tier
--   actions/trial.ts:18-22                 trial_ack_at
--   api/stripe/webhook/route.ts            trial_ack_at
--   actions/auth.ts:41-42                  acquisition_source
--   actions/profile.ts:66-68               acquisition_source
--   api/billing/checkout/route.ts:70-74    stripe_customer_id
--   api/cron/lifecycle-emails/route.ts:77,103  last_weekly_email,
--                                              last_recovery_email
-- Never written by application code at all: id, xp, level, created_at,
-- updated_at (trigger), is_internal (migration only), trial_started_at
-- (handle_new_user trigger only).
--
-- Idempotent and re-runnable: revoke and grant are both declarative, and
-- re-running simply re-asserts the same end state.

revoke update on public.profiles from anon, authenticated;

grant update (
  username,
  display_name,
  bio,
  goal,
  avatar_url,
  cover_url,
  experience_level,
  main_markets,
  trading_styles,
  is_public,
  onboarding_completed,
  account_type,
  account_balance,
  account_currency,
  custom_badge,
  theme_color,
  tagline,
  cta_label,
  cta_url,
  pinned_post_id,
  leaderboard_optout,
  notification_prefs
) on public.profiles to authenticated;

-- `anon` gets nothing back: an anonymous caller has no profile row to edit, and
-- profiles_update would reject the write anyway (auth.uid() is null).
