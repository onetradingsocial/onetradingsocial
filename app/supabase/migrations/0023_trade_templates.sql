-- Custom journal templates (Pro pricing row): named presets of the trade
-- modal's fields (market, instrument, direction, sizing, setup, tags) that
-- prefill the form. Owner-only via RLS.
create table if not exists public.trade_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists trade_templates_user_idx on public.trade_templates(user_id, created_at desc);

alter table public.trade_templates enable row level security;
drop policy if exists trade_templates_select on public.trade_templates;
create policy trade_templates_select on public.trade_templates
  for select using (user_id = auth.uid());
drop policy if exists trade_templates_insert on public.trade_templates;
create policy trade_templates_insert on public.trade_templates
  for insert with check (user_id = auth.uid());
drop policy if exists trade_templates_delete on public.trade_templates;
create policy trade_templates_delete on public.trade_templates
  for delete using (user_id = auth.uid());
