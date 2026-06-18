-- Attachment type on posts
do $$ begin
  create type post_attachment as enum ('none','trade','images','poll');
exception when duplicate_object then null; end $$;

alter table public.posts
  add column if not exists attachment_type post_attachment not null default 'none',
  add column if not exists trade_id uuid references public.trades(id) on delete set null;

-- Post images
create table if not exists public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  url text not null,
  ord int not null default 0
);
create index if not exists post_images_post_idx on public.post_images(post_id, ord);
alter table public.post_images enable row level security;
drop policy if exists post_images_select on public.post_images;
create policy post_images_select on public.post_images for select using (true);
drop policy if exists post_images_insert on public.post_images;
create policy post_images_insert on public.post_images for insert
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));
drop policy if exists post_images_delete on public.post_images;
create policy post_images_delete on public.post_images for delete
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

-- Poll options
create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  label text not null,
  ord int not null default 0
);
create index if not exists poll_options_post_idx on public.poll_options(post_id, ord);
alter table public.poll_options enable row level security;
drop policy if exists poll_options_select on public.poll_options;
create policy poll_options_select on public.poll_options for select using (true);
drop policy if exists poll_options_insert on public.poll_options;
create policy poll_options_insert on public.poll_options for insert
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

-- Poll votes (one per user per poll)
create table if not exists public.poll_votes (
  post_id uuid not null references public.posts(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists poll_votes_option_idx on public.poll_votes(option_id);
alter table public.poll_votes enable row level security;
drop policy if exists poll_votes_select on public.poll_votes;
create policy poll_votes_select on public.poll_votes for select using (true);
drop policy if exists poll_votes_insert on public.poll_votes;
create policy poll_votes_insert on public.poll_votes for insert with check (user_id = auth.uid());
drop policy if exists poll_votes_update on public.poll_votes;
create policy poll_votes_update on public.poll_votes for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists poll_votes_delete on public.poll_votes;
create policy poll_votes_delete on public.poll_votes for delete using (user_id = auth.uid());
