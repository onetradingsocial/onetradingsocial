-- Account deletion completeness. Audit item 6, findings F6.1 and F6.8.
--
-- ***************************************************************************
-- ** NOT APPLIED. Hand this to the owner. Deploy the code FIRST, then this. **
-- ***************************************************************************
--
-- Two independent problems, in opposite directions:
--
--   F6.1  Deleting an account CREATES a permanent copy of every trade. The
--         trades_audit AFTER DELETE trigger writes old_values = to_jsonb(old)
--         -- the whole 35-column row -- into public.trade_audits, which has no
--         foreign key to anything (verified live: zero FKs on the table). An
--         erasure request therefore ends with MORE personal data stored than
--         before it, in a table the user cannot see and no job cleans up.
--
--   F6.8  Deleting an account ERASES the moderation reports filed AGAINST it.
--         trade_reports.reported_user_id is ON DELETE CASCADE, so the
--         documented way to clear your record is to delete and re-register.
--         This is the one thing in item 6 that should have been retained and
--         is not.
--
-- The code half of this workstream (actions/account.ts, lib/server/
-- account-deletion.ts) is written to be CORRECT WITHOUT THIS MIGRATION and
-- BETTER WITH IT. Specifically:
--
--   * the moderation-hash stamp in preserveModerationRecords() targets a
--     column that does not exist yet. PostgREST answers 42703 and the step
--     records `skipped: no_hash_column` -- it does not throw and does not
--     abort the deletion. Until this lands, a report against a deleting user
--     still cascades away; after it lands, the report survives.
--   * nothing in the code depends on the trigger guard. The guard is what
--     stops the audit copies being written at all.
--
-- ---------------------------------------------------------------------------
-- 1. F6.1 -- stop deletion manufacturing new personal data, and clean up the
--    copies that already exist.
-- ---------------------------------------------------------------------------
--
-- THE DECISION, AND WHY IT IS "BOTH" AND NOT "EITHER"
--
-- The brief offered two options: exclude user-initiated deletion from the
-- audit trigger, or cascade the audits. Taken alone, EITHER ONE IS WRONG.
--
--   Cascade alone is not merely insufficient, it is actively dangerous.
--   The delete travels auth.users -> profiles -> trades. `trades_audit` is an
--   AFTER ROW trigger, so its inserts are queued and run at the end of the
--   cascading statement -- potentially AFTER the RI action that cascaded
--   trade_audits away. Inserting a trade_audits row whose user_id references a
--   profiles row that has already been deleted in the same transaction is a
--   foreign-key violation, which aborts the whole DELETE. Adding the FK
--   without the trigger guard would turn a working deletion into one that
--   fails for every user who has ever logged a trade.
--
--   Guard alone leaves the 82 rows already in production (live count today),
--   plus every row written by a future path that deletes trades some other
--   way, with no owner and no cleanup.
--
-- So: the guard is the correctness fix, the FK is the durable floor under it.
--
-- WHY DELETING THE AUDIT TRAIL IS THE RIGHT CALL AT ALL
--
-- 0028 created trade_audits as an "immutable audit trail" backing the verified
-- trader claim: it exists so a LIVE account cannot quietly rewrite its history
-- and keep the badge. Once the account is gone, the badge is gone, the trades
-- are gone and the profile is gone -- the trail no longer substantiates any
-- claim to anybody. What is left is a full copy of one person's trading
-- history, including entry/exit prices, position sizes, P&L and their private
-- journal notes, retained for no stated purpose and with no retention period.
-- That is not legitimate retention under item 6's Part 3 test (a lawful basis,
-- a period, an owner); it is residue. It is deleted.
--
-- The moderation counter-case is handled separately in section 2: what
-- survives an erasure is the report filed against the account, not a copy of
-- everything the account ever did.

-- 1a. The guard.
--
-- Reproduced in full from 0028:59-92 with ONE change, in the DELETE branch.
-- The INSERT and UPDATE branches are byte-identical to what is live today --
-- checked against pg_proc on jmpanzrjxflovdfwcbye. Note that 0045 did NOT
-- touch this function: what 0045 rewrote was protect_imported_trade_fields()
-- (extending it to BEFORE INSERT). trades_audit is still tgtype 29 --
-- ROW/AFTER/INSERT/DELETE/UPDATE -- exactly as 0028 created it.
--
-- The guard is `the owning profile still exists`. During a cascade from
-- auth.users the profiles row is deleted before the cascade reaches trades, so
-- the EXISTS is false and nothing is written. During an ordinary single-trade
-- delete the profile is very much alive, so the audit row is written exactly
-- as before. It reads as what it means: an audit trail is kept FOR somebody,
-- and there is no longer anybody to keep it for.
--
-- Deliberately NOT keyed on auth.uid(): the deletion runs through the service
-- role (auth.uid() is null), and so do the MT5 and crypto sync jobs, which DO
-- legitimately delete trades for a live user and should still be audited.
create or replace function public.audit_trade_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  oldj jsonb;
  newj jsonb;
  changed text[];
