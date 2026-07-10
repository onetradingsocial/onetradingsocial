-- Leaderboard placement options (Pro pricing row): Pro users can hide
-- themselves from public leaderboards while keeping their profile public.
alter table public.profiles
  add column if not exists leaderboard_optout boolean not null default false;
