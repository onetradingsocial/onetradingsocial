-- Create notifications table
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete cascade not null,
  actor_id    uuid references profiles(id) on delete cascade not null,
  type        text not null check (type in ('like','comment','follow','post_share','mention')),
  entity_id   uuid,
  entity_type text check (entity_type in ('post','comment','trade')),
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Index for efficient queries by user and creation time
create index notifications_user_id_created_at on notifications (user_id, created_at desc);

-- Enable row level security
alter table notifications enable row level security;

-- Owner-select policy: users can only see their own notifications
create policy "owner select" on notifications
  for select using (auth.uid() = user_id);

-- Enable realtime subscriptions
alter publication supabase_realtime add table notifications;