begin
  if tg_op = 'INSERT' then
    insert into public.trade_audits (trade_id, user_id, action, actor, source, new_values)
    values (new.id, new.user_id, 'created', auth.uid(), new.source, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    oldj := to_jsonb(old);
    newj := to_jsonb(new);
    changed := array(
      select key from jsonb_each(newj) as e(key, val)
      where val is distinct from oldj -> key and key <> 'updated_at'
    );
    if coalesce(array_length(changed, 1), 0) = 0 then return new; end if;
    insert into public.trade_audits
      (trade_id, user_id, action, actor, source, changed_fields, old_values, new_values)
    values (
      new.id, new.user_id, 'updated', auth.uid(), old.source, changed,
      (select jsonb_object_agg(k, oldj -> k) from unnest(changed) as k),
      (select jsonb_object_agg(k, newj -> k) from unnest(changed) as k)
    );
    return new;
  else
    -- F6.1. No owner left -> no audit trail to keep, and (with 1b below) no
    -- row that could legally be inserted anyway.
    if exists (select 1 from public.profiles where id = old.user_id) then
      insert into public.trade_audits (trade_id, user_id, action, actor, source, old_values)
      values (old.id, old.user_id, 'deleted', auth.uid(), old.source, to_jsonb(old));
    end if;
    return old;
  end if;
end $$;

-- 0028:129 revoked execute from the client roles; create-or-replace preserves
-- ACLs, but restate it so a future reader does not have to know that.
revoke execute on function public.audit_trade_change() from public, anon, authenticated;

-- 1b. The floor.
--
-- 0028:34 says "Intentionally no FK to trades: history must survive trade
-- deletion." That reasoning is sound and is NOT contradicted here: this FK is
-- to profiles, not to trades. Deleting one trade still leaves its history.
-- Deleting the PERSON removes it.
--
-- NOT VALID + VALIDATE as a separate statement, same idiom and same reason as
-- 0045: ADD CONSTRAINT ... NOT VALID takes ACCESS EXCLUSIVE only momentarily,
-- and VALIDATE then runs under SHARE UPDATE EXCLUSIVE without blocking trade
-- inserts. At 82 rows the difference is nil; the file should still be safe at
-- a million.
--
-- Live check before writing this: 0 rows in trade_audits have a user_id with
-- no matching profile, so VALIDATE is expected to pass clean. If it does not,
-- STOP -- an orphan means an account was deleted between that check and this
-- run, and you want to look at it rather than delete it blind.
alter table public.trade_audits
  drop constraint if exists trade_audits_user_id_fkey;

alter table public.trade_audits
  add constraint trade_audits_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade
  not valid;

alter table public.trade_audits validate constraint trade_audits_user_id_fkey;

comment on constraint trade_audits_user_id_fkey on public.trade_audits is
  'Audit item 6 F6.1. The trail exists to substantiate a live account''s '
  'verified-trader claim; when the account is erased the trail is personal '
  'data with no purpose, so it goes with it. Paired with the profile-exists '
  'guard in audit_trade_change() -- without that guard the AFTER DELETE '
  'trigger would insert against a just-deleted profile and abort the cascade.';

-- ---------------------------------------------------------------------------
-- 2. F6.8 -- moderation reports must survive the reported account.
-- ---------------------------------------------------------------------------
--
-- Today both sides are ON DELETE CASCADE (verified live), so deleting your
-- account destroys every report filed against you and every report you filed.
-- Item 6 Part 3 lists fraud/abuse records as the one category that SHOULD be
-- retained and is currently the only one being actively destroyed.
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
-- is salted from DELETION_HASH_SALT so the column is not a rainbow-table of
-- every address that has ever been reported; with no salt configured the code
-- skips the stamp and logs, and the report row still survives -- the salt
-- gates the pseudonym, never the retention.
--
-- Lawful basis: legitimate interests / fraud and abuse prevention. Period:
-- 3 years from the report date, or until the matter is resolved, whichever is
-- longer. This must be stated in the privacy policy -- WS6 owns that text, and
-- this migration should not land without it.

alter table public.trade_reports
  add column if not exists reported_user_hash text;

comment on column public.trade_reports.reported_user_hash is
  'Audit item 6 F6.8. Salted SHA-256 of the reported account''s email, '
  'stamped at account deletion so the report survives erasure without '
  'retaining an identifier. Null while the account still exists -- '
  'reported_user_id answers the question then. Legitimate interests '
  '(fraud/abuse); retain 3 years or until resolved.';

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
-- No RLS change. trade_reports_select is `auth.uid() = reporter_id`; with a
-- null reporter_id that predicate is NULL, which RLS treats as false, so an
-- anonymised report is invisible to every client role and readable only
-- through the service role on /admin. That is exactly the desired reach.
--
-- /admin/verification already renders `uname.get(r.reported_user_id ?? '')
-- ?? 'unknown'`, so a null side degrades to "@unknown" rather than crashing.
-- Checked, not assumed (src/app/admin/verification/page.tsx:84-89).

-- ---------------------------------------------------------------------------
-- 3. What this migration deliberately does NOT do
-- ---------------------------------------------------------------------------
--
-- F6.7  feature_requests / feature_request_comments author_id stay SET NULL,
--       so the free text survives under a null author while posts and comments
--       cascade. Inconsistent, disclosed nowhere, and a product decision
--       (roadmap continuity is a defensible reason to keep it) -- not this
--       workstream's call.
--
-- F6.8  conversations.user_a / user_b and referrals.referrer_id /
--       referred_user_id are still both-sides CASCADE, so deleting A still
--       destroys B's own messages and a referrer's earned-credit record.
--       Changing conversations needs a product decision about what a thread
--       with a departed participant should look like; changing referrals needs
--       one about whether a credit survives the referee. Both are more
--       invasive than the moderation fix and neither was assigned here.
--
-- F6.5  analytics_events stays SET NULL. The re-linkable anon_id is scrubbed
--       by the application (scrubAnalytics) rather than by the schema, because
--       the rows that need scrubbing include the PRE-LOGIN ones that never had
--       a user_id at all -- they are reachable only by anon_id, which no
--       foreign key can express.
--
-- referral_clicks and system_alerts.acked_by still have no FK. referral_clicks
-- is scrubbed by anon_id in the same application step; system_alerts.acked_by
-- is a dangling admin uuid and is cosmetic.
