-- Exclude internal + test traffic (row 44).
--
-- The is_internal flag existed but only covered the 10 seeded demo users and
-- the admin test account. In reality the database is dominated by Playwright
-- e2e signups, which were inflating every admin metric and the public proof
-- stats. This backfills them by email domain and adds the real team accounts.

-- 1) E2E / test-domain accounts ---------------------------------------------------
-- The Playwright suite signs up on these domains; nothing real uses them.
update public.profiles p
set is_internal = true
from auth.users u
where u.id = p.id
  and p.is_internal = false
  and (
    u.email like '%@tradingsocial.io'              -- e2e default domain
    or u.email like '%.test'                       -- *.test (settings/admin/messaging specs)
    or u.email like '%@example.com'
  );

-- 2) Team + admin accounts ---------------------------------------------------------
-- Admin sessions are already flagged at event-write time via ADMIN_EMAILS, but
-- profile-based aggregates (funnels, cohorts, proof stats) need the flag too.
update public.profiles p
set is_internal = true
from auth.users u
where u.id = p.id
  and p.is_internal = false
  and lower(u.email) in (
    'onetradingsocial@gmail.com'
  );

-- 3) Keep it true going forward -----------------------------------------------------
-- New signups on a test domain are flagged automatically, so the e2e suite can
-- never re-pollute the metrics.
create or replace function public.flag_internal_signup()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  addr text;
begin
  select email into addr from auth.users where id = new.id;
  if addr is not null and (
       addr like '%@tradingsocial.io' or addr like '%.test' or addr like '%@example.com'
     ) then
    new.is_internal := true;
  end if;
  return new;
end $$;

revoke execute on function public.flag_internal_signup() from public, anon, authenticated;

drop trigger if exists profiles_flag_internal on public.profiles;
create trigger profiles_flag_internal
  before insert on public.profiles
  for each row execute function public.flag_internal_signup();
