-- Persist the trial window on the subscription mirror.
--
-- APPLY THIS BEFORE MERGING. ⚠ ORDERING IS THE OPPOSITE OF 0074/0075. ⚠
--
-- The convention 0063, 0064, 0065, 0074 and 0075 follow is code-first: the
-- application ships, degrades gracefully, and the migration lands after. That
-- works when the new column is only ever READ. These two are WRITTEN, by
-- `subscriptionRow()` on the hot path of the Stripe webhook, so code-first
-- inverts the failure:
--
--   migration first  → the columns sit unused until the deploy. Harmless.
--   code first       → every upsert names a column PostgREST cannot see, the
--                      mirror write fails, the webhook throws, Stripe gets a
--                      500 and retries every billing event indefinitely.
--
-- Deploys are automatic on merge and migrations are not, so: apply to BOTH
-- projects, confirm with the verification query at the bottom, and only then
-- merge.
--
--   production  jmpanzrjxflovdfwcbye
--   dev         sixixwutvrguqemqzvvw
--
-- ── WHY THE MIRROR NEEDS THIS AT ALL ─────────────────────────────────────────
--
-- The advertised 14-day trial is moving onto Stripe, so `subscriptions` becomes
-- the only record of when a trial started and when it ends. Today the table
-- cannot express that. It carries `current_period_end`, which for a `trialing`
-- subscription happens to equal `trial_end` — but the moment the trial converts,
-- Stripe advances the period to the next billing date and the trial boundary is
-- gone forever. There is no state left meaning "the 14 days elapsed on date X":
-- a converted row is `active`, and a failed one is `past_due` or `canceled`.
--
-- Concretely, without these columns:
--
--   * the trial-expiry notice in api/cron/lifecycle-emails cannot be re-keyed
--     off profiles.trial_started_at at all — it has nothing to measure from;
--   * settings/billing cannot tell a trialist what date they will be charged;
--   * `subscriptionGrantsTier` cannot distinguish a renewal that failed from a
--     TRIAL CONVERSION that failed, which is what currently grants 14 days of
--     past_due grace to an account that has never paid us anything (14 trial
--     days + 14 grace days = 28 free days on a declined card). Fixing that is a
--     separate change; this migration is its precondition.
--
-- Stripe already hands both values over on every subscription payload, and
-- `trial_end` is ALREADY read by `trialEnding()` in lib/billing-webhook.ts. It
-- has simply never been persisted.
--
-- ── NULLABLE, AND BACKFILLED ONLY BY STRIPE ──────────────────────────────────
--
-- Both columns are nullable with no default: NULL means "this subscription has
-- no trial", which is the right answer for every ordinary purchase and is also
-- the correct answer for existing rows until Stripe next tells us otherwise.
-- No backfill here on purpose — the reconciliation cron (lib/server/
-- billing-reconcile.ts) walks every Stripe subscription and will populate them
-- on its next pass, from the authoritative source rather than from a guess.
--
-- Note this means `mirrorNeedsRepair` will see a difference on the first pass
-- after deploy and rewrite each row once. That is a real write, so it bumps
-- `updated_at` and therefore restarts the past_due grace clock — for the one
-- production row, which is `canceled` and gets no grace either way. Worth
-- knowing rather than worth preventing.

alter table public.subscriptions
  add column if not exists trial_start timestamptz,
  add column if not exists trial_end   timestamptz;

comment on column public.subscriptions.trial_start is
  'Stripe subscription.trial_start. NULL = this subscription never had a trial.';
comment on column public.subscriptions.trial_end is
  'Stripe subscription.trial_end — when the trial converts or lapses. NULL = no trial. Distinct from current_period_end, which advances past it on conversion.';

-- Finding the trials that are running right now, and the ones that ended
-- without converting, are both cron-path queries (lifecycle emails, and the
-- admin Trialing bucket). Partial index: only rows that have a trial at all.
create index if not exists subscriptions_trial_end_idx
  on public.subscriptions (trial_end)
  where trial_end is not null;

-- RLS is unchanged. 0009 gives `authenticated` SELECT on their own rows and no
-- insert/update/delete policy at all, so these columns are service-role-write
-- like every other column here, and readable by the owner like every other one.

-- ── VERIFY (expect two rows: trial_end, trial_start — both timestamptz, YES) ──
--
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'subscriptions'
--   and column_name in ('trial_start', 'trial_end')
-- order by column_name;
