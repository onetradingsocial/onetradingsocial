-- Lock trade provenance and put floors under trade values.
-- Audit item 15, findings 1 (P0) and 2 (P0).
--
-- THE PROBLEM
--
-- 1) The "verified trader" badge is self-awardable. `authenticated` (and `anon`)
--    hold table-level INSERT and UPDATE on all 35 columns of public.trades --
--    confirmed live against information_schema.column_privileges -- and the RLS
--    policies restrict only WHICH ROW (`auth.uid() = user_id`), never which
--    column or which value. `trades.source` is an ordinary enum column with a
--    default (0028:13-14), and profileLevel() (app/src/lib/verification.ts:56)
--    returns `broker_connected` -- the green tick, rendered on the leaderboard,
--    the profile header, the journal and the OG share image -- as soon as one
--    row with source='broker' exists. So a single
--
--        POST /rest/v1/trades  {"source":"broker", "pnl_amount":9e8, ...}
--
--    with the public anon key and the caller's own JWT mints the badge. The
--    protect_imported_trade_fields trigger (0028:102-126) is BEFORE UPDATE
--    ONLY, so it never sees an INSERT; worse, once source<>'manual' it then
--    *protects* the fabricated row from being edited, which makes it look more
--    authentic than a real manual entry.
--
-- 2) The table carries exactly two constraints, trades_pkey and
--    trades_user_id_fkey. No bound on pnl_amount or r_multiple, no
--    `traded_at <= now()`, no `closed_at >= traded_at`. Production already held
--    10 rows where a trade closed before it opened.
--
-- WHAT THIS MIGRATION DOES NOT DO -- read this before trusting it
--
-- pnl_amount, r_multiple, outcome, status, closed_at and exit_price stay
-- writable by the row's owner, because closeTrade() (actions/trade.ts:190-195)
-- and saveAccount() (actions/account.ts:36) write them with the USER client.
-- A user can therefore still PATCH their own closed trade to an implausible
-- (but in-range) P&L. That is audit finding 2's residue and it is not closed
-- here; the bounds below are a corruption floor, not an anti-fraud control.
-- What IS closed here is provenance: a self-reported row can no longer claim to
-- be broker-verified.

-- ---------------------------------------------------------------------------
-- 1. Repair the 10 impossible rows, before any constraint can reject them.
-- ---------------------------------------------------------------------------
--
-- Two distinct causes, both diagnosed rather than assumed:
--
--   * 3 rows inverted by <= 1 ms. createTrade() stamped `closed_at` with its
--     own `new Date()` (actions/trade.ts:84,99) and then read the clock AGAIN a
--     few lines later for the `traded_at` fallback (:109). closed_at was
--     therefore computed FIRST and could land one millisecond before the trade
--     it belongs to. Pure clock artefact, no user input involved. Fixed at
--     source in the same change: createTrade now takes one `now` per request.
--
--   * 7 rows inverted by 7.98-9.42 HOURS, every one of them with `:00` seconds
--     and every one exactly the submitting user's local wall clock. The trade
--     date input is `<input name="traded_at" type="datetime-local">`
--     (_components/TradeModalProvider.tsx:229,397); its value carries NO zone
--     ("2026-06-17T20:36") and actions/trade.ts:139 hands that naked string to
--     Postgres, which reads it as UTC. A UTC+8 user (the one non-internal owner
--     in this set has account_currency = 'PHP') logging at 12:36 UTC stores
--     20:36 UTC. This is a live application bug, still unfixed -- see the report.
--
-- Repair, not deletion: `traded_at := least(created_at, closed_at)`. Both of
-- those are server-generated -- created_at by the Postgres default, closed_at by
-- the server action -- so neither is attacker- or timezone-influenced, and
-- `least` is the only choice that is guaranteed to satisfy the constraint added
-- in section 4 whichever of the two came first. For the millisecond rows it
-- moves traded_at by <= 1 ms; for the timezone rows it restores the true instant
-- the trade was logged, to within the seconds between the open and the close.
-- The trades_audit trigger writes an `updated` row for each, so the original
-- values remain recoverable from trade_audits.old_values.
--
-- Idempotent: the predicate is self-clearing.
update public.trades
   set traded_at = least(created_at, closed_at)
 where closed_at is not null
   and closed_at < traded_at;

