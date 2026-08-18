-- Durable, cross-instance rate limiting. Audit item 10, findings 2, 3 and 8.
--
-- ***************************************************************************
-- ** NOT APPLIED. Hand this to the owner and apply it WITH the WS8 deploy.  **
-- ***************************************************************************
--
-- WHY THIS EXISTS
--
-- `app/src/lib/server/rate-limit.ts` keeps its buckets in a module-level Map.
-- On Vercel that means one Map per warm serverless instance, wiped on every
-- cold start. The effective ceiling is (number of warm instances) x (configured
-- limit), which is unpredictable, unbounded under load, and resets constantly.
-- The file has always said so in its own header comment, so this is a known
-- trade-off rather than an oversight -- but five routes rely on it as their
-- only abuse control, and WS2 explicitly deferred the durable store to WS8.
--
-- The sharpest case is `POST /api/track`, which is UNAUTHENTICATED, writes to
-- `analytics_events` through the service client, and picked its rate-limit
-- bucket from a client-supplied `anonId` (item 10 finding 3). A caller sending
-- a fresh random anonId per request landed in a fresh bucket every time, so the
-- 60/60s limit never fired at all. Unbounded rows, poisoned funnel data, and
-- `api/cron/error-alert` weaponisable into alert spam on demand.
--
-- WHAT THIS DOES *NOT* CLAIM
--
-- This is a counter in the same Postgres the app already writes to. It is not
-- Redis, it is not edge-local, and it costs one round trip per limited request.
-- It is used ONLY on the routes where per-instance counting is genuinely
-- useless: the unauthenticated write endpoint and the two routes that burn a
-- shared third-party quota. The per-user convenience limits on the storage and
-- checkout routes keep the in-process limiter, because there the failure mode
-- is one signed-in account being noisy, not an abuse vector.
--
-- The TypeScript caller FAILS OPEN to the in-process limiter when this function
-- is missing or the query errors. That is deliberate on both counts: it lets
-- the app deploy before the migration is applied (same pattern as
-- 0055_analytics_retention.sql), and it means a database hiccup degrades the
-- throttle rather than 500-ing every request that passes through it. The
-- honest reading is: with this applied, the limit is real and shared; without
-- it, behaviour is exactly what it is today.

begin;

create table if not exists public.rate_limit_buckets (
  key           text primary key,
  count         integer     not null default 0,
  window_start  timestamptz not null default now(),
  expires_at    timestamptz not null
);

comment on table public.rate_limit_buckets is
  'Audit item 10 F8. Cross-instance fixed-window rate-limit counters. Written '
  'only by public.consume_rate_limit(); service_role only; no client role has '
  'any business reading it (it enumerates caller IPs and anon ids).';

-- Service-role only, twice over: RLS on with zero policies is the deny-all
-- floor for any role without BYPASSRLS, and the explicit revoke removes
-- Supabase's default GRANT ALL to the client roles so the grant is not merely
-- unreachable but absent. Item 8 F6 asked for exactly this belt-and-braces on
-- service-role-only tables.
alter table public.rate_limit_buckets enable row level security;
revoke all on table public.rate_limit_buckets from anon, authenticated;

-- Sweeping expired rows needs this; the primary key covers the hot path.
create index if not exists rate_limit_buckets_expires_idx
  on public.rate_limit_buckets (expires_at);

-- ---------------------------------------------------------------------------
-- consume_rate_limit(key, max, window_ms) -> (allowed, retry_after_seconds)
-- ---------------------------------------------------------------------------
--
-- Fixed window, not sliding. A fixed window lets a caller send 2x the limit
-- across a window boundary, which is the classic objection to it -- and it is
-- the right trade here: it is one statement, it needs no per-request history,
-- and the threat being defended against is bulk abuse, not a precisely-timed
-- burst. A sliding window would cost a row per request in the same table this
-- exists to stop filling up.
--
-- The whole thing is a single INSERT ... ON CONFLICT DO UPDATE, so concurrent
-- callers serialise on the row lock and the count cannot be lost to a race the
-- way a read-then-write would.

create or replace function public.consume_rate_limit(
  p_key       text,
  p_max       integer,
  p_window_ms integer
)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w        interval := make_interval(secs => greatest(p_window_ms, 1) / 1000.0);
  new_count integer;
  new_start timestamptz;
begin
  -- Opportunistic garbage collection, ~1 call in 200. Keeps the table bounded
  -- without needing a cron entry of its own (Vercel Hobby has none to spare).
  if random() < 0.005 then
    delete from public.rate_limit_buckets where expires_at < now() - interval '1 hour';
  end if;

  insert into public.rate_limit_buckets as t (key, count, window_start, expires_at)
  values (p_key, 1, now(), now() + w)
  on conflict (key) do update
     set count        = case when t.window_start + w <= now() then 1        else t.count + 1     end,
         window_start = case when t.window_start + w <= now() then now()    else t.window_start  end,
         expires_at   = case when t.window_start + w <= now() then now() + w else t.expires_at   end
  returning t.count, t.window_start into new_count, new_start;

  if new_count > p_max then
    return query
      select false,
             greatest(1, ceil(extract(epoch from (new_start + w - now())))::integer);
  else
    return query select true, 0;
  end if;
end;
$$;

comment on function public.consume_rate_limit(text, integer, integer) is
  'Audit item 10 F3/F8. Consumes one token from a fixed-window bucket and '
  'returns whether the caller is allowed plus a Retry-After in seconds. '
  'Called from app/src/lib/server/rate-limit.ts; service_role only.';

revoke execute on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- purge_rate_limits() -- deterministic sweep, for the daily cron
-- ---------------------------------------------------------------------------
-- The opportunistic delete above is enough in steady state. This exists so the
-- daily lifecycle route can guarantee the table is swept even if traffic dries
-- up, and so a human has one thing to run if it ever grows unexpectedly.

create or replace function public.purge_rate_limits(older_than_hours integer default 1)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare removed integer;
begin
  delete from public.rate_limit_buckets
   where expires_at < now() - make_interval(hours => older_than_hours);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.purge_rate_limits(integer) from public, anon, authenticated;
grant execute on function public.purge_rate_limits(integer) to service_role;

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying, against jmpanzrjxflovdfwcbye)
--
--   -- allowed twice, refused on the third:
--   select * from public.consume_rate_limit('verify:ws8', 2, 60000);  -- t, 0
--   select * from public.consume_rate_limit('verify:ws8', 2, 60000);  -- t, 0
--   select * from public.consume_rate_limit('verify:ws8', 2, 60000);  -- f, <=60
--   delete from public.rate_limit_buckets where key = 'verify:ws8';
--
--   -- client roles must be shut out entirely:
--   select has_function_privilege('anon', 'public.consume_rate_limit(text,integer,integer)', 'execute');  -- f
--   select has_table_privilege('anon', 'public.rate_limit_buckets', 'select');                            -- f
--
-- ROLLBACK
--
--   drop function if exists public.consume_rate_limit(text, integer, integer);
--   drop function if exists public.purge_rate_limits(integer);
--   drop table if exists public.rate_limit_buckets;
--
-- Rolling back is safe at any time: the application falls back to the
-- in-process limiter the moment the function stops existing.
-- ---------------------------------------------------------------------------
