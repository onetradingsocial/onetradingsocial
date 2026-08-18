-- Leaderboard integrity: trade deletion and account-balance bounds.
-- Audit item 15, findings F3 and F4 (both P1).
--
-- ⚠ PREPARED, NOT APPLIED. WS5 was instructed not to touch production, and
--   nothing in this file has been executed — not against production, not in a
--   rolled-back transaction. The row counts quoted below are from read-only
--   SELECTs, so the VALIDATE steps are expected to pass clean, but that is a
--   prediction and not a result. See ws5-leaderboard.md.
--
-- DEPLOY ORDER: code first, migration second. Both halves are additive
-- restrictions on things the application no longer does, so the code is safe
-- without the migration (it just isn't enforced), and the migration without
-- the code produces a silent no-op delete rather than an error message. Ship
-- `actions/trade.ts` and `actions/account.ts`, then run this.
--
-- =============================================================================
-- 1. Imported trades cannot be deleted.  (F4)
-- =============================================================================
--
-- THE PROBLEM. `trades_delete` was `using (auth.uid() = user_id)` with no
-- predicate on `source`. Migration 0028's `protect_imported_trade_fields`
-- trigger stops a statement- or broker-sourced trade being EDITED, and
-- /verification tells users in as many words that imported execution data is
-- "locked at the database level". It was never locked against removal.
--
-- WHY THAT IS WORSE THAN IT SOUNDS. Every metric on the board — win rate,
-- profit factor, expectancy, consistency, max drawdown — is recomputed over
-- whatever rows survive (`lib/leaderboard.ts`). Deleting losses raises all of
-- them at once. It is the cheapest manipulation in the product and the least
-- visible: no edit, no audit of a changed value, nothing on any admin surface
-- until now. And it is not recoverable by re-syncing, because the MT5 collector
-- advances `last_deal_time` past the deal it already imported
-- (`api/mt5-sync/collect/route.ts`), so a deleted broker trade never comes back.
--
-- WHY A POLICY AND NOT A REVOKE. DELETE cannot be granted per column, and
-- deleting a manual trade is a legitimate thing a user must be able to do. The
-- distinction is per ROW, by `source`, which is exactly what an RLS policy is
-- for. `source` itself has been service-role-only since 0045, so a user cannot
-- flip a trade to 'manual' to get around this.
--
-- ON `auth.uid()` AND CASCADES. The policy binds client roles only. Account
-- deletion cascades `profiles` -> `trades` under the service role, which
-- bypasses RLS entirely, so a departing user's imported trades are still
-- removed with the rest of their data. That is deliberate: this restricts
-- curation, not erasure.
--
-- The `(select auth.uid())` wrapping is the existing form and is kept: it lets
-- the planner treat the call as a one-time scalar rather than re-evaluating it
-- per row.

drop policy if exists trades_delete on public.trades;

create policy trades_delete on public.trades
  for delete
  using ((select auth.uid()) = user_id and source = 'manual');

-- A second layer, in the idiom 0045 established for INSERT/UPDATE: the policy
-- constrains a ROLE, the trigger states the RULE. `auth.uid()` is null for the
-- service role and non-null for every end-user session, so this says "an end
-- user may not delete a trade whose provenance is not their own assertion" and
-- keeps saying it even if a future server action reaches for the service client
-- to make a delete work.
--
-- It also turns a silent no-op into a message. A DELETE refused by RLS reports
-- success with zero rows affected; a trigger RAISE is something the application
-- can show the user. `actions/trade.ts#deleteTrade` reads `source` first and
-- returns its own copy for the normal path, but a direct PostgREST caller only
-- ever sees this.

create or replace function public.protect_imported_trade_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and old.source is distinct from 'manual' then
    raise exception
      'Imported trades cannot be deleted (source=%). Verified execution data is a record, not a draft.',
      old.source
      using errcode = '42501';
  end if;
  return old;
end $$;

revoke execute on function public.protect_imported_trade_delete() from public, anon, authenticated;

drop trigger if exists trades_protect_imported_delete on public.trades;

create trigger trades_protect_imported_delete
  before delete on public.trades
  for each row execute function public.protect_imported_trade_delete();

-- While here: `anon` still holds table-level DELETE on public.trades. 0045
-- revoked its INSERT and UPDATE and did not touch DELETE. It is inert —
-- `trades_delete` compares `auth.uid()` to `user_id` and an anonymous session's
-- uid is null, so it matches no row — but a privilege that can never be
-- exercised has no reason to be held, and the day someone widens that policy
-- is the day it stops being inert.

revoke delete on public.trades from anon;

-- Blast radius, measured read-only before writing this: production holds 13
-- `statement` trades and 0 `broker` trades, and all 13 belong to the internal
-- `TheTradingSocial` account. So this restricts nothing any real user is doing
-- today. It exists for the day the broker sync produces its first row.

-- =============================================================================
-- 2. `profiles.account_balance` is bounded.  (F3)
-- =============================================================================
--
-- The column carries a client UPDATE grant (0042) and was validated only as
-- `>= 0`, in the application, in a code path that then rescaled every
-- risk-%-sized trade the user had ever logged from it. The rescale is gone
-- (`actions/account.ts` — see its header for the reasoning, which is the more
-- important half of F3). This is the floor under what remains.
--
-- WHERE 1e9 COMES FROM. It is derived from the bounds 0045 already set, not
-- chosen for taste. `pnl_amount` is capped at 1e12 and `r_multiple` at 1000,
-- and a risk-%-sized trade's P&L is `r_multiple × balance × risk%/100`, so a
-- balance above 1e9 can produce a P&L the pnl CHECK rejects — i.e. a user
-- could save a balance that later makes closing a trade fail with an opaque
-- 23514. 1e9 × 1000 = 1e12 exactly, so the two constraints meet instead of
-- contradicting each other.
--
-- The lower anchor is currency. `account_currency` is a free three-letter
-- field and production already holds a PHP account; 1e9 VND is about USD 40k
-- and 1e9 IDR about USD 60k, both ordinary retail balances. A tighter cap
-- would reject real accounts in weak currencies. Production max today: 100,000.
--
-- WHAT THIS IS NOT. It does not make a self-declared balance true. Nothing
-- can, short of a funding-source integration nobody is proposing. It stops a
-- fat-fingered exponent from becoming a stored value that corrupts every
-- derived figure downstream, and it is described that way in ws5-leaderboard.md
-- rather than being counted as an anti-fraud control.
--
-- NOT VALID + VALIDATE, same idiom and same reason as 0045 and 0051: ADD
-- CONSTRAINT ... NOT VALID takes ACCESS EXCLUSIVE only momentarily, and
-- VALIDATE then runs under SHARE UPDATE EXCLUSIVE without blocking reads or
-- writes. At 457 rows the difference is nil; the file should still be safe at
-- a million.
--
-- Read-only precheck run before writing this file:
--   account_balance < 0        -> 0 rows
--   account_balance > 1e9      -> 0 rows
--   account_balance is null    -> 0 rows
-- so VALIDATE is expected to pass clean. If it does not, STOP and look at the
-- row rather than widening the bound to fit it.

alter table public.profiles
  drop constraint if exists profiles_account_balance_bounded;

alter table public.profiles
  add constraint profiles_account_balance_bounded
  check (account_balance is null or (account_balance >= 0 and account_balance <= 1000000000))
  not valid;

alter table public.profiles
  validate constraint profiles_account_balance_bounded;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
--
--   drop trigger if exists trades_protect_imported_delete on public.trades;
--   drop function if exists public.protect_imported_trade_delete();
--   drop policy if exists trades_delete on public.trades;
--   create policy trades_delete on public.trades
--     for delete using ((select auth.uid()) = user_id);
--   alter table public.profiles
--     drop constraint if exists profiles_account_balance_bounded;
--
-- No data is written or destroyed by this migration, so there is nothing to
-- restore.
