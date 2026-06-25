-- Phase 8: Stripe billing. Stripe customer id, learning tier gate, and the
-- subscription mirror (written ONLY by the webhook via the service role).

alter table public.profiles
  add column if not exists stripe_customer_id text unique;

alter table public.courses
  add column if not exists min_tier text not null default 'free';
-- 'free' | 'trader' | 'pro'

create table if not exists public.subscriptions (
  id text primary key,                         -- Stripe subscription id
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null,                        -- active, trialing, past_due, canceled, ...
  tier text not null,                          -- 'trader' | 'pro'
  price_id text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions(user_id);

alter table public.subscriptions enable row level security;
-- Owner reads own subscription; NO insert/update/delete policy -> service role only.
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();
