# Learning Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An in-app Learning Hub of admin-seeded courses→lessons, each gated by an all-correct quiz; passing grants XP that folds into the existing combined XP/level + XP leaderboard, and unlocks a new `lessons` badge category.

**Architecture:** New tables in migration `0005_learning` (courses, lessons, quiz_questions, quiz_options, lesson_completions), seeded via SQL. Quiz answers and completion inserts are **service-role only** (RLS denies client access) so XP cannot be self-granted. Learning XP is a pure sum over completion rows (no general ledger), added to the Phase 5 derived XP. Pure logic in `lib/learning.ts`; server reads in `lib/server/learning.ts`; grading in `actions/learning.ts`.

**Tech Stack:** Next.js App Router (TS, `basePath:/app`), Supabase (`@supabase/ssr` + service-role `@supabase/supabase-js`), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-22-learning-hub-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `app/supabase/migrations/0005_learning.sql` (create) | Tables + RLS + seed content/quizzes. |
| `app/src/lib/learning.ts` (create) | Pure: `gradeQuiz`, `learningTotalXp`, `learningWindowXp`. |
| `app/tests/unit/learning.test.ts` (create) | Unit tests for the pure logic. |
| `app/src/lib/xp.ts` (modify) | Add `lessons` badge category + `lessonsCompleted` stat. |
| `app/tests/unit/xp.test.ts` (modify) | Tests for the lessons badges. |
| `app/src/lib/server/xp.ts` (modify) | `getUserXp` combined trade+learning; `getXpRanking` union. |
| `app/src/lib/server/learning.ts` (create) | `getCourses`, `getCourseWithLessons`, `getLessonForViewer`, `getUserLearning`. |
| `app/src/app/actions/learning.ts` (create) | `submitQuiz` — service-role grading + completion insert. |
| `app/src/app/learn/page.tsx` (create) | Course catalog. |
| `app/src/app/learn/[course]/page.tsx` (create) | Course → lesson list + progress. |
| `app/src/app/learn/[course]/[lesson]/page.tsx` (create) | Lesson reader + quiz mount. |
| `app/src/app/learn/[course]/[lesson]/Quiz.tsx` (create) | Client quiz (radios, submit, pass/fail). |
| `app/src/app/_components/NavLinks.tsx` (modify) | Add "Learn" pill. |
| `app/src/app/achievements/page.tsx` (modify) | "Lessons completed" stat. |
| `app/src/app/globals.css` (modify) | `.learn-*` / `.quiz-*` styles. |
| `app/tests/e2e/learning.spec.ts` (create) | Catalog→lesson→fail→pass→XP e2e. |

**Prerequisite:** `SUPABASE_SERVICE_ROLE_KEY` must be set in `app/.env.local` (already used by `lib/supabase/service.ts`). Confirm before Task 5.

---

## Task 1: Migration `0005_learning` (+ seed) and apply

**Files:**
- Create: `app/supabase/migrations/0005_learning.sql`

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Append the seed (same file)**

```sql
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
-- Helper: insert a question and its 3 options for a lesson by (course slug, lesson slug).
do $$
declare
  q record;
  qid uuid;
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
    -- skip if this lesson already has a question (idempotent re-run)
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
```

- [ ] **Step 3: Apply the migration to Supabase Cloud**

Run (whichever the project uses — there is no `npm` migrate script):
```bash
# Option A: Supabase CLI
cd app && supabase db push
# Option B: paste app/supabase/migrations/0005_learning.sql into the Supabase dashboard SQL editor and run.
```
Expected: tables created, seed rows present. Verify:
```bash
# In dashboard SQL editor:
select (select count(*) from courses) as courses, (select count(*) from lessons) as lessons,
       (select count(*) from quiz_questions) as questions, (select count(*) from quiz_options) as options;
```
Expected: courses=2, lessons=4, questions=4, options=12.

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0005_learning.sql
git commit -m "feat(app): 0005_learning migration — courses, lessons, quizzes, completions + seed"
```

---

## Task 2: Pure logic `lib/learning.ts`

**Files:**
- Create: `app/src/lib/learning.ts`
- Test: `app/tests/unit/learning.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/unit/learning.test.ts
import { describe, it, expect } from 'vitest'
import { gradeQuiz, learningTotalXp, learningWindowXp, type LearningCompletion } from '@/lib/learning'

describe('gradeQuiz', () => {
  const correct = { q1: 'a', q2: 'b' }
  it('passes only when every answer matches', () => {
    expect(gradeQuiz({ q1: 'a', q2: 'b' }, correct)).toEqual({ passed: true, wrongQuestionIds: [] })
  })
  it('reports the wrong question ids', () => {
    expect(gradeQuiz({ q1: 'a', q2: 'c' }, correct)).toEqual({ passed: false, wrongQuestionIds: ['q2'] })
  })
  it('treats a missing answer as wrong', () => {
    expect(gradeQuiz({ q1: 'a' }, correct)).toEqual({ passed: false, wrongQuestionIds: ['q2'] })
  })
})

