-- Account deletion completeness. Audit item 6, finding F6.1.
--
-- ***************************************************************************
-- ** APPLIED. Section 1 below is live on jmpanzrjxflovdfwcbye -- verified:  **
-- ** trade_audits_user_id_fkey exists and audit_trade_change() carries the  **
-- ** profile-exists guard. Do not re-run casually; it is idempotent, but    **
-- ** the VALIDATE takes a lock on a table that is now load-bearing.         **
-- **                                                                        **
-- ** F6.8 (moderation retention) was section 2 and is NO LONGER IN THIS     **
-- ** FILE. It is 0054_moderation_retention.sql and is NOT applied.          **
-- ***************************************************************************
--
--   F6.1  Deleting an account CREATES a permanent copy of every trade. The
--         trades_audit AFTER DELETE trigger writes old_values = to_jsonb(old)
--         -- the whole 35-column row -- into public.trade_audits, which had no
--         foreign key to anything (verified live at the time: zero FKs on the
--         table). An erasure request therefore ended with MORE personal data
--         stored than before it, in a table the user cannot see and no job
--         cleans up. Section 1 fixes that.
--
--   F6.8  Deleting an account ERASES the moderation reports filed AGAINST it.
--         Still true, still unfixed in production, and deliberately so: the
--         fix creates a new retention (a salted email hash surviving erasure)
--         and could not land before the privacy policy disclosing it. See
--         section 2 below and 0054_moderation_retention.sql.
--
-- The code half of this workstream (actions/account.ts, lib/server/
-- account-deletion.ts) is written to be CORRECT WITHOUT EITHER MIGRATION and
-- BETTER WITH THEM. Specifically:
--
--   * the moderation-hash stamp in preserveModerationRecords() targets a
--     column that does not exist yet. PostgREST answers 42703 and the step
--     records `skipped: no_hash_column` -- it does not throw and does not
--     abort the deletion. Until 0054 lands, a report against a deleting user
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
-- 2. F6.8 -- MOVED OUT OF THIS FILE.
-- ---------------------------------------------------------------------------
--
-- The moderation-retention half (trade_reports.reported_user_hash, and the
-- two CASCADE -> SET NULL changes that go with it) now lives in
-- 0054_moderation_retention.sql and is NOT part of this file any more.
--
-- Why it was split. Section 1 above only ever DELETES personal data, so it was
-- safe to apply on its own and it has been: trade_audits_user_id_fkey exists
-- on jmpanzrjxflovdfwcbye. Section 2 does the opposite -- it introduces a NEW
-- retention, a salted hash of a reported account's email kept after erasure so
-- a moderation record survives delete-and-re-register. A new retention must
-- not be created before the privacy policy that discloses it, and at the time
-- this file was written that disclosure did not exist. It does now (WS6:
-- privacy.html, "How long we keep your information"), so 0054 is ready to
-- apply alongside that page.
--
-- Do not re-add the SQL here. Two files asserting the same DDL is how a
-- constraint gets dropped and recreated by the file that was supposed to be
-- inert.

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
