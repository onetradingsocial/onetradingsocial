-- Two row-level over-shares. Audit item 8, findings F2 and F3.
--
-- ***************************************************************************
-- ** NOT APPLIED. Hand this to the owner and apply it WITH the WS8 deploy.  **
-- ** APPLY THE CODE FIRST, OR AT THE SAME TIME. See "Ordering" below.       **
-- ***************************************************************************
--
-- Item 8 found no cross-account leak anywhere: every private table returned 0
-- rows in both directions and for the anon role. These two are not RLS
-- failures — the policies say `true` and the database honours them faithfully.
-- They are policy DECISIONS that do not match what a user would expect, and
-- the fix is to change the decision.
--
-- ---------------------------------------------------------------------------
-- F2 -- poll_votes are world-readable AND attributable
-- ---------------------------------------------------------------------------
--
-- `poll_votes_select` is `using (true)` for role `{public}`. Live, as `anon`,
-- with no account and no login: 114 vote rows, each carrying `user_id` and the
-- `option_id` chosen. Anyone on the internet can determine exactly how any
-- named trader voted in any poll.
--
-- Users overwhelmingly expect poll votes to be anonymous — it is the near
-- universal convention in social products, and nothing in the UI said
-- otherwise until an audit-driven privacy note was added to the composer. A
-- disclosure is not a substitute for the expectation being met; WS8 changes the
-- behaviour and rewrites that note to match.
--
-- The tallies still have to work. They do, because `hydrateFeedPosts` now reads
-- the aggregate through the SERVICE client and returns only counts per option —
-- no `user_id` reaches the browser for anyone but the viewer themselves. The
-- viewer's own vote is still read under this policy, which is why the policy is
-- narrowed rather than removed.
--
-- ---------------------------------------------------------------------------
-- F3 -- anyone logged in can read anyone's course progress
-- ---------------------------------------------------------------------------
--
-- `lesson_completions_select` is `using (true)` to `{authenticated}`. Live as
-- user A: all 14 rows, including B's.
--
-- The courses feature was WITHDRAWN by migration 0048, which changes the shape
-- of this finding but not the answer. It means there is no product cost to
-- narrowing (nothing renders another user's lesson list, and nothing will), and
-- it means the live exposure is 14 historical rows of a dead feature rather
-- than a growing one. It does NOT mean leaving it: the rows are still there,
-- still attributable, and still readable by every account on the platform, and
-- "which lessons a trader never finished" is nobody else's business. A dead
-- feature's data is exactly the kind that gets left permissive for years.
--
-- Every reader in the codebase is either service-role (`admin/analytics`,
-- `funnel`, `cohorts`, `recommend`, `journal` streaks, `api/stats`) or already
-- scoped `.eq('user_id', <own id>)` (`lib/server/learning.ts`,
-- `actions/learning.ts`, `actions/account.ts` export). Nothing breaks.
--
-- ---------------------------------------------------------------------------
-- Ordering
-- ---------------------------------------------------------------------------
--
-- The application change is SAFE TO DEPLOY FIRST and should be: reading poll
-- tallies through the service client works identically whether or not this
-- migration has been applied. Applying this migration BEFORE the code deploys
-- would show every poll as having zero votes from other users until the deploy
-- lands. Deploy the code, then apply.

begin;

-- F2 ------------------------------------------------------------------------
drop policy if exists poll_votes_select on public.poll_votes;

create policy poll_votes_select on public.poll_votes
  for select
  using ((select auth.uid()) = user_id);

comment on table public.poll_votes is
  'Audit item 8 F2. SELECT is owner-only. Aggregate tallies are computed with '
  'the service client in lib/server/feed-hydration.ts and returned as counts, '
  'never as rows -- do not add a permissive policy here to make a chart work.';

-- F3 ------------------------------------------------------------------------
drop policy if exists lesson_completions_select on public.lesson_completions;

create policy lesson_completions_select on public.lesson_completions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.lesson_completions is
  'Audit item 8 F3. SELECT is owner-only. Aggregate/admin reads go through the '
  'service client. The courses feature was withdrawn in 0048; these rows are '
  'historical.';

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying, against jmpanzrjxflovdfwcbye)
--
--   -- anon must now see nothing at all:
--   begin;
--     set local role anon;
--     select count(*) from public.poll_votes;          -- expect 0 (was 114)
--   rollback;
--
--   -- an authenticated user sees only their own:
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<a real uid>","role":"authenticated"}';
--     select count(*) from public.poll_votes;          -- expect only their own
--     select count(*) from public.lesson_completions;  -- expect only their own
--   rollback;
--
--   -- and the product still works: open /feed and confirm a poll shows the
--   -- same totals it showed before, with the viewer's own choice highlighted.
--
-- ROLLBACK
--
--   drop policy if exists poll_votes_select on public.poll_votes;
--   create policy poll_votes_select on public.poll_votes for select using (true);
--   drop policy if exists lesson_completions_select on public.lesson_completions;
--   create policy lesson_completions_select on public.lesson_completions
--     for select to authenticated using (true);
--
-- No data is destroyed by this migration; it is a visibility change only.
-- ---------------------------------------------------------------------------
