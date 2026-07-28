-- Admin user directory v2: account/subscription/comp filters + fuzzy search.
-- Signature changes (adds filter params + is_internal column), so drop the old
-- 0039 function first. pg_trgm + trigram indexes on username/display_name
-- already exist (migration 0011).
drop function if exists public.admin_search_users(text, int, int);

create or replace function public.admin_search_users(
  term text,
  p_account text,   -- 'all' | 'real' | 'test'
  p_sub text,       -- 'any' | 'free' | 'trader' | 'pro'
  p_comp text,      -- 'any' | 'comped' | 'not'
  lim int,
  off int
)
returns table (
  id uuid,
  username text,
  display_name text,
  email text,
  created_at timestamptz,
  comp_tier text,
  sub_tier text,
  sub_status text,
  is_internal boolean
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
    s.status as sub_status,
    (p.is_internal or u.email ilike '%@tradingsocial.io') as is_internal
  from public.profiles p
  join auth.users u on u.id = p.id
  left join lateral (
    select tier, status
    from public.subscriptions
    where user_id = p.id and status in ('active', 'trialing')
    order by case tier when 'pro' then 2 when 'trader' then 1 else 0 end desc
    limit 1
  ) s on true
  where
    (
      coalesce(term, '') = ''
      or u.email ilike '%' || term || '%'
      or p.username ilike '%' || term || '%'
      or coalesce(p.display_name, '') ilike '%' || term || '%'
      or word_similarity(term, p.username::text) > 0.3
      or word_similarity(term, coalesce(p.display_name, '')) > 0.3
    )
    and (
      p_account not in ('real', 'test')
      or (p_account = 'test' and (p.is_internal or u.email ilike '%@tradingsocial.io'))
      or (p_account = 'real' and not (p.is_internal or u.email ilike '%@tradingsocial.io'))
    )
    and (
      p_sub not in ('free', 'trader', 'pro')
      or (p_sub = 'free' and s.tier is null)
      or (p_sub = 'trader' and s.tier = 'trader')
      or (p_sub = 'pro' and s.tier = 'pro')
    )
    and (
      p_comp not in ('comped', 'not')
      or (p_comp = 'comped' and p.comp_tier is not null)
      or (p_comp = 'not' and p.comp_tier is null)
    )
  order by
    case when coalesce(term, '') = '' then 0
         else greatest(
           word_similarity(term, p.username::text),
           word_similarity(term, coalesce(p.display_name, ''))
         ) end desc,
    p.created_at desc
  limit lim offset off
$$;

revoke all on function public.admin_search_users(text, text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.admin_search_users(text, text, text, text, int, int) to service_role;
