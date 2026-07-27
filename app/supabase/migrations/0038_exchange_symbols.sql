-- Crypto sync phase 1: the pairs to query on exchanges that need a per-symbol
-- fetch (Binance). Stored in exchange form (e.g. 'BTC/USDT').
alter table public.exchange_accounts
  add column if not exists symbols text[] not null default '{}';
