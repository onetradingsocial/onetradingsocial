-- Favourite traders: a private, stronger tier on top of follows.
-- Unlike follows (public select), favourites are viewer-only.
create table if not exists public.favorites (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  favorite_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, favorite_id),
  constraint favorites_no_self check (user_id <> favorite_id)
);
create index if not exists favorites_user_idx on public.favorites(user_id);
alter table public.favorites enable row level security;
drop policy if exists favorites_select on public.favorites;
create policy favorites_select on public.favorites for select using (user_id = auth.uid());
drop policy if exists favorites_insert on public.favorites;
create policy favorites_insert on public.favorites for insert with check (user_id = auth.uid());
drop policy if exists favorites_delete on public.favorites;
create policy favorites_delete on public.favorites for delete using (user_id = auth.uid());
