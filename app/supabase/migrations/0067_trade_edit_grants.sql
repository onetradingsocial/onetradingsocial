-- Column-level UPDATE grants for editing a manually logged trade.
--
-- Ships with `updateTrade` in app/src/app/actions/trade.ts.
--
-- DEPLOY ORDER: migration first, code second -- the opposite of 0053. This one
-- is not an additive restriction, it is the permission the feature needs. The
-- code without the migration is not merely unenforced, it is broken: PostgREST
-- rejects the whole statement with "permission denied for column ... of
-- relation trades" the moment a user presses Save, and nothing is written.
-- The migration without the code is inert.
--
-- =============================================================================
-- WHAT WAS MISSING
-- =============================================================================
--
-- 0045 revoked the table-wide UPDATE default from `authenticated` and granted
-- back only the columns application code actually wrote at the time: the close
-- path (exit_price, risk_amount, r_multiple, pnl_amount, realized_pips,
-- outcome, status, closed_at), the chart upload (screenshot_url) and mistake
-- tagging (mistake_tags). Its own comment, at 0045:111-116, names this feature
-- and this file:
--
--     "Deliberately NOT granted on UPDATE, though a future 'edit trade'
--      feature will want them back: market, instrument, direction,
--      entry_price, stop_price, target_price, sizing_mode, risk_percent, lots,
--      sl_pips, tp_pips, planned_rr, setup_type, confidence, emotion, note,
--      is_public, strategy_tags. 0028's execution-field lock already
--      contemplates journal fields staying editable, so when that feature
--      ships, add the journal subset here -- not the execution one."
--
-- The feature has shipped, and it wants more than the journal subset. The
-- execution columns are the easy half of that argument; `traded_at`, which
-- 0045 held back separately and for a different reason, is not, and it gets
-- its own section below.
--
-- =============================================================================
-- WHY THE EXECUTION COLUMNS ARE SAFE TO OPEN, AND WHAT STILL HOLDS THE LINE
-- =============================================================================
--
-- The grant is a table-wide capability; it cannot say "only on manual rows".
-- That distinction is not lost, because it was never the grant's job:
--
--   * 0028's `protect_imported_trade_fields` BEFORE UPDATE trigger raises on
--     any change to an execution column of a row whose `source` is not
--     'manual'. It is unchanged by this migration and it remains the control.
--     A broker-synced or statement-imported trade stays exactly as locked
--     after this grant as before it -- the grant lets the statement be
--     attempted, the trigger decides whether it lands. `traded_at` is in the
--     trigger's locked tuple, so nothing below opens an imported trade's date.
--
--   * `trades_update` (0002, tightened in 0013) still scopes every UPDATE to
--     `auth.uid() = user_id`. Untouched here. This is a grant change only.
--
--   * For a MANUAL row, none of these columns is a claim about anything but
--     the user's own self-reported trade, and INSERT already grants every one
--     of them (0045:122-151). A user who can log any entry price they like has
--     gained nothing by being able to correct one. The derived columns
--     (sl_pips, tp_pips, planned_rr) are recomputed server-side on every edit
--     from the inputs, so granting them does not create a channel for writing
--     a planned R:R that does not follow from the prices beside it -- the same
--     position INSERT has always been in.
--
--   * `updateTrade` never uses the service client. That matters: the service
--     role is how 0028's trigger lets sync jobs correct imported data
--     (`auth.uid() is null` returns early), and routing a USER edit through it
--     would hand every user that escape hatch. The user client + this grant is
--     the whole point.
--
-- NOT granted, and still not writable by a user through any code path:
-- user_id (the row's owner is fixed at insert), source and broker_deal_id (the
-- provenance 0045 exists to protect -- service-client writers only), id,
-- created_at, updated_at.
--
-- =============================================================================
-- traded_at: A RISK REVIEWED AND ACCEPTED, NOT A RISK CLOSED
-- =============================================================================
--
-- Read this section before assuming the column is defended. It is not. 0045
-- withheld it for a specific reason, that reason is still true, and the
-- product decided to accept it anyway so that users can correct the date of a
-- trade they logged. This is written down so nobody later reads the grant as
-- evidence that somebody had solved the problem.
--
-- THE RISK, from 0045:106-110, unchanged and undefended:
--
--     "`traded_at` is granted on INSERT but NOT on UPDATE: no code path
--      re-dates a trade, and leaving UPDATE open let a user PATCH traded_at to
--      slide a losing trade out of the rolling leaderboard window
--      (lib/leaderboard.ts:121-125) or to farm retroactive XP day/week buckets
--      (lib/xp.ts:111-124)."
--
-- Both of those reads are still live and neither has grown a defence. Note
-- that this is NOT the same exposure the INSERT grant already carries.
-- Back-dating a NEW trade puts an unknown result into a bucket it was never
-- in. Re-dating an EXISTING one moves a KNOWN result -- a settled loss, whose
-- outcome the user can already see -- out of a window it is currently counted
-- in. The second is the profitable direction, and it is the one this migration
-- opens. That is the trade being made: a real correction workflow for honest
-- users, in exchange for a cheap and deliberate way to launder a bad week off
-- a rolling board.
--
-- WHAT ACTUALLY REMAINS, and what each control is worth:
--
--   1. PREVENTIVE -- the future-date rejection in `parseTradeForm`, which the
--      edit path shares with `createTrade` (60s of clock-skew slack). A date
--      may be moved around within the past; it can never be moved into the
--      future. This is what stops a fabricated 2031 entry from topping the
--      public board, and it is the only thing standing between this grant and
--      that outcome, so do not remove it from the edit path.
--
--   2. PREVENTIVE -- manual-only scope. 0028's trigger still refuses any
--      change to `traded_at` on a non-'manual' row, so broker-synced and
--      statement-imported dates cannot move. Verified trades are unaffected by
--      this decision.
--
--   3. DETECTIVE ONLY -- the `trade_audits` trail from 0028. Its UPDATE branch
--      diffs old against new and records `traded_at` in `changed_fields`, with
--      both the old and the new value, on every edit, keyed to the acting
--      `auth.uid()`. Be clear about what that does and does not buy: it means
--      a re-dated trade can be FOUND AFTERWARDS by someone who goes looking.
--      It does not stop the write, it does not flag the row, nothing on any
--      leaderboard path reads it, and no alerting sits on top of it today. It
--      is evidence for an investigation, not a control.
--
-- If leaderboard integrity later needs a real answer here, the shapes worth
-- considering are freezing `traded_at` once a trade has been counted in a
-- settled ranking period, or excluding a row from board windows for some
-- period after its date changes. Neither exists. Until one does, the honest
-- description of this column is: editable by its owner, within the past,
-- logged after the fact.
--
-- Idempotent and re-runnable: `grant` is declarative and additive, so this
-- composes with 0045's grant rather than replacing it. The ten columns 0045
-- already granted are not restated -- restating them here would create a
-- second place to keep in sync.
-- =============================================================================

grant update (
  -- Execution inputs. Locked on non-manual rows by 0028's trigger, not by the
  -- absence of a grant.
  market,
  instrument,
  direction,
  sizing_mode,
  entry_price,
  stop_price,
  target_price,
  risk_percent,
  lots,
  -- Derived from the inputs above; recomputed server-side on every edit.
  sl_pips,
  tp_pips,
  planned_rr,
  -- See the traded_at section above. An accepted risk, not a closed one.
  traded_at,
  -- The journal subset 0028 always intended to stay editable, on imported
  -- trades as well as manual ones.
  setup_type,
  confidence,
  emotion,
  note,
  strategy_tags,
  is_public
) on public.trades to authenticated;

-- `anon` gets nothing, for the reason 0045 gave: an anonymous caller owns no
-- trade row, and `trades_update` would reject the write anyway.
