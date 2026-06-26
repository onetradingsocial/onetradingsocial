-- Full-text search column on posts (stored generated — auto-maintained, no trigger)
alter table posts
  add column body_tsv tsvector
  generated always as (to_tsvector('english', coalesce(body, ''))) stored;

create index posts_body_tsv_idx on posts using gin (body_tsv);

-- Trigram indexes for fast user substring (ILIKE) match
create extension if not exists pg_trgm;
create index profiles_username_trgm on profiles using gin (username gin_trgm_ops);
create index profiles_display_name_trgm on profiles using gin (display_name gin_trgm_ops);
