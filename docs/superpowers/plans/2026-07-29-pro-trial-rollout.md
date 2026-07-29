# Pro trial rollout checklist

1. [x] Apply `0041_pro_trial.sql` to **dev**; verify the backfill skipped internal
   and subscribed accounts. — DONE 2026-07-29 (backfill updated 0 rows; all 13 dev profiles are is_internal)
2. [x] Set `TRIAL_WALL_ENABLED` in Vercel (production **and** preview) and in
   `app/.env.local`. — DONE 2026-07-29, set to `true` for Production and Preview.
   Takes effect on the next deploy; Vercel does not apply env changes to a
   running deployment.
3. [x] Merge and deploy. — DONE 2026-07-29, merged to `main` and pushed
   (`ec6cbc4..cc422f4`, 21 commits).
4. [x] Apply `0041_pro_trial.sql` to **production**. — DONE 2026-07-29.
   Backfill started trials for **31 real users**; 417 profiles skipped as
   `is_internal` (accumulated @tradingsocial.io e2e + disposable-mail signups)
   and 1 skipped as an active subscriber. First expiry: **2026-08-12 04:13 UTC**.
5. [x] Apply `0042_profiles_column_grants.sql` to **production** — must come
   AFTER step 3, because the pre-deploy code wrote `stripe_customer_id` with the
   user client. — DONE 2026-07-29. 22 columns granted; `trial_started_at`,
   `trial_ack_at`, `comp_tier`, `stripe_customer_id` and `is_internal` all
   correctly excluded.
6. [ ] Deploy once more so `TRIAL_WALL_ENABLED=true` actually takes effect. Until
   a deploy happens, the wall does NOT render — trials simply expire to Free.
7. [ ] Watch signups and churn for a week. The switch reverses by unsetting the
   variable and redeploying.

**Note:** steps that touch production infrastructure need a human. Do not attempt them unattended.

## Verification status

- **Live Stripe round trip for `flow: 'trial_end'` — VERIFIED 2026-07-29.** Real
  test-mode checkout from the wall: webhook delivered `200`, `subscriptions` row
  created (`tier=trader`, `status=active`, correct `price_id`, renewal
  2026-08-29), `trial_ack_at` stamped, existing Stripe customer reused with no
  duplicate, wall cleared, and `/settings/billing` rendered the Trader plan.
- **Playwright wall tests in `app/tests/e2e/trial.spec.ts` — STILL NEVER PASSED.**
  Three attempts, all died in the signup helper on the dev Supabase project's
  signup email rate limit (~2 signups/hour). The tests genuinely failed rather
  than silently skipping. Fix: switch the spec's signup step to the service-role
  admin API so it stops depending on confirmation emails.

## Gotchas found the hard way

- `stripe listen` forwards only events created **while it is running**, and it
  uses the account the CLI is logged into — which was NOT the account holding
  this app's `STRIPE_SECRET_KEY`. Symptom: checkout succeeds, zero webhooks
  arrive, no error anywhere. Run it as
  `stripe listen --api-key <STRIPE_SECRET_KEY> --forward-to localhost:3000/api/stripe/webhook`
  and paste the printed `whsec_` into `.env.local`, which changes per account.
- Never run `npm run build` while the dev server is live; it overwrites `.next`
  and the running server starts throwing `__webpack_modules__[moduleId] is not a
  function` until you clear it and restart.
- `npm run lint` is unusable here — `next lint` is unconfigured and opens an
  interactive setup wizard.
