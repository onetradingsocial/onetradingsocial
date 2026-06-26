-- conversations: one row per unordered user pair, stored in canonical (a<b) order
create table conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references profiles(id) on delete cascade,
  user_b          uuid not null references profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);
create index conversations_user_a_last on conversations (user_a, last_message_at desc);
create index conversations_user_b_last on conversations (user_b, last_message_at desc);

alter table conversations enable row level security;

-- participants may read their conversations; writes are service-role only (no write policy)
create policy "participant select" on conversations
  for select using (auth.uid() = user_a or auth.uid() = user_b);

-- messages
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid not null references profiles(id) on delete cascade,
  body            text,
  attachments     jsonb not null default '[]'::jsonb,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  check (body is not null or jsonb_array_length(attachments) > 0)
);
create index messages_conversation_created on messages (conversation_id, created_at desc);

alter table messages enable row level security;

-- participants of the parent conversation may read; writes are service-role only
create policy "participant select" on messages
  for select using (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and (auth.uid() = c.user_a or auth.uid() = c.user_b)
    )
  );

-- enable realtime for live delivery + read receipts
alter publication supabase_realtime add table messages;

-- extend notifications to support direct-message alerts
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('like','comment','follow','post_share','mention','message'));
alter table notifications drop constraint notifications_entity_type_check;
alter table notifications add constraint notifications_entity_type_check
  check (entity_type in ('post','comment','trade','conversation'));
