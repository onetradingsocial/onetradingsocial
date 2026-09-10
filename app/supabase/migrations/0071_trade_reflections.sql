-- Per-trade rule reflection: "did THIS trade follow your rules?"
--
-- Audit 2026-09-05, Wave D4 — the third step of the basic improvement cycle.
-- Ungated, at every tier. This is the reflection input a Free user needs to
-- complete a cycle, and the evidence the basic weekly review (D6/C3) counts.
--
-- DEPLOY ORDER: migration first, code second — the same rule 0067 states and
-- for the same reason. 0045 revoked the table-wide UPDATE default from
-- `authenticated`, so without the grant at the bottom of this file PostgREST
-- rejects the whole statement with "permission denied for column
-- reflection_outcome of relation trades" the moment a user answers the prompt,
-- and nothing is written. Deploys here are automatic; migrations are not.
--
-- =============================================================================
-- WHY COLUMNS ON `trades` AND NOT A SIDE TABLE
-- =============================================================================
--
-- A reflection is exactly one optional answer about exactly one trade. A side
-- table keyed by `trade_id` with a unique constraint is the same 1:1 fact
-- reached through a join, and it would cost:
--
--   * its own RLS policies, its own column grants, and its own answer to "is
--     this row the caller's?" — three more places for the trades/reflections
--     ownership story to drift apart;
--   * a second query (or a join) on every read. `journal/page.tsx` already
--     selects the user's whole trade list in one statement; the counts the
--     weekly review needs then reduce over rows that are already in memory;
--   * a fresh argument about imported trades. Columns on `trades` inherit the
--     one that already exists — see below — where a new table would have
--     started from nothing and could easily have picked up 0053's
--     `source = 'manual'` reasoning by mistake, which is the exact opposite of
--     what a reflection needs.
--
-- What the side table would have bought — cheap addition of more reflection
-- fields later — is not something this feature needs. The audit asks for one
-- answer and one sentence.
--
-- `process_logs` (0070) was NOT extended instead. Its unique index is
-- (user_id, day, kind): one row per kind per day, deliberately, as the
-- anti-farming cap on the whole reward surface. Per-trade reflections are
-- many-per-day by nature, so storing them there would have meant weakening
-- that index. The two records answer different questions and both are kept:
-- 0070 records "did you reflect today" (a habit, capped), this records "did
-- this trade follow the plan" (evidence, uncapped because it is bounded by the
-- trades that exist).
--
-- =============================================================================
-- IMPORTED TRADES STAY REFLECTABLE — AND THIS IS LOAD-BEARING
-- =============================================================================
--
-- Import is how most real evidence arrives, so a reflection that could not be
-- written on an imported trade would defeat the feature.
--
-- 0028's `protect_imported_trade_fields` BEFORE UPDATE trigger raises on any
-- change to a NAMED TUPLE of execution columns when `source <> 'manual'`. It
-- is a whitelist of what is locked, not a blanket freeze, and its own comment
-- says so: "Journal fields (note, screenshot, tags, emotion, confidence,
-- visibility) stay editable." `reflection_outcome` and `reflection_note` are
-- not in that tuple and MUST NOT be added to it. A structural test
-- (tests/unit/trade-reflection.test.ts) reads 0028 and fails if either name
-- ever appears there.
--
-- The execution data itself is untouched: nothing here lets a user restate what
-- the broker reported. The reflection sits beside it and is entirely the user's
-- own.
--
-- =============================================================================
-- THE SENTENCE IS NOT THE NOTE
-- =============================================================================
--
-- `trades.note` is the private journal note and is a Trader perk
-- (`private_notes`, gated in actions/trade.ts). It stays one. `reflection_note`
-- is a separate, short, ungated field so that a later change to the
-- private_notes gate cannot reach into the free cycle and take the reflection
-- sentence with it. They are two columns on purpose; keep them two.
--
-- =============================================================================

alter table public.trades
  add column if not exists reflection_outcome text,
  add column if not exists reflection_note text;

-- Same vocabulary as `process_logs.outcome` (0070), on purpose: one set of
-- words for one question, so the per-trade answer can also stand as the day's
-- `rule_reflection` entry without a translation layer. 'unknown' is a
-- first-class answer here for the reason 0070 gives — paying only for
-- 'followed' pays for the answer rather than for the reflection.
alter table public.trades drop constraint if exists trades_reflection_outcome_check;
alter table public.trades add constraint trades_reflection_outcome_check
  check (reflection_outcome is null or reflection_outcome in ('followed', 'broke', 'unknown'));

-- Short by construction. The prompt asks for one sentence; a cap in the column
-- is what stops it quietly becoming a second, ungated `note` field.
alter table public.trades drop constraint if exists trades_reflection_note_len;
alter table public.trades add constraint trades_reflection_note_len
  check (reflection_note is null or char_length(reflection_note) <= 280);

-- A sentence with no answer is not a reflection, and it would make the
-- unreflected count wrong: every reader below treats `reflection_outcome is
-- null` as "not yet reflected".
alter table public.trades drop constraint if exists trades_reflection_note_needs_outcome;
alter table public.trades add constraint trades_reflection_note_needs_outcome
  check (reflection_note is null or reflection_outcome is not null);

-- The read the prompt surface makes: this user's trades still awaiting an
-- answer, newest first. Partial, so it costs nothing once a trade is answered.
create index if not exists trades_user_unreflected_idx
  on public.trades (user_id, traded_at desc)
  where reflection_outcome is null;

-- Column grants, the 0045/0067 idiom. RLS (`trades_update`, 0002/0013) says
-- WHICH ROW — still `auth.uid() = user_id`, untouched here; this says WHICH
-- COLUMN. Table-wide by nature: a grant cannot say "manual rows only", and it
-- should not, because reflecting on an imported trade is the point.
--
-- Not granted: everything else. In particular this migration does not reopen
-- any execution column, and `source` / `broker_deal_id` remain service-client
-- only exactly as 0045 left them.
grant update (reflection_outcome, reflection_note) on public.trades to authenticated;

-- `anon` gets nothing, for the reason 0045 and 0067 both give: an anonymous
-- caller owns no trade row, and `trades_update` would reject the write anyway.
