-- Error alerting (Sprint 1, row 49): system_alerts raised by the hourly cron
-- when error/import-failure/404 counts cross thresholds. Surfaced in the admin
-- dashboard with acknowledge = issue ownership.
create table if not exists public.system_alerts (
  id bigint generated always as identity primary key,
  kind text not null,               -- client_error | import_failed | not_found | sync_error
  message text not null,
  count integer not null default 0,
  window_minutes integer not null default 60,
  acked boolean not null default false,
  acked_by uuid,
  acked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists system_alerts_open_idx
  on public.system_alerts (acked, created_at desc);

-- Deny-all RLS: cron writes and admin reads both use the service role.
alter table public.system_alerts enable row level security;
