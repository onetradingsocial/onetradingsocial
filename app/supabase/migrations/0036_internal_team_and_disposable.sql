-- Internal traffic, round two (row 44).
--
-- 0035 caught e2e/test domains. This adds the remaining team accounts and
-- auto-flags disposable-mail signups, which are never real users and would
-- otherwise inflate proof stats and farm referral rewards.

-- 1) Team accounts ------------------------------------------------------------------
update public.profiles p
set is_internal = true
from auth.users u
where u.id = p.id
  and p.is_internal = false
  and lower(u.email) in (
    'maiolonathan@gmail.com',   -- Nathan (personal; the business account was covered in 0035)
    'pasaylo.ed03@gmail.com',   -- Edrian
    'edrianthelazy@gmail.com'   -- Edrian
  );

-- 2) Disposable-mail domains ----------------------------------------------------------
-- Kept as a table so the list can be extended without a code deploy.
create table if not exists public.disposable_email_domains (
  domain text primary key,
  added_at timestamptz not null default now()
);

alter table public.disposable_email_domains enable row level security; -- service role only

insert into public.disposable_email_domains (domain) values
  ('besttempmail.com'), ('temporary-mail.net'), ('tempmail.com'), ('temp-mail.org'),
  ('guerrillamail.com'), ('mailinator.com'), ('10minutemail.com'), ('yopmail.com'),
  ('throwawaymail.com'), ('sharklasers.com'), ('trashmail.com'), ('getnada.com'),
  ('dispostable.com'), ('maildrop.cc'), ('fakeinbox.com'), ('mailnesia.com')
on conflict (domain) do nothing;

-- Backfill existing signups on those domains.
update public.profiles p
set is_internal = true
from auth.users u
where u.id = p.id
  and p.is_internal = false
  and split_part(lower(u.email), '@', 2) in (select domain from public.disposable_email_domains);

-- 3) Extend the signup trigger --------------------------------------------------------
-- Test domains (0035) plus disposable domains are flagged automatically, so
-- neither the e2e suite nor throwaway signups can pollute the metrics again.
create or replace function public.flag_internal_signup()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  addr text;
  host text;
begin
  select email into addr from auth.users where id = new.id;
  if addr is null then return new; end if;
  host := split_part(lower(addr), '@', 2);

  if addr like '%@tradingsocial.io' or addr like '%.test' or addr like '%@example.com'
     or exists (select 1 from public.disposable_email_domains d where d.domain = host)
  then
    new.is_internal := true;
  end if;
  return new;
end $$;

revoke execute on function public.flag_internal_signup() from public, anon, authenticated;

drop trigger if exists profiles_flag_internal on public.profiles;
create trigger profiles_flag_internal
  before insert on public.profiles
  for each row execute function public.flag_internal_signup();
