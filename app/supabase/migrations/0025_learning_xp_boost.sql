-- XP boosts for learning streaks (Trader+ pricing row): bonus XP granted at
-- lesson completion when the learner is on a consecutive-day streak. Stored on
-- the completion row so earned boosts persist across tier changes and flow
-- into every XP read (level, achievements, XP leaderboard) without
-- entitlement lookups at read time.
alter table public.lesson_completions
  add column if not exists bonus_xp integer not null default 0;
