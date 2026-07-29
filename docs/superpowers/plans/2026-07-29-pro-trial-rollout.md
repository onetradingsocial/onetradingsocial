# Pro trial rollout checklist

1. [x] Apply `0041_pro_trial.sql` to **dev**; verify the backfill skipped internal
   and subscribed accounts. — DONE 2026-07-29 (backfill updated 0 rows; all 13 dev profiles are is_internal)
2. [ ] Set `TRIAL_WALL_ENABLED=false` in Vercel (production **and** preview) and in
   `app/.env.local` **before** deploying.
3. [ ] Merge and deploy. Verify: `/welcome` renders for new signups, the nav chip
   counts down, and a new user resolves to Pro on `/settings/billing`.
4. [ ] Apply `0041_pro_trial.sql` to **production**.
5. [ ] Re-verify on production with a throwaway account.
6. [ ] Wait until the first cohort is 14 days past signup, then flip
   `TRIAL_WALL_ENABLED=true` in Vercel and redeploy.
7. [ ] Watch signups and churn for a week. The switch reverses instantly if needed.

**Note:** Steps 2, 4 and 6 need a human — they touch production infrastructure. Do not attempt them.

## Known gaps at time of writing

- The live Stripe checkout round trip for the `trial_end` flow has NOT been verified. No Stripe test keys or `stripe listen` forwarder were available. It must be exercised before this ships.
- The Playwright wall tests in `app/tests/e2e/trial.spec.ts` have never been observed passing. Every run so far died in the signup helper because the dev Supabase project's signup email rate limit was already tripped. The tests genuinely failed rather than silently skipping. They need a clean run once the quota resets.
