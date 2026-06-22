-- Learning Hub: courses, lessons, quizzes, completions.

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  summary text,
  difficulty text,
  ord int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.courses enable row level security;
drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses for select to authenticated using (true);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  slug text not null,
  title text not null,
  body text not null,
  ord int not null default 0,
  xp_reward int not null default 100,
  created_at timestamptz not null default now(),
  unique (course_id, slug)
);
create index if not exists lessons_course_idx on public.lessons(course_id, ord);
alter table public.lessons enable row level security;
drop policy if exists lessons_select on public.lessons;
create policy lessons_select on public.lessons for select to authenticated using (true);

-- Quiz tables: NO select policy for authenticated -> readable only via service role.
create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  prompt text not null,
  ord int not null default 0
);
create index if not exists quiz_questions_lesson_idx on public.quiz_questions(lesson_id, ord);
alter table public.quiz_questions enable row level security;

create table if not exists public.quiz_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  label text not null,
  is_correct boolean not null default false,
  ord int not null default 0
);
create index if not exists quiz_options_question_idx on public.quiz_options(question_id, ord);
alter table public.quiz_options enable row level security;

create table if not exists public.lesson_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);
create index if not exists lesson_completions_user_idx on public.lesson_completions(user_id);
alter table public.lesson_completions enable row level security;
-- Select allowed (leaderboard aggregation); NO insert/update/delete -> only service role writes.
drop policy if exists lesson_completions_select on public.lesson_completions;
create policy lesson_completions_select on public.lesson_completions for select to authenticated using (true);

-- Seed content (idempotent on slug). Two starter courses.
insert into public.courses (slug, title, summary, difficulty, ord) values
  ('foundations', 'Trading Foundations', 'Core concepts every trader needs before risking a cent.', 'beginner', 1),
  ('risk', 'Risk Management', 'Protect your capital: position sizing, R-multiples, and stops.', 'intermediate', 2)
on conflict (slug) do nothing;

-- Foundations lessons
with c as (select id from public.courses where slug = 'foundations')
insert into public.lessons (course_id, slug, title, body, ord, xp_reward)
select c.id, v.slug, v.title, v.body, v.ord, 100 from c, (values
  ('what-is-a-trade', 'What Is a Trade?', '<p>A trade is a single decision to buy or sell an instrument with a defined entry, stop, and target. Logging every trade turns gut feeling into measurable edge.</p><p>The journal is where intuition becomes data.</p>', 1),
  ('reading-candles', 'Reading Candles', '<p>Each candle shows open, high, low, and close for a period. The body is open-to-close; the wicks are the extremes. Long wicks signal rejection of price.</p>', 2)
) as v(slug, title, body, ord)
on conflict (course_id, slug) do nothing;

-- Risk lessons
with c as (select id from public.courses where slug = 'risk')
insert into public.lessons (course_id, slug, title, body, ord, xp_reward)
select c.id, v.slug, v.title, v.body, v.ord, 100 from c, (values
  ('position-sizing', 'Position Sizing', '<p>Risk a fixed small percent of your account per trade (commonly 1%). Position size follows from your stop distance — never the other way around.</p>', 1),
  ('r-multiples', 'R-Multiples', '<p>One R is the amount you risked. A trade that makes twice your risk is +2R. Thinking in R frees you from dollar amounts and account size.</p>', 2)
) as v(slug, title, body, ord)
on conflict (course_id, slug) do nothing;

-- Quiz questions + options. Each question has exactly one correct option.
-- NOTE: `qid` is intentionally reused — first holds the lesson id (for the not-exists
-- check + the question insert), then overwritten by `returning id` to hold the new
-- question id for the options loop.
do $$
declare
  q record;
  qid uuid;
  i int;
begin
  for q in
    select * from (values
      ('foundations','what-is-a-trade','A trade is defined by which three levels?', 1,
        array['Entry, stop, and target','RSI, MACD, and volume','Open, lunch, and close'], 1),
      ('foundations','reading-candles','On a candle, the wicks represent…', 1,
        array['The open and close','The high and low extremes','The moving average'], 2),
      ('risk','position-sizing','Position size should be derived from…', 1,
        array['Your stop distance and fixed risk %','How confident you feel','The largest size your broker allows'], 1),
      ('risk','r-multiples','A trade that earns twice what you risked is…', 1,
        array['+2R','+200 pips','Break-even'], 1)
    ) as t(course_slug, lesson_slug, prompt, ord, options, correct_idx)
  loop
    select l.id into qid from public.lessons l
      join public.courses c on c.id = l.course_id
      where c.slug = q.course_slug and l.slug = q.lesson_slug;
    if not exists (select 1 from public.quiz_questions where lesson_id = qid) then
      insert into public.quiz_questions (lesson_id, prompt, ord) values (qid, q.prompt, q.ord)
        returning id into qid;
      for i in 1..array_length(q.options, 1) loop
        insert into public.quiz_options (question_id, label, is_correct, ord)
          values (qid, q.options[i], i = q.correct_idx, i);
      end loop;
    end if;
  end loop;
end $$;
