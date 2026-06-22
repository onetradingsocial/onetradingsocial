# Phase 7a — Admin Area (Design)

Date: 2026-06-23
Status: Approved for planning

## Purpose

Phase 7 ("Ops") decomposes into four independent slices: **admin**, feedback
(collection already shipped in Phase 7 prep), analytics, and legal. This spec
covers the **admin** slice only. Each remaining slice gets its own
spec → plan → build cycle.

Today feedback is written to `public.feedback` but there is no in-app way to read
or triage it (only the Supabase dashboard), and courses/lessons/quizzes can only
be created by hand-editing seed SQL. The admin area gives the single owner an
in-app surface to:

1. Read and triage user feedback.
2. See a few top-line counts (admin home).
3. Create and edit courses, lessons, and quizzes (full CRUD), with a
   draft/publish workflow so content can be built privately then made live.

## Decisions (from brainstorming)

- **Admin identity:** environment allowlist `ADMIN_EMAILS` (comma-separated,
  case-insensitive). No migration, no `is_admin` column, tamper-proof from the
  client, managed from the Vercel dashboard. Fits the project's "avoid migrations
  when derivable" pattern.
- **Scope of v1:** feedback triage + admin home (counts) + course/lesson/quiz CRUD.
- **Lesson body editing:** raw HTML `<textarea>` + server-side sanitization on save.
- **Draft/publish:** migration 0007 adds a `published` flag to courses and lessons.
- **Delete behavior:** soft. Whole courses/lessons are never hard-deleted from the
  admin UI — "removing" content means unpublishing it. (Quiz questions/options are
  still hard-editable, since editing a quiz means replacing its questions/options.)
- **Admin nav placement:** a conditional Admin icon link in the existing nav icon
  cluster (`ts-nav-right` in `AppNav.tsx`), rendered only when the viewer is an
  admin. There is no dropdown user menu today; this is the tucked-away equivalent.

## Architecture

### 1. Gating & identity — `lib/server/admin.ts`

- `getAdminEmails(): string[]` — parse `process.env.ADMIN_EMAILS`, split on comma,
  trim, lowercase, drop empties.
- `isAdmin(user): boolean` — true if `user?.email` (lowercased) is in the allowlist.
- `requireAdmin()` — `getUser()` via the SSR server client; if no user or not an
  admin, call `notFound()` (renders 404 — hides the route's existence rather than
  redirecting, which would confirm it exists).

`app/admin/layout.tsx` calls `requireAdmin()` once to gate the whole section.

**Defense in depth:** every admin server action ALSO calls `requireAdmin()` before
doing anything. The layout gate protects navigation; the per-action gate protects
the actual mutations. Never trust the page gate alone.

### 2. Service-role writes

`courses`, `lessons`, `quiz_questions`, `quiz_options` have **no** authenticated
INSERT/UPDATE/DELETE policy, so RLS denies all non-service writes. All admin
mutations therefore go through the existing service-role client
(`lib/supabase/service.ts`), which bypasses RLS. This is safe only because every
mutation is preceded by `requireAdmin()`.

`feedback` already has user-scoped policies; status changes are dev-only, so
`setFeedbackStatus` also uses the service client (no user UPDATE policy exists).

### 3. Migration 0007 — draft/publish

```sql
alter table public.courses add column if not exists published boolean not null default false;
alter table public.lessons add column if not exists published boolean not null default false;

-- Keep existing seeded content live.
update public.courses set published = true;
update public.lessons set published = true;

-- Users see only published content; admin reads via the service client (bypasses RLS).
drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses for select to authenticated using (published);

drop policy if exists lessons_select on public.lessons;
create policy lessons_select on public.lessons for select to authenticated using (published);
```

Because the user-facing readers in `lib/server/learning.ts` use the RLS-bound
server client, the `using(published)` policy filters drafts automatically — no
query changes needed for user-facing reads. Admin reads use the service client and
see everything.

**Caveat to verify during build:** confirm `getLessonForViewer` / `getCourseWithLessons`
behave correctly when a lesson is unpublished (RLS hides it → the lesson route
should 404 for normal users). Quiz reads already go through the service client and
are unaffected. Migration must be applied to Supabase Cloud manually (dashboard SQL
editor / `supabase db push`) — same as prior phases.

### 4. Routes — under `app/src/app/admin/`

- `admin/layout.tsx` — `requireAdmin()` gate + admin sub-nav (Home / Feedback / Courses).
- `admin/page.tsx` — **home**: counts via service client — open feedback, total
  users (profiles), total trades, total courses (and published count).
- `admin/feedback/page.tsx` — list, filterable by `status` and `type` (query params).
  Each row: type, message, user (`UserLink`), `page_url`, `created_at`, and a status
  control (open → triaged → closed). Default view: status=open, newest first.
- `admin/courses/page.tsx` — list courses with a published badge; "New course" form.
- `admin/courses/[courseId]/page.tsx` — edit course fields (slug, title, summary,
  difficulty, ord) + publish toggle; lessons list (ordered by `ord`, with publish
  badge) + "Add lesson"; reorder via `ord` edit.