-- ---------------------------------------------------------------------------
-- 2. Column-level grants (finding 1). Same idiom as 0042 on public.profiles.
-- ---------------------------------------------------------------------------
--
-- The list below is every column written to public.trades by a USER client
-- (`createClient()` from @/lib/supabase/server). Service-client writers are
-- excluded by design -- the service role bypasses grants and RLS alike.
--
--   INSERT  actions/trade.ts:127-141   createTrade
--   UPDATE  actions/trade.ts:190-195   closeTrade
--           actions/trade.ts:231-232   saveTradeChartUrl -> screenshot_url
--           actions/account.ts:34-36   saveAccount backfill -> risk_amount,
--                                      pnl_amount
--
-- Service-client writers, intentionally NOT granted:
--   api/mt5-sync/collect/route.ts:56       source='broker'  (createServiceClient)
--   lib/server/crypto-sync.ts:68           source='broker'  (createServiceClient)
--   actions/mt5-import.ts commitMt5Import  source='statement'
--       ^ this one was a USER-client writer of `source` and `broker_deal_id`
--         until this change. It is moved to the service client in the same
--         commit. Without that edit, revoking `source` breaks MT5 statement
--         import for every Trader-plan user. Do not apply this migration
--         without deploying that code.
--
-- Never written by application code at all: id, created_at, updated_at
-- (trades_touch_updated_at trigger).
--
-- `traded_at` is granted on INSERT but NOT on UPDATE: no code path re-dates a
-- trade, and leaving UPDATE open let a user PATCH traded_at to slide a losing
-- trade out of the rolling leaderboard window (lib/leaderboard.ts:121-125) or to
-- farm retroactive XP day/week buckets (lib/xp.ts:111-124). Same reasoning for
-- user_id: the row's owner is fixed at insert.
--
-- Deliberately NOT granted on UPDATE, though a future "edit trade" feature will
-- want them back: market, instrument, direction, entry_price, stop_price,
-- target_price, sizing_mode, risk_percent, lots, sl_pips, tp_pips, planned_rr,
-- setup_type, confidence, emotion, note, is_public, strategy_tags. 0028's
-- execution-field lock already contemplates journal fields staying editable, so
-- when that feature ships, add the journal subset here -- not the execution one.
--
-- Idempotent and re-runnable: revoke and grant are both declarative.

revoke insert, update on public.trades from anon, authenticated;

grant insert (
  user_id,
  market,
  instrument,
  direction,
  sizing_mode,
  entry_price,
  stop_price,
  target_price,
  exit_price,
  risk_percent,
  lots,
  risk_amount,
  sl_pips,
  tp_pips,
  planned_rr,
  r_multiple,
  pnl_amount,
  realized_pips,
  outcome,
  status,
  setup_type,
  confidence,
  emotion,
  note,
  is_public,
  mistake_tags,
  strategy_tags,
  traded_at,
  closed_at
) on public.trades to authenticated;

grant update (
  exit_price,
  risk_amount,
  r_multiple,
  pnl_amount,
  realized_pips,
  outcome,
  status,
  screenshot_url,
  mistake_tags,
  closed_at
) on public.trades to authenticated;

-- `anon` gets nothing back: an anonymous caller owns no trade row, and
-- trades_insert / trades_update would reject the write anyway (auth.uid() is
-- null). It held both grants only because they were table-wide defaults.

