-- MT5 manual import (phase 1): external dedupe key + optional stop.
-- broker_deal_id = MT5 position ticket. Unique per user; NULLs (manual
-- trades) are distinct so the index does not constrain them.
alter table public.trades
  add column if not exists broker_deal_id text;

create unique index if not exists trades_user_broker_deal_idx
  on public.trades (user_id, broker_deal_id);

-- Imported MT5 trades often carry no stop loss.
alter table public.trades
  alter column stop_price drop not null;
