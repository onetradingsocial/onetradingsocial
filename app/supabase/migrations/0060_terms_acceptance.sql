-- Record that a user accepted the Terms. Audit item 5, findings 2 and 5 (P1).
--
-- ***************************************************************************
-- ** NOT APPLIED. Hand this to the owner. The application code that writes  **
-- ** these columns is SAFE TO DEPLOY FIRST and is inert until this lands.   **
-- ***************************************************************************
--
-- THE PROBLEM
--
-- Money is charged, a worldwide content licence is taken, and a financial
-- disclaimer is relied upon -- and nothing anywhere recorded that any user ever
-- agreed to any of it. `terms_accept|accepted_terms|tos_|agreed_at` returned
-- zero matches across every migration and all of `app/src`.
--
-- The email path already ENFORCED the consent: `actions/auth.ts` refuses a
-- signup whose `terms` checkbox is absent, so the act genuinely happened -- it
-- simply left no trace. The Google path shows `OAuthLegalNotice` (WS6) and
-- recorded nothing either. In both cases, if a user later disputed the content
-- licence or the liability limitation, there was no answer to "prove they
-- agreed, and prove what they agreed to".
--
-- ---------------------------------------------------------------------------
-- THE THREE COLUMNS
-- ---------------------------------------------------------------------------
--
-- terms_accepted_at       WHEN.  Nothing subtle here.
--
-- terms_accepted_version  WHAT.  A timestamp alone is weak evidence, because
--   the documents move: terms.html was rewritten twice in the week before this
--   migration was written. The value is built by `lib/legal-versions.ts` and
--   reads, today,
--
--       terms=2026-08-18,privacy=2026-08-18,disclaimer=2026-06-24
--
--   -- the `Last updated` date each document publishes about itself, for the
--   three documents both consent surfaces actually name. It is a text column
--   and not jsonb because this is evidence before it is data: it has to be
--   legible on its face to someone who is not a developer. `like
--   '%terms=2026-08-18%'` answers the one query anyone will run against it.
--   The scheme's freshness is guarded by a hash tripwire in
--   tests/unit/terms-acceptance.test.ts -- see the comment block in
--   lib/legal-versions.ts for why a build-time hash was rejected.
--
-- terms_accepted_via      HOW.  The two paths are not evidentially equal and a
--   boolean would flatten them exactly when the difference matters:
--
--     'signup_checkbox' -- express consent. An unticked box blocks the submit
--       button client-side and is re-checked server-side, so the account cannot
--       exist without a positive act aimed at the consent itself.
--     'oauth_notice'    -- passive consent. The user was shown a notice naming
--       and linking all three documents, directly beneath the Google button,
--       and pressed the button. Acceptable in Australia; inferred from conduct
--       rather than performed, and weighed accordingly.
--
--   Adding a value here means adding it to `TERMS_MECHANISMS` in
--   lib/terms-acceptance.ts and to the CHECK below, in the same change.
--
-- ---------------------------------------------------------------------------
-- EXISTING USERS -- READ THIS BEFORE WRITING ANY BACKFILL
-- ---------------------------------------------------------------------------
--
-- There are ~457 accounts and this migration writes an acceptance for exactly
-- none of them. That is the point, not an omission.
--
-- Stamping "accepted" onto a row for someone who was never shown a record would
-- be manufacturing evidence, and manufactured evidence is worse than none: it
-- converts an admitted gap into a false assertion, and the first time it is
-- tested it discredits the records that ARE real. NULL here means UNKNOWN. It
-- does not mean declined and it does not mean accepted, and no code may read it
-- as either -- nothing gates on these columns and nothing should start to
-- without a decision that is made deliberately and written down.
--
-- Two things do happen on their own, honestly:
--   * every account created after the code deploys gets a real record;
--   * a pre-existing Google user gets one the next time they sign in, because
--     they pass `OAuthLegalNotice` on the way (auth/callback/route.ts). That is
--     contemporaneous, not retrospective -- the timestamp is the day they saw
--     it, and the row does not claim they accepted at signup.
--
-- To obtain acceptance from the remaining email-path users the owner has to ASK
-- them. The workable version is an interstitial on next sign-in: show the three
-- documents with a ticked-to-continue control, write 'signup_checkbox' (or a
-- new 'reconsent_interstitial' value), and count the null population down. An
-- emailed "by continuing to use TradingSocial you accept" is materially weaker
-- and should not be recorded as an acceptance at all. Either way it is a
-- product decision with a UX cost, so it is written up rather than assumed.
--
-- ---------------------------------------------------------------------------
-- GRANTS
-- ---------------------------------------------------------------------------
--
-- None. 0042 and 0047 replaced the blanket table grants on public.profiles with
-- column allow-lists, and a column absent from both lists is service-role-only
-- by construction -- which is what these are. They are written by the service
-- client in lib/server/terms-acceptance.ts and read by nothing in the product.
--
-- Do NOT add them to the SELECT allow-list to render a badge somewhere. If an
-- admin surface needs them later it reads them the way every other admin read
-- works, through the service client.
--
-- The user-facing data export (actions/account.ts) does `select('*')` through
-- the service client, so a user's own acceptance record appears in their export
-- automatically the moment this is applied. That is correct: it is personal
-- information we hold about them, and APP 12 says they may have it.
--
-- Idempotent and re-runnable.