- `admin/courses/[courseId]/lessons/[lessonId]/page.tsx` — edit lesson (title, slug,
  body HTML textarea, ord, xp_reward, publish toggle) **and** the quiz editor on the
  same page: list questions (prompt + ord), each with its options and a single
  `is_correct` radio; add/remove question; edit a question's options as a set.

### 5. Server actions — `app/src/app/actions/admin.ts`

All actions: `requireAdmin()` → validate input (pure validators in `lib/admin.ts`
where reusable) → service-client write → `revalidatePath(...)`.

- Feedback: `setFeedbackStatus(id, status)`.
- Course: `createCourse`, `updateCourse`, `setCoursePublished(id, published)`.
  (No delete — soft model.)
- Lesson: `createLesson`, `updateLesson`, `setLessonPublished(id, published)`.
  (No delete — soft model.)
- Quiz: `createQuestion`, `updateQuestion`, `deleteQuestion`,
  `setQuestionOptions(questionId, options[])` — replaces a question's option set
  atomically (delete existing + insert new), enforcing exactly one `is_correct`.

Validation rules (in `lib/admin.ts`, unit-tested):
- Course/lesson slug: non-empty, lowercase, `[a-z0-9-]`, length bounded; lesson slug
  unique within course (DB unique constraint already enforces; validator gives a
  friendly message).
- `xp_reward`, `ord`: non-negative integers.
- A quiz question must have ≥2 options and exactly one marked correct.

### 6. Sanitization — `lib/sanitizeHtml.ts`

Add the `sanitize-html` dependency. `sanitizeLessonHtml(dirty): string` with a tight
allowlist: `p, br, strong, em, b, i, ul, ol, li, h2, h3, h4, a, code, pre,
blockquote`; allowed attrs `a[href]` (http/https/mailto only), no `style`/`class`,
no `script`/event handlers. Sanitize **on save** in `createLesson`/`updateLesson`
so the stored body is already clean and the existing render path
(`dangerouslySetInnerHTML`) stays as-is. Closes the Phase 6 sanitization TODO.

### 7. Nav — `AppNav.tsx`

Compute `isAdmin(user)` in the server component and, when true, render an Admin icon
link (🛡, `title="Admin"`) in the `ts-nav-right` cluster next to the Settings gear.
Invisible to normal users. No layout/style overhaul.

## Testing

- **vitest** (`tests/admin.test.ts`): `getAdminEmails` parsing (commas, whitespace,
  case, empty env), `isAdmin` match/no-match; `lib/admin.ts` validators (slug, ord,
  xp, quiz one-correct rule).
- **vitest** (`tests/sanitizeHtml.test.ts`): strips `<script>`, `onclick=`,
  `javascript:` hrefs, and disallowed tags; preserves allowed tags/links.
- **e2e** (`tests/e2e/admin.spec.ts`, warm server):
  1. Non-admin signs up, visits `/app/admin` → 404.
  2. Admin (signup email present in `ADMIN_EMAILS` for the run) reaches `/app/admin`;
     changes a feedback row's status; the filter reflects it.
  3. Admin creates a course → adds a lesson → publishes course + lesson → the course
     appears in `/app/learn` for a normal user (and is absent while unpublished).
  - Test setup: set a fixed `ADMIN_EMAILS` value in the Playwright env and have the
    admin-path test sign up with exactly that email. Keep signup usernames ≤20 chars
    (short prefix + base36 stamp), consistent with prior e2e.

## Out of scope (later Phase 7 slices)

- Analytics / event tracking and metrics dashboards (admin home shows static counts
  only).
- Legal pages (privacy/terms/disclaimer).
- Multi-admin / in-app role management (env allowlist is enough for one owner).
- Feedback email/notifications and a user-facing "my submissions" view.
- Rich-text/WYSIWYG lesson editing.
- Image/media upload inside lessons.

## Files (anticipated)

New:
- `app/supabase/migrations/0007_publish_flags.sql`
- `app/src/lib/server/admin.ts`
- `app/src/lib/admin.ts` (pure validators)
- `app/src/lib/sanitizeHtml.ts`
- `app/src/app/actions/admin.ts`
- `app/src/app/admin/layout.tsx`
- `app/src/app/admin/page.tsx`
- `app/src/app/admin/feedback/page.tsx`
- `app/src/app/admin/courses/page.tsx`
- `app/src/app/admin/courses/[courseId]/page.tsx`
- `app/src/app/admin/courses/[courseId]/lessons/[lessonId]/page.tsx`
- admin client components as needed (status control, forms, quiz editor)
- `app/tests/admin.test.ts`, `app/tests/sanitizeHtml.test.ts`,
  `app/tests/e2e/admin.spec.ts`

Modified:
- `app/src/app/_components/AppNav.tsx` (conditional Admin link)
- `app/package.json` (add `sanitize-html`)
- possibly `lib/server/learning.ts` (only if the published RLS filter needs a reader tweak)

## Deployment notes

- Set `ADMIN_EMAILS` in both the app Vercel project env and `app/.env.local`.
- Apply migration 0007 to Supabase Cloud manually.
- `SUPABASE_SERVICE_ROLE_KEY` already required (Phase 6); reused here.
