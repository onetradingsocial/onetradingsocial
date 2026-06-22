# TradingSocial App — Phase 6: Learning Hub

**Date:** 2026-06-22
**Status:** Approved (design)
**Depends on:** Phase 5 (XP system — learning XP folds into it; badge system gains a category). First feature with a **write path into XP**, but still **no general ledger** (completions table is the source).

---

## 1. Goals

An in-app **Learning Hub**: admin-curated **courses → lessons**, each lesson gated by an **all-correct quiz** (unlimited retries). Passing a lesson's quiz grants XP that **folds into the existing XP/level system** and the leaderboard's XP ladder, and unlocks **learning badges**.

**Confirmed decisions:**
- **Courses → lessons** hierarchy; content + quizzes **seeded via SQL migration** (no authoring UI — that's Phase 7).
- Completion = **pass an end-of-lesson quiz, all questions correct, unlimited retries**. XP granted **once** per lesson.
- Learning XP **folds into the XP tab**: combined total/level = trade XP + learning XP; the XP leaderboard ranks by combined window XP.
- Lesson body is **HTML** (matches the blog content style).
- **Learning badges** added: a `lessons` badge category (First lesson / 5 / 25 completed).

**Out of scope:** authoring/admin UI (Phase 7), course-completion bonus XP (per-lesson XP only), partial-credit quizzes, attempt cooldowns/limits, lesson video/media, a separate "Learning" leaderboard tab (learning is folded into XP).

---

## 2. Data model — migration `0005_learning.sql`

```
courses
  id uuid pk default gen_random_uuid()
  slug text unique not null
  title text not null
  summary text
  difficulty text            -- 'beginner' | 'intermediate' | 'advanced'
  ord int not null default 0
  created_at timestamptz not null default now()

lessons
  id uuid pk
  course_id uuid not null references courses(id) on delete cascade
  slug text not null
  title text not null
  body text not null          -- HTML
  ord int not null default 0
  xp_reward int not null default 100
  created_at timestamptz not null default now()
  unique (course_id, slug)

quiz_questions
  id uuid pk
  lesson_id uuid not null references lessons(id) on delete cascade
  prompt text not null
  ord int not null default 0

quiz_options
  id uuid pk
  question_id uuid not null references quiz_questions(id) on delete cascade
  label text not null
  is_correct boolean not null default false
  ord int not null default 0

lesson_completions
  id uuid pk
  user_id uuid not null references auth.users(id) on delete cascade
  lesson_id uuid not null references lessons(id) on delete cascade
  completed_at timestamptz not null default now()
  unique (user_id, lesson_id)
```

**Seed (in the migration):** 2 starter courses — e.g. "Trading Foundations" and "Risk Management" — ~3 lessons each, 2–3 quiz questions per lesson with one correct option each. Real, sensible content (not lorem).

### RLS (security-critical — see §3)
- `courses`, `lessons`: `enable row level security`; **select** policy `using (true)` for `authenticated` (content is not secret). No insert/update/delete policies (seed-only).
- `quiz_questions`, `quiz_options`: `enable row level security`; **no select policy** → denied to `authenticated`. Readable **only via the service-role client**. (Prevents answer leakage.)
- `lesson_completions`: `enable row level security`; **select** policy `using (true)` for `authenticated` (needed for leaderboard aggregation; "user X completed lesson Y" is not sensitive). **No insert/update/delete policies** → users cannot self-grant. Inserts happen via the service-role client inside the graded action only.

---

## 3. Security model (handle deliberately)

Two invariants, both enforced server-side:

1. **Quiz answers never reach the client.** Because `quiz_options` has no `authenticated` select policy, a user querying it directly with their session key gets nothing. The lesson page fetches options through the **service-role client** (`@/lib/supabase/service`) and renders only `{ id, label, ord }` — `is_correct` is dropped before it leaves the server. Grading reads `is_correct` server-side.
2. **Completions cannot be self-granted.** `lesson_completions` has no user insert policy. The only writer is `submitQuiz` (server action), which: re-fetches the lesson's questions+correct options via service role, grades the submitted answers, and **only on all-correct** inserts the completion via service role (idempotent on `unique(user_id, lesson_id)`). A forged direct insert is rejected by RLS.

The service-role client must only ever run inside server actions / server components — never exposed to the browser. (It already exists at `app/src/lib/supabase/service.ts`.)

---

## 4. Pure logic — `lib/learning.ts` (unit-tested)

- `QuizAnswers = Record<questionId, optionId>` (selected option per question).
- `gradeQuiz(answers: QuizAnswers, correctByQuestion: Record<questionId, optionId>) → { passed: boolean; wrongQuestionIds: string[] }` — `passed` iff every question's selected option equals the correct option; `wrongQuestionIds` lists mismatches/missing for retry UI.
- `LearningCompletion = { completed_at: string; xp_reward: number }`.
- `learningTotalXp(completions: LearningCompletion[]) → number` = Σ `xp_reward`.
- `learningWindowXp(completions, period, now) → number` = Σ `xp_reward` where `completed_at >= windowCutoff(period, now)` (reuses `windowCutoff` from `lib/xp.ts`; `all` = total).

---

## 5. XP integration — changes to Phase 5 files

`lib/xp.ts`:
- Add `lessons` badge category. `BADGES` gains `lessons_1` (First Lesson, 1), `lessons_5` (5 Lessons), `lessons_25` (25 Lessons).
- `BadgeCategory` adds `'lessons'`; `BadgeStats` adds `lessonsCompleted: number`; `evaluateBadges` maps `lessons` → `stats.lessonsCompleted`.

`lib/server/xp.ts`:
- `getUserXp`: additionally fetch the user's completions joined to `lessons.xp_reward`. Compute `learningXp = learningTotalXp(...)`; **`totalXp = tradeXp + learningXp`**; `level = levelFromXp(totalXp)`. Pass `lessonsCompleted` (count) into `evaluateBadges`. Add `learningXp` and `lessonsCompleted` to the returned `UserXp`. (Owner vs `publicOnly` still applies to the *trade* query; completions are not visibility-scoped.)
- `getXpRanking` (XP tab folds in learning): build per-user combined window XP = trade `windowXp` + `learningWindowXp`. Source users from the **union** of (public-closed-trade owners) and (completion owners), so a pure-learner with no public trades can rank. Then keep only public+onboarded profiles, `xp > 0`, dense-rank by combined XP, tie-break by `created_at`. `level` column = combined all-time level.

These are deliberate, contained edits to Phase 5 units; pure functions stay pure.

---

## 6. Server data + action — `lib/server/learning.ts`, `actions/learning.ts`

`lib/server/learning.ts`:
- `getCourses(supabase, userId)` → courses ordered by `ord`, each with `lessonCount` and the viewer's `completedCount` (progress).
- `getCourseWithLessons(supabase, slug, userId)` → course + its lessons (ordered) each flagged `completed` for the viewer.
- `getLessonForViewer(slug pair)` → lesson `{title, body, ord, xp_reward, completed}` + quiz `questions[] { id, prompt, options: {id,label}[] }` (NO `is_correct`; fetched via **service role**).
- `getUserLearning(supabase, userId)` → `{ lessonsCompleted, learningXp }` for stat surfaces.

`actions/learning.ts`:
- `submitQuiz(lessonId: string, answers: QuizAnswers): Promise<{ passed: boolean; wrongQuestionIds: string[]; xpAwarded: number }>` — auth required; service-role fetch of correct options; `gradeQuiz`; on pass, idempotent insert into `lesson_completions` (service role) and `revalidatePath` the lesson/course/achievements; `xpAwarded = passed ? lesson.xp_reward : 0` (0 if already completed). Never trusts client-sent correctness.

---

## 7. Surfaces

- **`/app/learn`** — catalog: course cards (title, summary, difficulty, `completedCount/lessonCount` progress bar).
- **`/app/learn/[course]`** — course page: ordered lesson list with completion ticks + course progress; link into each lesson.
- **`/app/learn/[course]/[lesson]`** — HTML lesson reader (`dangerouslySetInnerHTML` over trusted seeded HTML), then a **Quiz** client component: radio options per question, Submit → calls `submitQuiz`; pass → success state showing `+{xp} XP` (or "already completed"); fail → highlights `wrongQuestionIds` with a Retry.
- **Nav** (`_components/NavLinks.tsx`, and `AppNav` if it lists links) — add a **Learn** pill (`/learn`, active on `startsWith('/learn')`).
- **Achievements** (`/app/achievements`) — add a **Lessons completed** stat (from `getUserXp.lessonsCompleted`); hero XP already combined.
- Home chip / profile Level/XP / XP leaderboard — combined XP flows through automatically via `getUserXp`/`getXpRanking`.

---

## 8. Testing

- **Unit — `tests/unit/learning.test.ts` (vitest):** `gradeQuiz` (all-correct → passed, one wrong → not passed + correct `wrongQuestionIds`, missing answer → wrong); `learningTotalXp`; `learningWindowXp` (week/month/all cutoffs, `all` == total).
- **Unit — extend `tests/unit/xp.test.ts`:** `evaluateBadges` with `lessonsCompleted` (lessons_1/5/25 earned vs locked); badge category set now includes `lessons`.
- **E2E — `tests/e2e/learning.spec.ts` (playwright):** sign up → `/app/learn` → open a course → open a lesson → submit a **wrong** answer (no completion, retry shown) → submit **all-correct** (success + XP) → revisit shows completed; achievements "Lessons completed" ≥ 1. Warm server before run.

---

## 9. Plan order (single spec → phased plan)

1. Migration `0005_learning` (+ seed) and apply.
2. `lib/learning.ts` pure logic + `learning.test.ts` (TDD).
3. XP integration: extend `lib/xp.ts` badges (+ test), then `lib/server/xp.ts` (`getUserXp` combined + `getXpRanking` union).
4. `lib/server/learning.ts` + `actions/learning.ts` (service-role grading).
5. Routes: `/app/learn`, `/app/learn/[course]`, `/app/learn/[course]/[lesson]` + Quiz client component.
6. Nav "Learn" pill; achievements "Lessons completed" stat.
7. E2E `learning.spec.ts`; full `npm test`; warm-server e2e.

**Migration:** yes — `0005_learning.sql` (first new table since Phase 4).
