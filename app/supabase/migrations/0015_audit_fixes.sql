-- Audit fixes (2026-07-13):
-- 1. auth_rls_initplan: wrap auth.uid() in (select auth.uid()) so it is
--    evaluated once per statement instead of once per row.
-- 2. Covering indexes for unindexed foreign keys.
-- 3. Lock down handle_new_user(): trigger-only, not callable via PostgREST rpc.

-- 1) RLS initplan fixes -------------------------------------------------------

alter policy broker_accounts_select on public.broker_accounts
  using ((select auth.uid()) = user_id);
alter policy broker_accounts_insert on public.broker_accounts
  with check ((select auth.uid()) = user_id);
alter policy broker_accounts_delete on public.broker_accounts
  using ((select auth.uid()) = user_id);

alter policy trade_templates_select on public.trade_templates
  using (user_id = (select auth.uid()));
alter policy trade_templates_insert on public.trade_templates
  with check (user_id = (select auth.uid()));
alter policy trade_templates_delete on public.trade_templates
  using (user_id = (select auth.uid()));

alter policy favorites_select on public.favorites
  using (user_id = (select auth.uid()));
alter policy favorites_insert on public.favorites
  with check (user_id = (select auth.uid()));
alter policy favorites_delete on public.favorites
  using (user_id = (select auth.uid()));

-- 2) Covering indexes for foreign keys ---------------------------------------

create index if not exists conversations_requester_id_idx
  on public.conversations (requester_id);
create index if not exists favorites_favorite_id_idx
  on public.favorites (favorite_id);
create index if not exists profiles_pinned_post_id_idx
  on public.profiles (pinned_post_id);

-- 3) handle_new_user is a trigger function; nobody should call it over rpc ---

revoke execute on function public.handle_new_user() from public, anon, authenticated;
