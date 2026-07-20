-- Referral programme (Backlog row 39).
--
-- Tracks the full funnel: link created -> clicks -> signup -> ACTIVATED -> paid.
-- Rewards are earned on activation, never on raw signups, and are non-cash
-- (premium time, badge, early access) — per the spec, no cash incentives until
-- abuse controls are proven.

-- 1) One referral code per user -------------------------------------------------
create table if not exists public.referral_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique check (char_length(code) between 4 and 24),
  created_at timestamptz not null default now()
);
create index if not exists referral_codes_code_idx on public.referral_codes (lower(code));

alter table public.referral_codes enable row level security;
-- Owners read their own code. Code->referrer resolution at signup happens
-- service-side, so no public select policy is needed.
drop policy if exists referral_codes_select on public.referral_codes;
create policy referral_codes_select on public.referral_codes
  for select to authenticated using ((select auth.uid()) = user_id);

-- 2) Link clicks ------------------------------------------------------------------
-- Written by the /r/<code> route (service role). anon_id lets us count unique-ish
-- clicks without storing IPs.
create table if not exists public.referral_clicks (
  id bigint generated always as identity primary key,
  code text not null,
  anon_id text,
  created_at timestamptz not null default now()
);
create index if not exists referral_clicks_code_idx on public.referral_clicks (code, created_at desc);

alter table public.referral_clicks enable row level security; -- deny-all: service role only

-- 3) The referral itself ----------------------------------------------------------
create table if not exists public.referrals (
  id bigint generated always as identity primary key,
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  -- one referrer per referred user, ever: the PK-style unique guard is the
  -- primary anti-gaming control.
  referred_user_id uuid not null unique references public.profiles(id) on delete cascade,
  code text not null,
  status text not null default 'signed_up' check (status in ('signed_up', 'activated', 'paid')),
  activated_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  -- self-referral is rejected at the database level, not just in app code
  constraint referrals_no_self check (referrer_id <> referred_user_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id, status);

alter table public.referrals enable row level security;
-- Referrers see their own referrals. Deliberately no join to the referred
-- user's identity in the client policy — the UI shows counts, not people.
drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals
  for select to authenticated using ((select auth.uid()) = referrer_id);
