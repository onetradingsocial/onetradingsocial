-- /admin/users must not label a paying customer "Trialing".
--
-- Safe to apply at any time, in any order relative to 0076 and 0077. This is a
-- read-only SECURITY DEFINER function with no schema change behind it, so
-- applying it early costs nothing and applying it late only leaves the existing
-- ambiguity in place a little longer.
--
-- APPLY BY HAND TO BOTH PROJECTS:
--   production  jmpanzrjxflovdfwcbye
--   dev         sixixwutvrguqemqzvvw
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────────
--
-- Exactly one line: the lateral join that picks a user's representative
-- subscription gains a second ORDER BY term, preferring `active` over
-- `trialing` at the same tier.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- `sub_status` is no longer cosmetic. lib/admin-users.ts now reads it to decide
-- whether the tier came from money ('Paid') or from a trial ('Trialing'), so
-- whichever row this lateral join happens to return NAMES THE SOURCE in the
-- admin directory.
--
-- The existing ordering breaks ties on tier alone. A user holding two rows in
-- the active set at the same tier — someone who resubscribed after cancelling,
-- or who upgraded onto a new subscription mid-trial — gets whichever row
-- Postgres returns first, which is not deterministic. A paying customer can
-- therefore be shown as "Trialing", and the label can change between page loads
-- without anything having changed.
--
-- That direction understates revenue rather than overstating it, so it is the
-- safer of the two mistakes, but it is still a wrong answer arrived at by
-- chance. app/src/app/admin/users/[id]/page.tsx sorts the same rows in
-- application code and now carries the identical tiebreak; this keeps the list
-- and the detail page from disagreeing about the same account.
--
-- ── CRITICAL, THE 0041 LESSON ────────────────────────────────────────────────
--
-- This is a full CREATE OR REPLACE, so the body below is the WHOLE function and
-- silently drops anything not repeated in it. It is 0040's body verbatim —
-- verified on 2026-09-15 against the live definition on production via
-- pg_get_functiondef, which matched 0040 with no drift — plus the one added
-- ORDER BY term. The filters (p_account, p_sub, p_comp), the trigram ranking
-- and the pagination are all reproduced unchanged.

create or replace function public.admin_search_users(
  term text, p_account text, p_sub text, p_comp text, lim integer, off integer
)
returns table(
  id uuid, username text, display_name text, email text,
  created_at timestamptz, comp_tier text, sub_tier text, sub_status text,
  is_internal boolean
)
language sql
security definer
set search_path to 'public'
as $function$
  select
    p.id,
    p.username::text,
    p.display_name,
    u.email::text,
    p.created_at,
    p.comp_tier,
    s.tier as sub_tier,
    s.status as sub_status,
    (p.is_internal or coalesce(u.email, '') ilike '%@tradingsocial.io') as is_internal
  from public.profiles p
  join auth.users u on u.id = p.id
  left join lateral (
    select tier, status
    from public.subscriptions
    where user_id = p.id and status in ('active', 'trialing')
    order by
      case tier when 'pro' then 2 when 'trader' then 1 else 0 end desc,
      -- THE CHANGE: money outranks a trial at the same tier, so `sub_status`
      -- cannot label a paying customer 'Trialing' by accident.
      case status when 'active' then 1 else 0 end desc
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
      coalesce(p_account, 'all') not in ('real', 'test')
      or (p_account = 'test' and (p.is_internal or coalesce(u.email, '') ilike '%@tradingsocial.io'))
      or (p_account = 'real' and not (p.is_internal or coalesce(u.email, '') ilike '%@tradingsocial.io'))
    )
    and (
      coalesce(p_sub, 'any') not in ('free', 'trader', 'pro')
      or (p_sub = 'free' and s.tier is null)
      or (p_sub = 'trader' and s.tier = 'trader')
      or (p_sub = 'pro' and s.tier = 'pro')
    )
    and (
      coalesce(p_comp, 'any') not in ('comped', 'not')
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
$function$;

-- ── VERIFY (expect true) ─────────────────────────────────────────────────────
--
-- select pg_get_functiondef(p.oid) like '%case status when ''active'' then 1 else 0 end desc%'
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'admin_search_users';
