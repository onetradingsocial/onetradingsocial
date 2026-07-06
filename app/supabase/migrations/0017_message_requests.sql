-- message requests: conversations between non-mutual followers start as a
-- pending request the recipient must accept; mutual-follow pairs skip straight
-- to accepted. Existing conversations (pre-feature) are grandfathered accepted.
alter table conversations
  add column status text not null default 'accepted'
    check (status in ('pending', 'accepted')),
  add column requester_id uuid references profiles(id) on delete set null;
