-- Mistake tagging becomes a Free feature ("Basic Cycle", audit follow-up C1).
--
-- MUST RUN BEFORE THE CODE THAT SHIPS WITH IT REACHES PRODUCTION, or the
-- change does nothing. This is the whole reason this file exists.
--
-- `canFlag` (app/src/lib/feature-flags.ts) is:
--
--     const row = flags[feature]
--     return row ? row[tier] : can(tier, feature)
--
-- A feature_flags ROW WINS OUTRIGHT over the static FEATURE_MIN_TIER matrix —
-- the constant is consulted only when no row exists. `mistake_tagging` has had
-- a row since 0015_feature_flags.sql seeded it as (free=false, trader=true,
-- pro=true), so flipping the constant in entitlements.ts to 'free' changes
-- exactly nothing in production on its own. Every live gate
-- (actions/trade.ts#closeTrade, journal/page.tsx) reads canFlag, not can.
--
-- The symptom of shipping the code without this migration is the worst kind:
-- the pricing page, the plan cards and the welcome popup all announce that Free
-- tags mistakes, the CloseTradeModal hides its chips, and nothing errors.
--
-- DEPLOY ORDER: this migration first, code second. In that order the interval
-- between them is a Free user who can write a mistake tag through an action
-- that is happy to store it while the UI has not yet offered them the chips —
-- invisible and harmless. The reverse order is a false advertisement.
--
-- Idempotent and safely re-runnable.

-- =============================================================================
-- WHAT CHANGES
-- =============================================================================
--
--  before:  mistake_tagging   free=false  trader=true  pro=true
--  after:   mistake_tagging   free=true   trader=true  pro=true
--
-- Nothing else moves. In particular `strategy_tracking` KEEPS its row exactly
-- as seeded (free=false, trader=true, pro=true): "which mistake did I make" is
-- a reflection input and is now free, "which strategy makes money" is analysis
-- and is still sold. The two rows sit next to each other in 0015 and are easy
-- to update together by accident.
--
-- The mistake-analysis card is gated on a DIFFERENT key, `mistake_analysis`,
-- which is new in this release and deliberately has NO row here. A feature with
-- no row falls through to FEATURE_MIN_TIER, where it is 'trader' — the default
-- an admin can still override later from /admin/features, and the same
-- treatment every other unseeded key gets.

update public.feature_flags
   set free = true
 where feature = 'mistake_tagging'
   and free is distinct from true;

-- Belt and braces: if the row was ever deleted (admin "Reset" removes the row
-- so the static default applies), re-create it in the new shape rather than
-- leaving the tier boundary to whichever value the code happens to hold.
insert into public.feature_flags (feature, free, trader, pro)
values ('mistake_tagging', true, true, true)
on conflict (feature) do nothing;
