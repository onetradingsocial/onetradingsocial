-- Pin search_path on the four functions the Supabase security advisor flags as
-- `function_search_path_mutable` (code audit, 2026-09-16).
--
-- SAFE TO APPLY IN EITHER ORDER relative to the code: no application code
-- calls these directly, and nothing about their behaviour changes. Apply by
-- hand to both projects:
--
--   production  jmpanzrjxflovdfwcbye
--   dev         sixixwutvrguqemqzvvw
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- A function without a pinned search_path resolves unqualified names against
-- whatever search_path the CALLER has. For a trigger that is the session doing
-- the write, so a role able to create objects in a schema earlier on its path
-- could shadow a name the function uses. None of these four is SECURITY
-- DEFINER, which keeps the practical risk low; this closes the advisor finding
-- rather than a live hole.
--
-- ── WHY '' AND NOT 'public' ──────────────────────────────────────────────────
--
-- The empty path is the strict form, and it is safe here because none of the
-- four bodies names a relation or a user function (checked against production
-- pg_get_functiondef on 2026-09-17):
--
--   admin_audit_no_truncate          raise exception only
--   admin_audit_retention_months     select 24
--   subscriptions_keep_first_paid    compares/assigns NEW/OLD columns only
--   weekly_reviews_touch_updated_at  now() — pg_catalog is always searched
--
-- If a later change makes any of them read a table, qualify it as public.x.
-- An unqualified name will fail loudly with "relation does not exist" rather
-- than resolve to something unexpected, which is the point.
--
-- ALTER FUNCTION ... SET does not replace the body, drop triggers, or change
-- grants, so every trigger bound to these keeps working unchanged.

alter function public.admin_audit_no_truncate()         set search_path = '';
alter function public.admin_audit_retention_months()    set search_path = '';
alter function public.subscriptions_keep_first_paid()   set search_path = '';
alter function public.weekly_reviews_touch_updated_at() set search_path = '';
