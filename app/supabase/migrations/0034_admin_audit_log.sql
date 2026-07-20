-- Admin action audit log (row 52 — "audit logs").
--
-- Trades already have an immutable trail (0028). This closes the other half:
-- every privileged admin action is recorded, so moderation and configuration
-- changes are traceable after the fact.
create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text,                 -- denormalised: survives profile deletion
  action text not null,             -- e.g. 'feature_flag.set', 'feedback.status'
  target_type text,                 -- 'feature' | 'feedback' | 'course' | ...
  target_id text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);
create index if not exists admin_audit_actor_idx on public.admin_audit (actor_id, created_at desc);
create index if not exists admin_audit_action_idx on public.admin_audit (action, created_at desc);

-- Deny-all RLS: written and read via the service role from admin surfaces only.
-- No client should ever reach this table directly.
alter table public.admin_audit enable row level security;
