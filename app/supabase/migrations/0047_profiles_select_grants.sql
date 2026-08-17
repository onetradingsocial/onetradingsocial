-- Column-level SELECT grants on public.profiles.
-- Audit item 8, finding F1 (P1). The SELECT half of the job 0042 started.
--
-- THE PROBLEM
--
-- 0042 narrowed UPDATE on this table to a 22-column allow-list and said, in as
-- many words, that "SELECT is deliberately untouched: reads are already
-- governed by the profiles_select policy". That was wrong, and the reason it
-- was wrong is the same reason 0042 itself existed: profiles_select is
-- ROW-level only --
--
--     ((is_public and onboarding_completed) or auth.uid() = id)
--
-- -- and it applies to role {public}. It decides WHICH ROWS a caller may read,
-- never WHICH COLUMNS of them. Supabase's default table-wide grant then handed
-- `anon` SELECT on all 36 columns. Since NEXT_PUBLIC_SUPABASE_ANON_KEY is in
-- every browser bundle by design, one unauthenticated request to
-- /rest/v1/profiles?select=* returned, live, on production:
--
--   * stripe_customer_id  -- 7 live Stripe customer ids. This is the join key
--     the webhook's resolveUserId() maps a subscription back to a user with;
--   * account_balance     -- all 417 public profiles. Next to username and
--     display_name in the same row, that is a downloadable list of retail
--     traders ranked by how much capital they say they have. That is the exact
--     artefact a social-engineering campaign against traders wants, and it
--     needed no account to obtain;
--   * is_internal         -- 392 rows, disclosing which accounts the operator
--     has flagged as staff/seed;
--   * acquisition_source, comp_tier, trial_*, last_*_email, notification_prefs.
--
-- 0037 already got this right on public.exchange_accounts, where api_key_enc /
-- api_secret_enc / passphrase_enc are absent from the SELECT grant for both
-- client roles. This migration applies the same shape here.
--
-- THE HAZARD, AND WHY THIS MIGRATION SHIPS WITH CODE
--
-- PostgREST does not silently omit columns a role cannot read. `select('*')`,
-- and a bare `select()` which defaults to `*`, FAIL OUTRIGHT with 42501 the
-- moment one column is revoked. All 60 reads of public.profiles in app/src were
-- enumerated and classified by client before this file was written. Nine of
-- them touch a revoked column with a user or anon client and are moved to the
-- service client in the same change:
--
--   api/billing/portal/route.ts:14      stripe_customer_id
--   api/billing/checkout/route.ts:61    stripe_customer_id
--   layout.tsx:42                       account_balance, is_internal
--   api/track/route.ts:70               is_internal
--   journal/page.tsx:52                 account_balance
--   actions/trade.ts:33                 account_balance
--   settings/page.tsx:25                account_balance, notification_prefs
--   actions/account.ts:52               select('*') -- the GDPR export
--   actions/trade.ts:221                notification_prefs, via
--                                       insertSystemNotification
--
-- DO NOT APPLY THIS MIGRATION WITHOUT DEPLOYING THAT CODE. Every one of those
-- nine filters on an id taken from getUser()/getSessionUser() server-side, never
-- from a client parameter, so moving them to the service client widens nothing:
-- each still reads exactly one row, the caller's own.
--
-- WHY OWNER-ONLY READS CANNOT BE EXPRESSED AS A GRANT
--
-- A column grant is per-ROLE. There is no `grant select (account_balance) ...
-- where auth.uid() = id`. So "the owner may see their own balance, nobody else
-- may see it" is not something this file can state; it can only be stated by a
-- read path that holds the privilege -- the service client, or a
-- SECURITY DEFINER function. The nine edits above are that path. Leaving the
-- columns granted to `authenticated` instead would have closed only the
-- unauthenticated half of the harvest: a free signup takes under a minute, and
-- the 417-row balance list would still be one request away.
--
-- WHAT IS DELIBERATELY *NOT* REVOKED
--
--   account_currency -- the public profile renders another user's P&L in their
--     own currency ([username]/page.tsx:85, read as anon by a logged-out
--     visitor). Not sensitive on its own, and needed.
--   xp, level        -- public gamification; rendered on the profile and the XP
--     leaderboard.
--   is_public, onboarding_completed, leaderboard_optout, account_type -- these
--     are FILTER columns for the leaderboard, the recommender and the public
--     profile. Postgres requires SELECT privilege on any column named in a
--     user-supplied WHERE clause, not merely in the projection, so revoking one
--     of these would break lib/server/ranking.ts:76-78 and lib/server/xp.ts:124
--     even though neither ever returns them.
--   goal, bio, tagline, cta_* , theme_color, custom_badge, cover_url,
--     pinned_post_id, main_markets, trading_styles, experience_level --
--     user-authored public profile content.
--   updated_at -- nothing reads it; kept because it is a housekeeping column,
--     not user data, and gratuitous revokes are how `select('*')` regressions
--     get introduced later.
--
--   account_balance IS revoked, and that does NOT touch the leaderboard. The
--     derived money figures are not computed from it at read time: saveAccount
--     (actions/account.ts:32-37) rescales risk_amount and pnl_amount and stores
--     them ON public.trades, and every leaderboard metric sums trades.pnl_amount
--     (lib/leaderboard.ts:39-66). No public surface reads profiles.account_balance
--     at all -- all five readers are the owner's own row. The derived value stays
--     public; the raw self-reported capital stops being.
--
-- Idempotent and re-runnable: revoke and grant are both declarative, and
-- re-running simply re-asserts the same end state.

revoke select on public.profiles from anon, authenticated;

grant select (
  id,
  username,
  display_name,
  bio,
  goal,
  avatar_url,
  cover_url,
  tagline,
  experience_level,
  main_markets,
  trading_styles,
  account_type,
  account_currency,
  custom_badge,
  theme_color,
  cta_label,
  cta_url,
  pinned_post_id,
  xp,
  level,
  is_public,
  onboarding_completed,
  leaderboard_optout,
  created_at,
  updated_at
) on public.profiles to anon, authenticated;

-- Both roles get the same 25 columns, which is the point: this is the set that
-- renders a PUBLIC profile, and `authenticated` reading another user's row is
-- doing exactly that. The 11 columns withheld from both roles are
--
--   stripe_customer_id, account_balance, is_internal, acquisition_source,
--   notification_prefs, comp_tier, trial_started_at, trial_ack_at,
--   welcome_tier_seen, last_weekly_email, last_recovery_email
--
-- and every remaining reader of them is already a service-client call:
-- entitlements.ts:50,65,186 (comp_tier, trial_*, welcome_tier_seen),
-- api/stripe/webhook/route.ts:20,55 (stripe_customer_id, trial_*),
-- api/cron/lifecycle-emails/route.ts:27 (last_*_email, notification_prefs),
-- api/stats/route.ts:30, lib/server/{analytics,cohorts,funnel,compare,recommend,
-- referral,suspicion,track}.ts (is_internal, acquisition_source,
-- account_balance) and the /admin pages.
