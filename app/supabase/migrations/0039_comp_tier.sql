-- Comp-tier grants: admins can grant a user Trader/Pro features without payment.
-- Independent of Stripe; never grants admin access (that's ADMIN_EMAILS only).
alter table public.profiles
  add column if not exists comp_tier text
  check (comp_tier in ('trader', 'pro'));

comment on column public.profiles.comp_tier is
  'Admin-granted comp tier (trader|pro). NULL = none. Combined with Stripe tier by higher rank in getTier().';

-- Admin user directory. Email lives in auth.users (unreachable via PostgREST),
-- so this security-definer function joins it in. Returns the highest
-- active/trialing subscription tier alongside the comp grant.
-- Service-role only: execute is revoked from all client roles.
create or replace function public.admin_search_users(term text, lim int, off int)
returns table (
  id uuid,
  username text,
  display_name text,
  email text,
  created_at timestamptz,
  comp_tier text,
  sub_tier text,
  sub_status text
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.username::text,
    p.display_name,
    u.email::text,
    p.created_at,
    p.comp_tier,
    s.tier as sub_tier,
    s.status as sub_status
  from public.profiles p
  join auth.users u on u.id = p.id
  left join lateral (
    select tier, status
    from public.subscriptions
    where user_id = p.id and status in ('active', 'trialing')
    order by case tier when 'pro' then 2 when 'trader' then 1 else 0 end desc
    limit 1
  ) s on true
  where coalesce(term, '') = ''
     or u.email ilike '%' || term || '%'
     or p.username ilike '%' || term || '%'
     or coalesce(p.display_name, '') ilike '%' || term || '%'
  order by p.created_at desc
  limit lim offset off
$$;

revoke all on function public.admin_search_users(text, int, int) from public, anon, authenticated;
