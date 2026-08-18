-- 0050 — Grandfather existing accounts before enabling "Confirm email".
-- Item 9 F2 (WS2).
--
-- ============================================================================
-- DO NOT APPLY THIS BLIND. Run the verification query in step 1 first.
-- If it returns 0, this migration is unnecessary — skip it and flip the toggle.
-- ============================================================================
--
-- WHY THIS MIGHT NOT BE NEEDED, AND WHY THE AUDIT LOOKED LIKE IT WAS
-- --------------------------------------------------------------------------
-- The audit reported "453 of 454 users have confirmation_sent_at IS NULL" and
-- the fix brief read that as "453 users are unconfirmed and would be locked
-- out". Those are two different columns and only one of them gates sign-in:
--
--   confirmation_sent_at  — when GoTrue last MAILED a confirmation link.
--                           NULL simply means no link was ever sent, which is
--                           exactly what auto-confirm does. Never consulted at
--                           login.
--   email_confirmed_at    — the flag GoTrue actually checks. When "Confirm
--                           email" is ON, a NULL here is what produces
--                           "Email not confirmed" and refuses the sign-in.
--
-- The same audit measured `email_confirmed_at - created_at < 2s` for 443 of
-- 454 rows, i.e. those 443 are already confirmed and are NOT at risk. That
-- leaves up to 11 rows unaccounted for, which is what this migration is for.
-- The exact count could not be read at authoring time, hence step 1.
--
-- Idempotent and additive: it only ever fills a NULL, never clears a value.

-- ---------------------------------------------------------------------------
-- STEP 1 — VERIFY FIRST. Run this on its own and read the result.
-- ---------------------------------------------------------------------------
-- select count(*) filter (where email_confirmed_at is null)  as would_be_locked_out,
--        count(*) filter (where email_confirmed_at is not null) as already_confirmed,
--        count(*)                                            as total
-- from auth.users;
--
--   would_be_locked_out = 0  -> skip this file entirely, flip the toggle.
--   would_be_locked_out > 0  -> those accounts CANNOT log in after the toggle.
--                               Apply step 2.

-- ---------------------------------------------------------------------------
-- STEP 2 — Grandfather everyone who exists TODAY.
-- ---------------------------------------------------------------------------
-- The cutoff is deliberately a literal timestamp rather than now(): it must
-- pin the population to accounts that predate the policy change, so that
-- re-running this file later can never retroactively confirm an address that
-- signed up under the new rules and failed to prove ownership.
--
-- >>> BEFORE APPLYING: set this to the moment you are about to flip the
-- >>> dashboard toggle. Leaving the placeholder confirms nothing after it,
-- >>> which is the safe direction to be wrong in.
do $$
declare
  cutoff constant timestamptz := timestamptz '2026-08-18 00:00:00+00';
  touched integer;
begin
  update auth.users
     set email_confirmed_at = coalesce(email_confirmed_at, created_at, now())
   where email_confirmed_at is null
     and created_at < cutoff;

  get diagnostics touched = row_count;
  raise notice '0050: grandfathered % pre-existing account(s)', touched;
end
$$;

-- ---------------------------------------------------------------------------
-- STEP 3 — Confirm the population is now clean, BEFORE flipping the toggle.
-- ---------------------------------------------------------------------------
-- select count(*) from auth.users where email_confirmed_at is null;   -- expect 0
--
-- NOT DONE HERE, ON PURPOSE:
--   * Nothing touches confirmation_sent_at. It is a mail-log field; writing it
--     would fake a history of emails that were never sent.
--   * Nothing touches auth.identities. Google identities carry their own
--     verification and are unaffected either way.
--   * No trigger, no constraint. Enforcement of the new policy belongs to
--     GoTrue's own setting, not to a DDL object we would have to keep in sync
--     with it.