-- ---------------------------------------------------------------------------
-- 3. Provenance enforcement in the trigger, so a forgery is REJECTED, not
--    merely frozen (finding 1).
-- ---------------------------------------------------------------------------
--
-- The grants above are the wall. This is the second layer, and it matters for a
-- reason that is easy to miss: grants are per-ROLE. They stop PostgREST callers
-- arriving as `authenticated`, but they would not stop a future server action
-- that reached for the service client "just to make the insert work". The
-- trigger keys on auth.uid() instead, which is null for the service role and
-- for migrations, and non-null for every real end-user session -- so it states
-- the actual rule: an end user may not assert provenance about their own data.
--
-- BEFORE INSERT is the half that was missing. 0028 created this trigger BEFORE
-- UPDATE only and short-circuited on `old.source = 'manual'`, which means the
-- forged row -- inserted as source='broker' from the start -- was never
-- inspected at all, and every subsequent edit to it was then protected.
create or replace function public.protect_imported_trade_fields()
returns trigger
language plpgsql set search_path = public as $$
begin
  -- Service-role jobs and migrations (auth.uid() is null) are the importers;
  -- they are the only writers allowed to assert provenance.
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      if new.source is distinct from 'manual'::trade_source then
        raise exception
          'Trade provenance is set by the importer, not the client (attempted source=%).', new.source
          using errcode = '42501';
      end if;
      if new.broker_deal_id is not null then
        raise exception
          'broker_deal_id is set by the importer, not the client.'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE. Check source separately and BEFORE the manual short-circuit below:
  -- promoting a manual trade to 'broker' is the same forgery as inserting one,
  -- and the old code let it through because it only looked at old.source.
  if auth.uid() is not null
     and new.source is distinct from old.source then
    raise exception
      'Trade provenance cannot be changed (% -> %).', old.source, new.source
      using errcode = '42501';
  end if;

  -- Execution data on imported trades is locked for users. Journal fields
  -- (note, screenshot, tags, emotion, confidence, visibility) stay editable.
  -- Service-role jobs may still correct sync data.
  if old.source = 'manual' or auth.uid() is null then return new; end if;
  if (new.market, new.instrument, new.direction, new.entry_price, new.stop_price,
      new.target_price, new.exit_price, new.sizing_mode, new.risk_percent, new.lots,
      new.risk_amount, new.sl_pips, new.tp_pips, new.planned_rr, new.r_multiple,
      new.pnl_amount, new.realized_pips, new.outcome, new.status,
      new.traded_at, new.closed_at, new.broker_deal_id, new.source)
     is distinct from
     (old.market, old.instrument, old.direction, old.entry_price, old.stop_price,
      old.target_price, old.exit_price, old.sizing_mode, old.risk_percent, old.lots,
      old.risk_amount, old.sl_pips, old.tp_pips, old.planned_rr, old.r_multiple,
      old.pnl_amount, old.realized_pips, old.outcome, old.status,
      old.traded_at, old.closed_at, old.broker_deal_id, old.source) then
    raise exception 'Imported execution data is locked; only journal fields can be edited.';
  end if;
  return new;
end $$;

drop trigger if exists trades_protect_imported on public.trades;
create trigger trades_protect_imported
  before insert or update on public.trades
  for each row execute function public.protect_imported_trade_fields();

-- ---------------------------------------------------------------------------
-- 4. Value bounds (finding 2).
-- ---------------------------------------------------------------------------
--
-- WHY THE FUTURE-DATE RULE IS A TRIGGER AND NOT A CHECK
--
-- Postgres requires every function in a CHECK constraint to be IMMUTABLE, and
-- now() is STABLE. `check (traded_at <= now())` is rejected outright
-- ("functions in check constraint must be immutable"), and forcing it through
-- would be wrong anyway: a CHECK is re-evaluated on every UPDATE, so a row that
-- was valid when written would start failing unrelated edits as the clock moved
-- -- here in the opposite direction, but the class of bug is the same. A BEFORE
-- trigger that fires only when the timestamp actually changes is the correct
-- shape for a "must be true at write time" rule.
--
-- The one-minute tolerance is not a guess: it is the same slack
-- actions/trade.ts:112 already allows for browser/server clock skew, copied
-- deliberately so the database and the application agree on where the line is.
create or replace function public.reject_future_trade_times()
returns trigger
language plpgsql set search_path = public as $$
begin
  if (tg_op = 'INSERT' or new.traded_at is distinct from old.traded_at)
     and new.traded_at > now() + interval '1 minute' then
    raise exception 'traded_at cannot be in the future (%).', new.traded_at
      using errcode = '22007';
  end if;
  if new.closed_at is not null
     and (tg_op = 'INSERT' or new.closed_at is distinct from old.closed_at)
     and new.closed_at > now() + interval '1 minute' then
    raise exception 'closed_at cannot be in the future (%).', new.closed_at
      using errcode = '22007';
  end if;
  return new;
end $$;

drop trigger if exists trades_reject_future_times on public.trades;
create trigger trades_reject_future_times
  before insert or update on public.trades
  for each row execute function public.reject_future_trade_times();

