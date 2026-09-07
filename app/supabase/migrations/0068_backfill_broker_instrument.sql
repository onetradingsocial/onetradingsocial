-- Backfill: give already-imported trades the catalog spelling of their symbol.
--
-- Ships with `canonicalInstrument` in app/src/lib/mt5.ts.
--
-- DEPLOY ORDER: code first, migration second -- the opposite of 0067. The code
-- is complete without this file (every NEW import is already canonical); this
-- file is only the cleanup of rows written before it. Run it the other way
-- round and any broker sync landing between the two writes fresh raw symbols
-- behind the backfill. It is safely re-runnable, so a residue is fixable by
-- running it again rather than by hand.
--
-- =============================================================================
-- WHAT WENT WRONG
-- =============================================================================
--
-- mapDealToTrade computed a normalized symbol ('XAUUSD' -> 'XAU/USD'), spent it
-- on the pip lookup, threw it away, and persisted `instrument: deal.symbol` --
-- the raw broker string. The manual trade form writes the catalog spelling. So
-- one asset arrived under two names and everything grouped by instrument saw
-- two instruments:
--
--   * the "top instrument this month" count (app/src/app/journal/page.tsx:185)
--     and the public profile's instrument counts ([username]/page.tsx:189)
--     split one asset across two buckets;
--   * the duplicate-trade key in server/suspicion.ts (`instrument|entry_price|
--     traded_at`) could never match a hand-logged trade against its imported
--     twin, so the one shape of double-counting most worth catching was the one
--     shape it could not see;
--   * the two renderers that split a pair on '/' for display
--     ([username]/page.tsx:519, feed/_components/home/rail.tsx:118) fell back to
--     an unsplit blob for every imported row.
--
-- =============================================================================
-- WHY AN EXPLICIT MAP AND NOT THE RULE IN SQL
-- =============================================================================
--
-- canonicalInstrument() is catalog-driven: it prefers the INSTRUMENTS entry in
-- app/src/lib/instruments.ts and only slashes a 6-letter symbol outside the
-- catalog when the market is pair-shaped, so a 6-letter stock ticker is not
-- published as 'ABC/DEF'. Restating that in PL/pgSQL would mean a second copy
-- of both the rule and the catalog, free to drift from the TypeScript that
-- writes every future row.
--
-- Instead the pairs below were produced by running the real function over the
-- distinct (instrument, market) values actually present in this table. The
-- mapping is small, closed, and reviewable: what you read is exactly what will
-- be written. Regenerate it the same way if this is ever run on another
-- database.
--
--   XAUUSD / commodities -> XAU/USD   (13 rows)
--   EURUSD / forex       -> EUR/USD   ( 9 rows)
--   MGR    / stocks      -> unchanged -- 3 letters, not pair-shaped
--   VGS    / stocks      -> unchanged -- 3 letters, not pair-shaped
--
-- Only rows that actually change are listed; the two stock tickers are recorded
-- here as evidence the guard was exercised, not as no-op updates.
--
-- =============================================================================
-- THE TWO TRIGGERS THIS PASSES THROUGH
-- =============================================================================
--
-- `instrument` is inside the locked tuple of protect_imported_trade_fields()
-- (0045), which raises 'Imported execution data is locked' on any change to an
-- imported row. It returns early when auth.uid() is null, so this statement is
-- permitted from a migration and refused from any client session. Running this
-- file through PostgREST or with a user JWT therefore fails loudly rather than
-- half-applying -- which is the behaviour we want.
--
-- audit_trade_change() (0028) still fires: each row below gets a trade_audits
-- row with action='updated', changed_fields={instrument} and actor=null. That
-- is deliberate -- the rows really did change and the audit table should say
-- so. It raises no false trust flag, because the locked_field_edit rule in
-- server/suspicion.ts:117 selects `.not('actor', 'is', null)`: a null actor is
-- already understood as "not a user session". Do NOT disable the trigger to
-- keep the table tidy; the null actor is the honest record.
--
-- touch_updated_at() also fires and bumps updated_at. Nothing reads that column
-- on trades, and audit_trade_change() excludes it from changed_fields.
--
-- No explicit begin/commit: every other migration in this directory lets the
-- runner own the transaction, and nesting a COMMIT inside it would close the
-- outer transaction early. This is a single statement, so it is atomic anyway.

-- =============================================================================
-- CHECKED AGAINST PRODUCTION BEFORE WRITING
-- =============================================================================
--
-- Merging two spellings into one makes previously distinct duplicate keys
-- collide, so the duplicates rule in server/suspicion.ts was the one flag this
-- file could raise by accident. It does not: grouping every trade by
-- (user_id, instrument, entry_price, traded_at) returns the same four pairs
-- before and after the rewrite -- the XAUUSD pair is simply renamed, not
-- created. No user gains a duplicates flag from this migration.
--
-- The predicate below was dry-run as a SELECT first: 22 rows, 2 users,
-- 13 XAUUSD + 9 EURUSD, matching the counts listed above.

with canonical(raw, mkt, canon) as (
  values
    ('XAUUSD', 'commodities', 'XAU/USD'),
    ('EURUSD', 'forex',       'EUR/USD')
)
update public.trades t
   set instrument = c.canon
  from canonical c
 where t.instrument = c.raw
   and t.market::text = c.mkt
   -- Importer-written rows only. A manual row holding the same string was
   -- typed by its owner, and rewriting a user's own text is not this file's
   -- business; the code change does not touch that path either.
   and t.broker_deal_id is not null;