describe('learning XP', () => {
  const now = Date.parse('2026-06-22T12:00:00Z')
  const c = (completed_at: string, xp_reward = 100): LearningCompletion => ({ completed_at, xp_reward })
  it('total sums xp_reward', () => {
    expect(learningTotalXp([c('2026-06-01T00:00:00Z'), c('2026-06-20T00:00:00Z', 50)])).toBe(150)
  })
  it('window all equals total', () => {
    const all = [c('2026-06-01T00:00:00Z'), c('2026-06-20T00:00:00Z')]
    expect(learningWindowXp(all, 'all', now)).toBe(learningTotalXp(all))
  })
  it('week window excludes completions before the cutoff', () => {
    const items = [c('2026-06-20T00:00:00Z'), c('2026-05-01T00:00:00Z')]
    expect(learningWindowXp(items, 'week', now)).toBe(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- learning.test.ts`
Expected: FAIL — cannot resolve `@/lib/learning`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/lib/learning.ts
import { windowCutoff, type Period } from '@/lib/xp'

export type QuizAnswers = Record<string, string> // questionId -> selected optionId
export type CorrectMap = Record<string, string>  // questionId -> correct optionId

export function gradeQuiz(answers: QuizAnswers, correct: CorrectMap): { passed: boolean; wrongQuestionIds: string[] } {
  const wrongQuestionIds = Object.keys(correct).filter((qid) => answers[qid] !== correct[qid])
  return { passed: wrongQuestionIds.length === 0, wrongQuestionIds }
}

export type LearningCompletion = { completed_at: string; xp_reward: number }

export function learningTotalXp(completions: LearningCompletion[]): number {
  return completions.reduce((sum, c) => sum + c.xp_reward, 0)
}
export function learningWindowXp(completions: LearningCompletion[], period: Period, now: number): number {
  const cutoff = windowCutoff(period, now)
  if (cutoff == null) return learningTotalXp(completions)
  return completions.reduce((sum, c) => sum + (Date.parse(c.completed_at) >= cutoff ? c.xp_reward : 0), 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- learning.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/learning.ts app/tests/unit/learning.test.ts
git commit -m "feat(app): learning pure logic (gradeQuiz, learning XP)"
```

---

## Task 3: Add `lessons` badge category to `lib/xp.ts`

**Files:**
- Modify: `app/src/lib/xp.ts`
- Test: `app/tests/unit/xp.test.ts`

- [ ] **Step 1: Add the failing test (append to xp.test.ts, inside or after the `evaluateBadges` describe)**

```ts
describe('evaluateBadges — lessons', () => {
  it('earns lesson badges by lessonsCompleted', () => {
    const badges = evaluateBadges({ closedCount: 0, level: 1, maxQuestStreak: 0, maxWinStreak: 0, lessonsCompleted: 6 })
    expect(badges.find((b) => b.id === 'lessons_1')).toMatchObject({ earned: true, current: 6 })
    expect(badges.find((b) => b.id === 'lessons_5')).toMatchObject({ earned: true, current: 6 })
    expect(badges.find((b) => b.id === 'lessons_25')).toMatchObject({ earned: false, current: 6 })
  })
  it('includes the lessons category', () => {
    expect(new Set(BADGES.map((b) => b.category)))
      .toEqual(new Set(['trades', 'level', 'questStreak', 'winStreak', 'lessons']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- xp.test.ts`
Expected: FAIL — `lessonsCompleted` not on `BadgeStats`; no `lessons_*` badges.

- [ ] **Step 3: Edit `lib/xp.ts`**

Change the `BadgeCategory` type to add `'lessons'`:
```ts
export type BadgeCategory = 'trades' | 'level' | 'questStreak' | 'winStreak' | 'lessons'
```
Append three badges to the `BADGES` array (after the `wins_10` entry, before the closing `]`):
```ts
  { id: 'lessons_1', category: 'lessons', label: 'First Lesson', threshold: 1 },
  { id: 'lessons_5', category: 'lessons', label: '5 Lessons', threshold: 5 },
  { id: 'lessons_25', category: 'lessons', label: '25 Lessons', threshold: 25 },
```
Add `lessonsCompleted` to `BadgeStats`:
```ts
export type BadgeStats = { closedCount: number; level: number; maxQuestStreak: number; maxWinStreak: number; lessonsCompleted: number }
```
Add the `lessons` branch in `evaluateBadges`'s `value` selector:
```ts
  const value = (c: BadgeCategory): number =>
    c === 'trades' ? stats.closedCount
      : c === 'level' ? stats.level
      : c === 'questStreak' ? stats.maxQuestStreak
      : c === 'winStreak' ? stats.maxWinStreak
      : stats.lessonsCompleted
```

- [ ] **Step 4: Run test to verify it passes (whole file)**

Run: `cd app && npm test -- xp.test.ts`
Expected: PASS. (Existing `evaluateBadges` test already passes `lessonsCompleted`? It does NOT — fix it: in the existing "marks earned vs locked" test, add `lessonsCompleted: 0` to the stats object so the type compiles.)

Edit the existing test stats literal:
```ts
    const badges = evaluateBadges({ closedCount: 12, level: 3, maxQuestStreak: 7, maxWinStreak: 4, lessonsCompleted: 0 })
```

- [ ] **Step 5: Typecheck + commit**

Run: `cd app && npx tsc --noEmit`
Expected: no errors (note: `getUserXp` callers of `evaluateBadges` in `lib/server/xp.ts` will now fail typecheck until Task 4 — that's expected; if running tsc standalone here it WILL error on `lib/server/xp.ts`. Proceed to commit and fix in Task 4.)

```bash
git add app/src/lib/xp.ts app/tests/unit/xp.test.ts
git commit -m "feat(app): lessons badge category in xp badges"
```

---

## Task 4: Combine learning XP into `lib/server/xp.ts`

**Files:**
- Modify: `app/src/lib/server/xp.ts`

- [ ] **Step 1: Update imports** — add learning helpers + types:

```ts
import { learningTotalXp, learningWindowXp, type LearningCompletion } from '@/lib/learning'
```

- [ ] **Step 2: Add a completion-fetch helper** (near the top of the module, after imports):

```ts
// A user's lesson completions joined to each lesson's xp_reward.
async function fetchCompletions(supabase: SupabaseClient, userId: string): Promise<LearningCompletion[]> {
  const { data } = await supabase
    .from('lesson_completions')
    .select('completed_at, lessons(xp_reward)')
    .eq('user_id', userId)
  return (data ?? []).map((r) => {
    const l = r.lessons as { xp_reward: number } | { xp_reward: number }[] | null
    const xp = Array.isArray(l) ? (l[0]?.xp_reward ?? 0) : (l?.xp_reward ?? 0)
    return { completed_at: r.completed_at as string, xp_reward: xp }
  })
}
```

- [ ] **Step 3: Extend `UserXp` and `getUserXp`** — combined total, learning fields, lessons badge stat:

Update the `UserXp` type:
```ts
export type UserXp = {
  totalXp: number
  learningXp: number
  lessonsCompleted: number
  level: LevelInfo
  daily: QuestProgress[]
  weekly: QuestProgress[]
  questStreak: number
  badges: EvaluatedBadge[]
}
```
Replace the body of `getUserXp` after the `trades` line:
```ts
  const trades = (data ?? []) as XpTrade[]
  const completions = await fetchCompletions(supabase, userId)
  const learningXp = learningTotalXp(completions)
  const totalXp = totalXpFromTrades(trades) + learningXp
  const level = levelFromXp(totalXp)
  return {
    totalXp,
    learningXp,
    lessonsCompleted: completions.length,
    level,
    daily: dailyQuestProgress(trades, now),
    weekly: weeklyQuestProgress(trades, now),
    questStreak: questStreak(trades, now),
    badges: evaluateBadges({
      closedCount: closedCount(trades),
      level: level.level,
      maxQuestStreak: maxQuestStreak(trades),
      maxWinStreak: winStreakMax(trades),
      lessonsCompleted: completions.length,
    }),
  }
```

- [ ] **Step 4: Fold learning into `getXpRanking`** — replace the function body so candidates are the UNION of trade-XP and learning-XP owners:

```ts
export async function getXpRanking(supabase: SupabaseClient, period: Period, now = Date.now()): Promise<XpRankedEntry[]> {
  const { data: tradeRows } = await supabase
    .from('trades')
    .select('user_id, traded_at, closed_at, status, outcome')
    .eq('is_public', true)
    .eq('status', 'closed')
  const tradeByUser = new Map<string, XpTrade[]>()
  for (const r of (tradeRows ?? []) as (XpTrade & { user_id: string })[]) {
    const arr = tradeByUser.get(r.user_id) ?? []
    arr.push(r); tradeByUser.set(r.user_id, arr)
  }

  const { data: compRows } = await supabase
    .from('lesson_completions')
    .select('user_id, completed_at, lessons(xp_reward)')
  const learnByUser = new Map<string, LearningCompletion[]>()
  for (const r of compRows ?? []) {
    const l = r.lessons as { xp_reward: number } | { xp_reward: number }[] | null
    const xp = Array.isArray(l) ? (l[0]?.xp_reward ?? 0) : (l?.xp_reward ?? 0)
    const uid = r.user_id as string
    const arr = learnByUser.get(uid) ?? []
    arr.push({ completed_at: r.completed_at as string, xp_reward: xp })
    learnByUser.set(uid, arr)
  }

  const userIds = new Set<string>([...tradeByUser.keys(), ...learnByUser.keys()])
  const scored = [...userIds].map((userId) => {
    const t = tradeByUser.get(userId) ?? []
    const l = learnByUser.get(userId) ?? []
    const xp = windowXp(t, period, now) + learningWindowXp(l, period, now)
    const level = levelFromXp(totalXpFromTrades(t) + learningTotalXp(l)).level
    return { userId, xp, level }
  }).filter((s) => s.xp > 0)
  if (scored.length === 0) return []

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, created_at')
    .in('id', scored.map((s) => s.userId))
    .eq('is_public', true)
    .eq('onboarding_completed', true)
  const pmap = new Map((profs ?? []).map((p) => [p.id, p]))

  const visible = scored
    .filter((s) => pmap.has(s.userId))
    .map((s) => ({ ...s, joinedAt: Date.parse(pmap.get(s.userId)!.created_at) }))
    .sort((a, b) => b.xp - a.xp || a.joinedAt - b.joinedAt)

  return visible.map((s, i) => {
    const p = pmap.get(s.userId)!
    return {
      rank: i + 1, userId: s.userId,
      username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url,
      xp: s.xp, level: s.level,
    }
  })
}
```

- [ ] **Step 5: Typecheck + commit**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

```bash
git add app/src/lib/server/xp.ts
git commit -m "feat(app): fold learning XP into getUserXp + getXpRanking"
```

---

## Task 5: Server reads + grading action

**Files:**
- Create: `app/src/lib/server/learning.ts`, `app/src/app/actions/learning.ts`

> Confirm `SUPABASE_SERVICE_ROLE_KEY` is in `app/.env.local` before testing.

- [ ] **Step 1: Create `lib/server/learning.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { learningTotalXp, type LearningCompletion } from '@/lib/learning'

export type CourseCard = { id: string; slug: string; title: string; summary: string | null; difficulty: string | null; lessonCount: number; completedCount: number }

export async function getCourses(supabase: SupabaseClient, userId: string): Promise<CourseCard[]> {
  const { data: courses } = await supabase.from('courses').select('id, slug, title, summary, difficulty, ord').order('ord')
  const { data: lessons } = await supabase.from('lessons').select('id, course_id')
  const { data: comps } = await supabase.from('lesson_completions').select('lesson_id').eq('user_id', userId)
  const lessonsByCourse = new Map<string, string[]>()
  for (const l of lessons ?? []) lessonsByCourse.set(l.course_id, [...(lessonsByCourse.get(l.course_id) ?? []), l.id])
  const done = new Set((comps ?? []).map((c) => c.lesson_id))
  return (courses ?? []).map((c) => {
    const ids = lessonsByCourse.get(c.id) ?? []
    return { id: c.id, slug: c.slug, title: c.title, summary: c.summary, difficulty: c.difficulty,
      lessonCount: ids.length, completedCount: ids.filter((id) => done.has(id)).length }
  })
}

export type CourseDetail = { title: string; summary: string | null; lessons: { id: string; slug: string; title: string; ord: number; completed: boolean }[] }

export async function getCourseWithLessons(supabase: SupabaseClient, courseSlug: string, userId: string): Promise<CourseDetail | null> {
  const { data: course } = await supabase.from('courses').select('id, title, summary').eq('slug', courseSlug).maybeSingle()
  if (!course) return null
  const { data: lessons } = await supabase.from('lessons').select('id, slug, title, ord').eq('course_id', course.id).order('ord')
  const { data: comps } = await supabase.from('lesson_completions').select('lesson_id').eq('user_id', userId)
  const done = new Set((comps ?? []).map((c) => c.lesson_id))
  return {
    title: course.title, summary: course.summary,
    lessons: (lessons ?? []).map((l) => ({ id: l.id, slug: l.slug, title: l.title, ord: l.ord, completed: done.has(l.id) })),
  }
}

export type LessonView = {
  id: string; title: string; body: string; xpReward: number; completed: boolean; courseTitle: string
  questions: { id: string; prompt: string; options: { id: string; label: string }[] }[]
}

// Quiz comes from the SERVICE client and strips is_correct before returning.
export async function getLessonForViewer(supabase: SupabaseClient, courseSlug: string, lessonSlug: string, userId: string): Promise<LessonView | null> {
  const { data: course } = await supabase.from('courses').select('id, title').eq('slug', courseSlug).maybeSingle()
  if (!course) return null
  const { data: lesson } = await supabase.from('lessons')
    .select('id, title, body, xp_reward').eq('course_id', course.id).eq('slug', lessonSlug).maybeSingle()
  if (!lesson) return null
  const { data: comp } = await supabase.from('lesson_completions').select('id').eq('user_id', userId).eq('lesson_id', lesson.id).maybeSingle()

  const svc = createServiceClient()
  const { data: questions } = await svc.from('quiz_questions')
    .select('id, prompt, ord, quiz_options(id, label, ord)').eq('lesson_id', lesson.id).order('ord')
  const mapped = (questions ?? []).map((q) => ({
    id: q.id, prompt: q.prompt,
    options: ((q.quiz_options as { id: string; label: string; ord: number }[]) ?? [])
      .sort((a, b) => a.ord - b.ord).map((o) => ({ id: o.id, label: o.label })),
  }))
  return { id: lesson.id, title: lesson.title, body: lesson.body, xpReward: lesson.xp_reward, completed: !!comp, courseTitle: course.title, questions: mapped }
}

export async function getUserLearning(supabase: SupabaseClient, userId: string): Promise<{ lessonsCompleted: number; learningXp: number }> {
  const { data } = await supabase.from('lesson_completions').select('completed_at, lessons(xp_reward)').eq('user_id', userId)
  const completions: LearningCompletion[] = (data ?? []).map((r) => {
    const l = r.lessons as { xp_reward: number } | { xp_reward: number }[] | null
    const xp = Array.isArray(l) ? (l[0]?.xp_reward ?? 0) : (l?.xp_reward ?? 0)
    return { completed_at: r.completed_at as string, xp_reward: xp }
  })
  return { lessonsCompleted: completions.length, learningXp: learningTotalXp(completions) }
}
```

- [ ] **Step 2: Create `actions/learning.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { gradeQuiz, type QuizAnswers } from '@/lib/learning'

export type QuizResult = { passed: boolean; wrongQuestionIds: string[]; xpAwarded: number; error?: string }

export async function submitQuiz(lessonId: string, answers: QuizAnswers): Promise<QuizResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { passed: false, wrongQuestionIds: [], xpAwarded: 0, error: 'Not authenticated.' }

  const svc = createServiceClient()
  const { data: lesson } = await svc.from('lessons').select('id, xp_reward').eq('id', lessonId).maybeSingle()
  if (!lesson) return { passed: false, wrongQuestionIds: [], xpAwarded: 0, error: 'Lesson not found.' }

  const { data: questions } = await svc.from('quiz_questions')
    .select('id, quiz_options(id, is_correct)').eq('lesson_id', lessonId)
  const correct: Record<string, string> = {}
  for (const q of questions ?? []) {
    const opt = ((q.quiz_options as { id: string; is_correct: boolean }[]) ?? []).find((o) => o.is_correct)
    if (opt) correct[q.id] = opt.id
  }

  const { passed, wrongQuestionIds } = gradeQuiz(answers, correct)
  if (!passed) return { passed: false, wrongQuestionIds, xpAwarded: 0 }

  const { data: existing } = await svc.from('lesson_completions')
    .select('id').eq('user_id', user.id).eq('lesson_id', lessonId).maybeSingle()
  let xpAwarded = 0
  if (!existing) {
    await svc.from('lesson_completions').insert({ user_id: user.id, lesson_id: lessonId })
    xpAwarded = lesson.xp_reward
  }
  revalidatePath('/learn')
  revalidatePath('/achievements')
  return { passed: true, wrongQuestionIds: [], xpAwarded }
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

```bash
git add app/src/lib/server/learning.ts app/src/app/actions/learning.ts
git commit -m "feat(app): learning server reads + service-role quiz grading"
```

---

## Task 6: Learn routes + Quiz component + CSS

**Files:**
- Create: `app/src/app/learn/page.tsx`, `app/src/app/learn/[course]/page.tsx`, `app/src/app/learn/[course]/[lesson]/page.tsx`, `app/src/app/learn/[course]/[lesson]/Quiz.tsx`
- Modify: `app/src/app/globals.css`

- [ ] **Step 1: Catalog `learn/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCourses } from '@/lib/server/learning'

export default async function LearnPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const courses = await getCourses(supabase, user.id)

  return (
    <main className="ts-page" style={{ maxWidth: 820 }}>
      <header className="lb-head"><div className="tx">
        <h1 className="ts-h1">Learn</h1>
        <p>Work through courses, pass the quiz, earn XP. Your progress counts toward your level.</p>
      </div></header>
      <div className="learn-grid mt-6">
        {courses.map((c) => {
          const pct = c.lessonCount ? Math.round((c.completedCount / c.lessonCount) * 100) : 0
          return (
            <a key={c.id} href={`/app/learn/${c.slug}`} className="ts-card learn-card">
              {c.difficulty && <span className="eyebrow">{c.difficulty}</span>}
              <h2 className="ts-h2">{c.title}</h2>
              {c.summary && <p className="faint" style={{ fontSize: 14 }}>{c.summary}</p>}
              <div className="ach-bar mt-3"><i style={{ width: pct + '%' }} /></div>
              <p className="faint mt-3" style={{ fontSize: 12 }}>{c.completedCount}/{c.lessonCount} lessons</p>
            </a>
          )
        })}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Course `learn/[course]/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCourseWithLessons } from '@/lib/server/learning'

export default async function CoursePage({ params }: { params: Promise<{ course: string }> }) {
  const { course: slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const course = await getCourseWithLessons(supabase, slug, user.id)
  if (!course) notFound()
  const doneCount = course.lessons.filter((l) => l.completed).length

  return (
    <main className="ts-page" style={{ maxWidth: 720 }}>
      <header className="lb-head"><div className="tx">
        <a href="/app/learn" className="ts-link-sm">← All courses</a>
        <h1 className="ts-h1">{course.title}</h1>
        {course.summary && <p>{course.summary}</p>}
        <p className="faint" style={{ fontSize: 13 }}>{doneCount}/{course.lessons.length} complete</p>
      </div></header>
      <ol className="learn-lessons mt-6">
        {course.lessons.map((l) => (
          <li key={l.id}>
            <a href={`/app/learn/${slug}/${l.slug}`} className={'ts-card learn-lesson' + (l.completed ? ' done' : '')}>
              <span className="learn-tick" aria-hidden>{l.completed ? '✓' : l.ord}</span>
              <b>{l.title}</b>
              {l.completed && <span className="ts-chip2" style={{ marginLeft: 'auto' }}>Completed</span>}
            </a>
          </li>
        ))}
      </ol>
    </main>
  )
}
```

- [ ] **Step 3: Quiz client component `learn/[course]/[lesson]/Quiz.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { submitQuiz, type QuizResult } from '@/app/actions/learning'

type Q = { id: string; prompt: string; options: { id: string; label: string }[] }

export function Quiz({ lessonId, questions, alreadyDone }: { lessonId: string; questions: Q[]; alreadyDone: boolean }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [busy, setBusy] = useState(false)

  if (alreadyDone && !result) {
    return <div className="ts-card quiz-done">✓ You’ve completed this lesson.</div>
  }

  const allAnswered = questions.every((q) => answers[q.id])
  const wrong = new Set(result?.wrongQuestionIds ?? [])

  async function onSubmit() {
    setBusy(true)
    const r = await submitQuiz(lessonId, answers)
    setResult(r)
    setBusy(false)
  }

  if (result?.passed) {
    return <div className="ts-card quiz-pass">🎉 Passed!{result.xpAwarded > 0 ? ` +${result.xpAwarded} XP` : ' (already completed)'}</div>
  }

  return (
    <div className="ts-card quiz">
      <h2 className="ts-h2">Quiz</h2>
      {result && !result.passed && <p className="quiz-fail mt-3">Not quite — review the highlighted questions and try again.</p>}
      {questions.map((q, i) => (
        <fieldset key={q.id} className={'quiz-q' + (wrong.has(q.id) ? ' wrong' : '')}>
          <legend>{i + 1}. {q.prompt}</legend>
          {q.options.map((o) => (
            <label key={o.id} className="quiz-opt">
              <input type="radio" name={q.id} value={o.id} checked={answers[q.id] === o.id}
                onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))} />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <button className="btn btn-primary mt-3" disabled={!allAnswered || busy} onClick={onSubmit}>
        {busy ? 'Checking…' : 'Submit answers'}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Lesson `learn/[course]/[lesson]/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getLessonForViewer } from '@/lib/server/learning'
import { Quiz } from './Quiz'

export default async function LessonPage({ params }: { params: Promise<{ course: string; lesson: string }> }) {
  const { course, lesson } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const view = await getLessonForViewer(supabase, course, lesson, user.id)
  if (!view) notFound()

  return (
    <main className="ts-page" style={{ maxWidth: 720 }}>
      <a href={`/app/learn/${course}`} className="ts-link-sm">← {view.courseTitle}</a>
      <h1 className="ts-h1 mt-3">{view.title}</h1>
      <article className="ts-card learn-body mt-5" dangerouslySetInnerHTML={{ __html: view.body }} />
      <div className="mt-6">
        <Quiz lessonId={view.id} questions={view.questions} alreadyDone={view.completed} />
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Append CSS to `globals.css`**

```css
/* Learning Hub */
.learn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 720px) { .learn-grid { grid-template-columns: 1fr; } }
.learn-card { display: flex; flex-direction: column; gap: 6px; text-decoration: none; }
.learn-lessons { list-style: none; display: flex; flex-direction: column; gap: 10px; }
.learn-lesson { display: flex; align-items: center; gap: 12px; text-decoration: none; }
.learn-lesson.done { border-color: rgba(52,211,153,.35); }
.learn-tick { width: 26px; height: 26px; border-radius: 999px; display: grid; place-items: center; border: 1px solid var(--line, rgba(255,255,255,.18)); font-size: 13px; }
.learn-lesson.done .learn-tick { background: rgba(52,211,153,.15); border-color: #34d399; color: #34d399; }
.learn-body { line-height: 1.7; }
.learn-body p { margin: 0 0 12px; }
.quiz-q { border: 1px solid var(--line, rgba(255,255,255,.08)); border-radius: 12px; padding: 14px; margin-top: 14px; }
.quiz-q.wrong { border-color: rgba(248,113,113,.6); }
.quiz-q legend { font-weight: 700; padding: 0 6px; }
.quiz-opt { display: flex; align-items: center; gap: 8px; padding: 6px 0; cursor: pointer; }
.quiz-pass { color: #34d399; font-weight: 700; }
.quiz-fail { color: #f87171; }
.quiz-done { color: #34d399; font-weight: 600; }
```

- [ ] **Step 6: Typecheck + commit** (do NOT run dev/build)

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

```bash
git add app/src/app/learn app/src/app/globals.css
git commit -m "feat(app): learn routes (catalog, course, lesson + quiz)"
```

---

## Task 7: Nav "Learn" pill + achievements lessons stat

**Files:**
- Modify: `app/src/app/_components/NavLinks.tsx`, `app/src/app/achievements/page.tsx`

- [ ] **Step 1: Add the Learn pill in `NavLinks.tsx`** — after the Leaderboard `<Link>`:

```tsx
      <Link href="/learn" className="ts-navpill" data-active={!!path?.startsWith('/learn')}>Learn</Link>
```

- [ ] **Step 2: Add a "Lessons completed" stat on the achievements page**

In `app/src/app/achievements/page.tsx`, `xp` (from `getUserXp`) now carries `lessonsCompleted`. Add a small stat line under the `<XpHero ... />`:

```tsx
      <p className="faint mt-3" style={{ fontSize: 13 }}>📚 {xp.lessonsCompleted} lesson{xp.lessonsCompleted === 1 ? '' : 's'} completed · <a href="/app/learn" className="ts-link-sm">Learn</a></p>
```

- [ ] **Step 3: Typecheck + commit**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

```bash
git add app/src/app/_components/NavLinks.tsx app/src/app/achievements/page.tsx
git commit -m "feat(app): nav Learn pill + achievements lessons stat"
```

---

## Task 8: E2E + full test pass

**Files:**
- Create: `app/tests/e2e/learning.spec.ts`

> Requires the migration applied (Task 1 Step 3) and a warm dev server.

- [ ] **Step 1: Write `learning.spec.ts`** (reuses the signup helper shape from `tests/e2e/leaderboard.spec.ts`)

```ts
import { test, expect, type Page } from '@playwright/test'

async function signUpAndOnboard(page: Page, prefix: string) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const username = `${prefix}_${stamp}`
  await page.goto('/app/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@tradingsocial.io`)
  await page.fill('input[name="password"]', 'password123')
  await page.check('input[name="terms"]')
  await page.click('button:has-text("Join the Beta")')
  await expect(page).toHaveURL(/\/app\/onboarding/)
  await page.locator('label.ts-chip', { hasText: 'forex' }).click()
  await page.fill('input[name="goal"]', 'Be consistent')
  await page.click('button:has-text("Finish")')
  await expect(page).toHaveURL(/\/app$/)
  return username
}

test('a lesson quiz grants XP only when all answers are correct', async ({ page }) => {
  await signUpAndOnboard(page, 'learn')

  await page.goto('/app/learn')
  await expect(page.getByRole('heading', { name: 'Learn' })).toBeVisible()

  // Open the first course, then its first lesson.
  await page.locator('.learn-card').first().click()
  await page.locator('.learn-lesson').first().click()
  await expect(page.getByRole('heading', { name: 'Quiz' })).toBeVisible()

  // Answer every question with the FIRST option, submit. (Some will be wrong for seeded data.)
  for (const fs of await page.locator('.quiz-q').all()) {
    await fs.locator('input[type=radio]').first().check()
  }
  await page.click('button:has-text("Submit answers")')
  // Either it passed (first option happened to be correct everywhere) or it failed and shows retry.
  // Deterministically force a pass: select the LAST option is not reliable either; instead, the
  // first Foundations lesson's correct answer is option 1, so a single-question lesson passes.
  // If a fail banner shows, this still asserts the no-XP path rendered.
  const passed = await page.locator('.quiz-pass').count()
  if (passed === 0) {
    await expect(page.locator('.quiz-fail')).toBeVisible()
  } else {
    await expect(page.locator('.quiz-pass')).toContainText(/Passed/)
  }
})
```

> NOTE to implementer: the assertion above is intentionally tolerant because option ordering in the seed is fixed but per-lesson. If you want a strict pass assertion, pick the Foundations → "What Is a Trade?" lesson whose correct option is index 1 (the first radio), and assert `.quiz-pass` contains `+100 XP`. Prefer the strict version: navigate directly to `/app/learn/foundations/what-is-a-trade`, select the first option for its single question, submit, assert `+100 XP`, then reload and assert the "completed" state. Replace the loop block with that strict flow.

- [ ] **Step 2: Implement the STRICT version** (replace the test body per the note):

```ts
test('passing the quiz grants XP and marks the lesson complete', async ({ page }) => {
  await signUpAndOnboard(page, 'learn')
  await page.goto('/app/learn/foundations/what-is-a-trade')
  await expect(page.getByRole('heading', { name: 'Quiz' })).toBeVisible()
  // Seeded correct answer for this lesson is the first option.
  await page.locator('.quiz-q').first().locator('input[type=radio]').first().check()
  await page.click('button:has-text("Submit answers")')
  await expect(page.locator('.quiz-pass')).toContainText('+100 XP')

  await page.reload()
  await expect(page.locator('.quiz-done')).toBeVisible()

  await page.goto('/app/achievements')
  await expect(page.getByText(/lesson.* completed/)).toContainText(/1 lesson/)
})

test('a wrong answer does not complete the lesson', async ({ page }) => {
  await signUpAndOnboard(page, 'learnfail')
  await page.goto('/app/learn/foundations/reading-candles')
  // Correct answer for this lesson is option 2; pick option 1 (wrong).
  await page.locator('.quiz-q').first().locator('input[type=radio]').first().check()
  await page.click('button:has-text("Submit answers")')
  await expect(page.locator('.quiz-fail')).toBeVisible()
})
```

- [ ] **Step 3: Warm server, then run e2e**

```bash
cd app && npm run dev        # separate terminal; wait until serving
cd app && npx playwright test learning.spec.ts
```
Expected: both tests PASS. (If the first navigation busts the 5s onboarding `toHaveURL`, the server was cold — re-run once warm.)

- [ ] **Step 4: Full unit suite**

Run: `cd app && npm test`
Expected: all PASS (learning.test.ts, xp.test.ts incl. lessons badges, plus existing suites).

- [ ] **Step 5: Commit**

```bash
git add app/tests/e2e/learning.spec.ts
git commit -m "test(app): e2e for learning hub quiz pass/fail + XP"
```

---

## Task 9: Final verification & merge prep

- [ ] **Step 1: Typecheck + unit** (dev server stopped)

Run: `cd app && npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 2: Manual smoke** (warm server): `/app/learn` catalog → course → lesson → pass quiz (XP toast) → reload shows completed; nav "Learn" active; `/app/achievements` shows lessons stat + bumped XP; `/app/leaderboard?cat=xp` still ranks (now combined).

- [ ] **Step 3: Security check** — confirm a normal client cannot read answers: in the browser console on a lesson page, `await window.fetch` isn't needed — instead verify the network payload for the lesson page contains NO `is_correct`. Also confirm `quiz_options` direct select returns empty for the anon/auth role (dashboard: run `set role authenticated; select * from quiz_options;` → 0 rows / permission denied).

- [ ] **Step 4: Merge per workflow** — `superpowers:finishing-a-development-branch` (merge `phase6-learning` → main, then push).

---

## Self-Review Notes (author)

- **Spec coverage:** §2 tables+seed → Task 1; §3 security (service-role quiz + no user insert) → Tasks 1 (RLS), 5 (action); §4 pure logic → Task 2; §5 XP/badges integration → Tasks 3–4; §6 server+action → Task 5; §7 surfaces → Tasks 6–7; §8 tests → Tasks 2,3,8. ✓
- **Type consistency:** `LearningCompletion {completed_at, xp_reward}` defined Task 2, reused Tasks 4,5; `QuizAnswers` Task 2 → action Task 5 → Quiz Task 6; `QuizResult` Task 5 → Quiz Task 6; `BadgeStats.lessonsCompleted` Task 3 → set in Task 4 `getUserXp`; `UserXp.lessonsCompleted` Task 4 → read Task 7. ✓
- **Security:** quiz answers fetched only via `createServiceClient` (Tasks 5); `lesson_completions` has select-only RLS, inserts via service role in the graded action; lesson body is trusted seeded HTML (only source is the migration) so `dangerouslySetInnerHTML` is acceptable. ✓
- **Known dependency:** Task 3 leaves `lib/server/xp.ts` failing typecheck until Task 4 (the `evaluateBadges` call needs `lessonsCompleted`). Tasks 3 and 4 must land together before a clean `tsc`.
