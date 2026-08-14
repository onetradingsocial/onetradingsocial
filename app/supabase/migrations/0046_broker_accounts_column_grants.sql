-- The other half of the self-awardable "Broker connected" badge.
-- Audit item 15, finding 1 (P0). Companion to 0045; kept separate so it can be
-- reviewed or reverted on its own, because it touches a different table than
-- the one that finding was filed against.
--
-- WHY 0045 ALONE IS NOT ENOUGH
--
-- profileLevel() has TWO paths to the green tick
-- (app/src/lib/verification.ts:56):
--
--     if (brokerStatus === 'active' || counts.broker > 0) return 'broker_connected'
--
-- 0045 closed `counts.broker` by revoking trades.source. The other operand,
-- `brokerStatus`, is read straight off public.broker_accounts
-- (app/src/app/[username]/page.tsx:145-147) -- and read with the SERVICE
-- client, so it sees whatever row the user managed to write. Live grants showed
-- `authenticated` holding INSERT and UPDATE on all 13 columns of that table,
-- including `status`, with broker_accounts_insert checking only
-- `auth.uid() = user_id`. So
--
--     POST /rest/v1/broker_accounts
--     {"user_id":"<self>","login":"1","server":"x","metaapi_account_id":"x",
--      "status":"active"}
--
-- still mints the green tick on the public profile after 0045. Closing one
-- operand of an OR is not closing the check.
--
-- THE FIX -- and why it costs nothing
--
-- connectBroker (app/src/app/actions/broker.ts:36-39) is the only user-client
-- writer of this table, and it writes exactly five columns:
--
--     user_id, login, server, metaapi_account_id, region
--
-- It does NOT set `status`; it lets the column default ('pending') stand, and
-- the MT5 sync job promotes it to 'active' with the service role once a real
-- MetaApi connection has actually produced deals
-- (api/mt5-sync/collect/route.ts:67-72). That is already the correct design --
-- the grant was simply never narrowed to match it. So this revoke removes an
-- ability the application never used, which is why it needs no code change and
-- carries no deploy dependency, unlike the `source` revoke in 0045.
--
-- Service-client writers, intentionally NOT granted: status, sync_error,
-- last_sync_at, last_deal_time (api/mt5-sync/collect/route.ts:31-32,67-72).
-- Never written by application code: id, provider (default 'mt5'), created_at,
-- updated_at.
--
-- SELECT and DELETE are deliberately untouched: broker_accounts_select is
-- owner-only, and disconnectBroker (broker.ts:59) needs the delete.
--
-- NOT COVERED HERE: public.exchange_accounts has the same open grants, but it
-- is not a badge vector -- profileLevel only ever reads broker_accounts -- and
-- connectExchange (actions/exchange.ts:47) DOES set status='active' itself with
-- the user client, so narrowing it would need a code change and a deploy.
-- Filed as follow-up rather than bundled in.

revoke insert, update on public.broker_accounts from anon, authenticated;

grant insert (
  user_id,
  login,
  server,
  metaapi_account_id,
  region
) on public.broker_accounts to authenticated;

-- No UPDATE grant at all: there is no code path in which a user edits their own
-- broker connection. The flow is connect (insert) or disconnect (delete).
--
-- `anon` gets nothing back: broker_accounts_insert would reject the write
-- anyway (auth.uid() is null). It held the grant only as a table-wide default.
