-- Save OAuth (Google) profile photo + name into profiles on signup.

-- Updated trigger: copy avatar_url/picture and full_name from OAuth metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uname text;
begin
  uname := coalesce(
    new.raw_user_meta_data->>'username',
    'user_' || substr(new.id::text, 1, 8)
  );
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    uname,
    new.raw_user_meta_data->>'full_name',
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    )
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- One-time backfill: existing OAuth users whose profile has no avatar yet.
update public.profiles p
set avatar_url = coalesce(
      u.raw_user_meta_data->>'avatar_url',
      u.raw_user_meta_data->>'picture'
    )
from auth.users u
where u.id = p.id
  and p.avatar_url is null
  and coalesce(
        u.raw_user_meta_data->>'avatar_url',
        u.raw_user_meta_data->>'picture'
      ) is not null;