revoke execute on function public.reject_future_trade_times() from public, anon, authenticated;

-- CHECK constraints for the parts that are genuinely immutable.
--
-- Each is added NOT VALID and validated as a separate statement. At 339 rows
-- the performance difference is nil; the reason to keep the two-step form is
-- lock behaviour as the table grows: a plain ADD CONSTRAINT holds ACCESS
-- EXCLUSIVE for the duration of the full table scan, blocking every concurrent
-- trade insert, whereas ADD ... NOT VALID takes that lock only momentarily and
-- VALIDATE CONSTRAINT then runs under SHARE UPDATE EXCLUSIVE, which does not
-- block reads or writes at all. The same file should still be safe to run when
-- there are a million rows.
--
-- All three VALIDATE clean on production as of 2026-08-14, after section 1.

-- closed_at >= traded_at, with a ONE SECOND grace.
--
-- The grace is there for a specific, measured reason and not as hand-waving:
-- three production rows were inverted by a single millisecond because
-- createTrade read the clock twice (section 1). That code is fixed, but the
-- fixed bundle is not deployed yet, and a constraint that rejects roughly 1% of
-- legitimate quick-entry closes between now and that deploy would be a
-- self-inflicted outage. One second is four orders of magnitude below the
-- smallest genuine inversion observed (7.98 hours), so it costs nothing in
-- detection. Tighten to `>= traded_at` once the code fix has shipped.
alter table public.trades drop constraint if exists trades_closed_after_traded;
alter table public.trades add constraint trades_closed_after_traded
  check (closed_at is null or closed_at >= traded_at - interval '1 second') not valid;
alter table public.trades validate constraint trades_closed_after_traded;

-- |pnl_amount| <= 1e12.
--
-- This is a corruption bound, not a plausibility bound, and the number is
-- chosen structurally rather than by taste:
--
--   * Upper anchor. Every leaderboard and journal metric sums pnl_amount in
--     JavaScript as an IEEE-754 double (lib/leaderboard.ts:39-66). Sums stay
--     exact only below Number.MAX_SAFE_INTEGER, 9.007e15. Capping a single row
--     three orders of magnitude below that leaves room for thousands of trades
--     per user before any aggregate can silently lose precision. `numeric` has
--     no such ceiling, so today a fat-fingered exponent or an overflow in
--     `pnl = r_multiple x risk_amount` is storable and would corrupt every
--     downstream aggregate rather than fail loudly.
--   * Lower anchor. It must not reject a legitimate row in ANY currency. P&L is
--     stored in the account's own currency (profiles.account_currency, a free
--     3-letter field), so a weak-currency account inflates the number by up to
--     ~5 orders of magnitude: USD 1,000,000 is ~2.5e10 VND. 1e12 clears the
--     largest plausible retail result in the weakest quoted currency with room
--     to spare. The production maximum today is 1e6.
--
-- A tighter, currency-aware plausibility bound belongs in application
-- validation, where it can be explained to the user, not in a CHECK.
alter table public.trades drop constraint if exists trades_pnl_amount_bounded;
alter table public.trades add constraint trades_pnl_amount_bounded
  check (pnl_amount is null or abs(pnl_amount) <= 1e12::numeric) not valid;
alter table public.trades validate constraint trades_pnl_amount_bounded;

-- |r_multiple| <= 1000.
--
-- r_multiple is a ratio, not a money amount, so it is currency-free and can be
-- bounded much more tightly. computeClose() (lib/trade.ts:87-95) computes it as
-- realizedPips / slPips, and slPips comes from |entry - stop|. Above ~1000 the
-- value is not reporting a trade result, it is reporting a near-zero
-- denominator: a stop placed a thousand times closer than the move it survived.
-- The production maximum is 13.8, so this sits ~70x above anything real while
-- still catching the divide-by-almost-zero case that would otherwise poison
-- avgR, expectancy, consistency and riskAdjusted for a whole leaderboard page.
alter table public.trades drop constraint if exists trades_r_multiple_bounded;
alter table public.trades add constraint trades_r_multiple_bounded
  check (r_multiple is null or abs(r_multiple) <= 1000::numeric) not valid;
alter table public.trades validate constraint trades_r_multiple_bounded;
