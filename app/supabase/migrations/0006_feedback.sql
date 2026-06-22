-- Feedback / help submissions from logged-in users.
-- Devs read the full table via the Supabase dashboard (service role bypasses RLS).
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('bug', 'feedback', 'feature', 'other')),
  message text not null check (char_length(message) between 1 and 2000),
  page_url text,
  user_agent text,
  status text not null default 'open' check (status in ('open', 'triaged', 'closed')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback(created_at desc);
create index if not exists feedback_user_idx on public.feedback(user_id, created_at desc);
create index if not exists feedback_status_idx on public.feedback(status, created_at desc);

alter table public.feedback enable row level security;

-- Users may file feedback as themselves and read only their own submissions.
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert with check (user_id = auth.uid());
drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback for select using (user_id = auth.uid());
-- No user update/delete: triage is dev-only.
