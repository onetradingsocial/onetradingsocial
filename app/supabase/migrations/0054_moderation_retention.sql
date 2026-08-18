-- Moderation records must survive the reported account. Audit item 6, F6.8.
--
-- ***************************************************************************
-- ** NOT APPLIED. Hand this to the owner and apply it WITH the WS6 deploy.  **
-- ***************************************************************************
--
-- PROVENANCE
--
-- This was section 2 of 0051_account_deletion.sql. Section 1 of that file
-- (the trades_audit guard and the trade_audits -> profiles FK) IS applied --
-- verified live on jmpanzrjxflovdfwcbye: trade_audits_user_id_fkey exists.
-- Section 2 was deliberately held back, because unlike section 1 it does not
-- delete personal data, it CREATES A NEW RETENTION: a salted hash of a
-- reported account's email address, kept after the account is erased. A new
-- retention must not land before the privacy policy that discloses it.
--
-- That disclosure now exists. It is the "Moderation records" row of the
-- retention table in privacy.html ("How long we keep your information"), plus
-- the paragraph immediately under it, which state the category, the lawful
-- basis (legitimate interests -- fraud and abuse prevention) and the period
-- (3 years from the report, or until the matter is resolved, whichever is
-- longer). Deploy that page and this file together. If the policy text is
-- rolled back, roll this back too.
--
-- 0051 section 2 has been replaced in place by a pointer to this file so the
-- two cannot both be applied and diverge. Nothing else in 0051 changed.

-- ---------------------------------------------------------------------------
-- The problem
-- ---------------------------------------------------------------------------
--
-- Today both sides are ON DELETE CASCADE (verified live: both
-- trade_reports_reporter_id_fkey and trade_reports_reported_user_id_fkey are
-- CASCADE), so deleting your account destroys every report filed against you
-- and every report you filed. The documented way to clear your moderation
-- record is therefore to delete the account and sign up again. Item 6 Part 3
-- lists fraud/abuse records as the one category that SHOULD be retained, and
-- it is currently the only one being actively destroyed.
--
-- Retained: the reason, the free-text detail, the status, the date, and a
-- salted hash of the reported account's email address.
-- Not retained: the user ids, the username, the email itself.
--
-- WHY A HASH OF THE EMAIL AND NOT OF THE USER ID
--
-- The threat this retention answers is delete-and-re-register: an account is
-- reported, the holder deletes it, signs up again and starts clean. A hash of
-- the USER ID cannot detect that -- the new account has a new uuid, so the
-- hashes never match and the column buys nothing but the illusion of one. The
-- email address is the identity that persists across the re-registration, so
-- hashing that is the only version of this column that does any work.
--
-- The hash is stamped by the application at deletion time
-- (preserveModerationRecords, lib/server/account-deletion.ts) rather than by a
-- trigger here, because email addresses live in auth.users, which PostgREST
-- cannot reach and which a public-schema trigger has no business reading. It
-- is salted from DELETION_HASH_SALT so the column is not a rainbow table of
-- every address that has ever been reported; with no salt configured the code
-- skips the stamp and logs, and the report row still survives -- the salt
-- gates the pseudonym, never the retention.
--
-- Lawful basis: legitimate interests / fraud and abuse prevention. Period:
-- 3 years from the report date, or until the matter is resolved, whichever is
-- longer. Both are stated in privacy.html as above.
--
-- NOTE ON THE PERIOD. There is no purge job for this table, here or anywhere
-- (there is no pg_cron in this project and no scheduled prune of any table).
-- The 3-year period is therefore a stated policy that is currently enforced by
-- hand, and privacy.html says exactly that rather than implying an automatic
-- deletion that does not happen. WS8 owns adding the job; when it exists,
-- tighten the policy wording to match.

alter table public.trade_reports
  add column if not exists reported_user_hash text;

comment on column public.trade_reports.reported_user_hash is
  'Audit item 6 F6.8. Salted SHA-256 of the reported account''s email, '
  'stamped at account deletion so the report survives erasure without '
  'retaining an identifier. Null while the account still exists -- '
  'reported_user_id answers the question then. Legitimate interests '
  '(fraud/abuse); retain 3 years or until resolved. Disclosed in '
  'privacy.html, "How long we keep your information".';

create index if not exists trade_reports_reported_hash_idx
  on public.trade_reports (reported_user_hash)
  where reported_user_hash is not null;

-- reporter_id is `uuid not null` today. SET NULL cannot fire against a NOT
-- NULL column, so the constraint has to come off first. A report with no
-- reporter is still a usable moderation signal -- who complained matters far
-- less than who was complained about -- and the alternative (cascade) throws
-- away a report about a DIFFERENT, still-live user because the person who
-- filed it happened to leave. That is somebody else's record being destroyed
-- by your deletion, which is the same class of bug as the conversations and
-- referrals both-sides cascades (F6.8's other two halves, NOT fixed here --
-- they need a product decision, see ws3-deletion.md).
alter table public.trade_reports
  alter column reporter_id drop not null;

alter table public.trade_reports
  drop constraint if exists trade_reports_reporter_id_fkey;
alter table public.trade_reports
  add constraint trade_reports_reporter_id_fkey
  foreign key (reporter_id) references public.profiles(id) on delete set null;

alter table public.trade_reports
  drop constraint if exists trade_reports_reported_user_id_fkey;
alter table public.trade_reports
  add constraint trade_reports_reported_user_id_fkey
  foreign key (reported_user_id) references public.profiles(id) on delete set null;

-- The anti-spam dedupe index is `unique (reporter_id, reported_user_id,
-- reason) where status = 'open'`. Postgres treats NULLs as distinct in a
-- unique index by default, so once either id is nulled the row stops
-- participating in the constraint. That is the behaviour we want: the index
-- exists to stop one live user spam-filing against another live user, and a
-- row with a null side has no live user on it to spam with. Restated rather
-- than changed -- and deliberately NOT switched to NULLS NOT DISTINCT, which
-- would collapse every anonymised report sharing a reason into one row and
-- silently block new legitimate reports.
--
-- No RLS change. trade_reports_select is `auth.uid() = reporter_id` (verified
-- live); with a null reporter_id that predicate is NULL, which RLS treats as
-- false, so an anonymised report is invisible to every client role and
-- readable only through the service role on /admin. That is exactly the
-- desired reach, and it is why the retention is defensible: what survives is
-- a moderation record no user can read, not a profile of a departed person.
--
-- /admin/verification already renders `uname.get(r.reported_user_id ?? '')
-- ?? 'unknown'`, so a null side degrades to "@unknown" rather than crashing.
-- Checked, not assumed (src/app/admin/verification/page.tsx:84-89).

-- ---------------------------------------------------------------------------
-- After applying
-- ---------------------------------------------------------------------------
--
-- preserveModerationRecords() currently records `skipped: no_hash_column`
-- against a 42703 from PostgREST and does NOT abort a deletion. Once this
-- lands it starts stamping for real on the next deletion, with no code deploy.
-- Confirm with the WS3 manual script, phase 6 step 37.