begin;

alter table public.profiles
  add column if not exists terms_accepted_at      timestamptz,
  add column if not exists terms_accepted_version text,
  add column if not exists terms_accepted_via     text;

-- The mechanism is a closed set. An unrecognised value would be a record whose
-- evidential weight nobody can assess, which is the whole failure being fixed.
alter table public.profiles
  drop constraint if exists profiles_terms_accepted_via_check;
alter table public.profiles
  add constraint profiles_terms_accepted_via_check
  check (
    terms_accepted_via is null
    or terms_accepted_via in ('signup_checkbox', 'oauth_notice')
  );

-- All three, or none. A timestamp with no version proves that something
-- happened without proving what -- the original finding, restated one column to
-- the left. This blocks it at the database, so neither the application nor a
-- future one-off script can write half a record.
alter table public.profiles
  drop constraint if exists profiles_terms_acceptance_complete;
alter table public.profiles
  add constraint profiles_terms_acceptance_complete
  check (
    num_nonnulls(terms_accepted_at, terms_accepted_version, terms_accepted_via)
      in (0, 3)
  );

comment on column public.profiles.terms_accepted_at is
  'Audit item 5 F5. When this user accepted the Terms, Privacy Policy and '
  'financial disclaimer. NULL means UNKNOWN -- never treat it as declined or '
  'as accepted. Write-once: lib/server/terms-acceptance.ts filters on IS NULL '
  'so the first acceptance is never overwritten. Do NOT backfill.';

comment on column public.profiles.terms_accepted_version is
  'Which versions were accepted, e.g. '
  '"terms=2026-08-18,privacy=2026-08-18,disclaimer=2026-06-24". Built by '
  'lib/legal-versions.ts from each document''s own "Last updated" date; a test '
  'hashes the document bodies so the dates cannot silently go stale.';

comment on column public.profiles.terms_accepted_via is
  'How consent was given: signup_checkbox (express -- a ticked box that blocked '
  'the submit) or oauth_notice (passive -- a visible notice beneath the Google '
  'button, acted on). Recorded because the two are not equally strong evidence.';

commit;

-- No index. At ~457 rows and a few hundred more a year, "who has not accepted"
-- is a seq scan measured in microseconds; a partial index here would be
-- decoration. Add `create index ... on public.profiles (terms_accepted_at)
-- where terms_accepted_at is null` if a re-consent campaign ever queries it in
-- a hot path.

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying, against jmpanzrjxflovdfwcbye)
--
--   -- 1. The columns exist and everyone is UNKNOWN, not accepted:
--   select count(*) as total,
--          count(terms_accepted_at) as accepted
--     from public.profiles;                  -- expect accepted = 0
--
--   -- 2. The completeness constraint actually bites:
--   begin;
--     update public.profiles set terms_accepted_at = now()
--      where id = (select id from public.profiles limit 1);
--   rollback;                                -- expect 23514, not success
--
--   -- 3. The mechanism constraint actually bites:
--   begin;
--     update public.profiles
--        set terms_accepted_at = now(),
--            terms_accepted_version = 'terms=2026-08-18',
--            terms_accepted_via = 'vibes'
--      where id = (select id from public.profiles limit 1);
--   rollback;                                -- expect 23514, not success
--
--   -- 4. Then create ONE real account through /signup and re-run (1). Expect
--   --    accepted = 1, via = 'signup_checkbox', and the version string above.
--   --    Then sign in once with Google and expect a second row with
--   --    via = 'oauth_notice'.
--
--   -- 5. Confirm the columns are NOT readable by the client roles:
--   begin;
--     set local role authenticated;
--     select terms_accepted_at from public.profiles limit 1;  -- expect 42501
--   rollback;
--
-- ROLLBACK
--
--   alter table public.profiles
--     drop constraint if exists profiles_terms_acceptance_complete,
--     drop constraint if exists profiles_terms_accepted_via_check,
--     drop column if exists terms_accepted_via,
--     drop column if exists terms_accepted_version,
--     drop column if exists terms_accepted_at;
--
--   Destroys every acceptance record collected since the migration was applied
--   and they cannot be reconstructed. Prefer dropping only the constraints.
-- ---------------------------------------------------------------------------
