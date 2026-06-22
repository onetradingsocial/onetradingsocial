# Admin Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the single owner an in-app admin area to triage feedback, see top-line counts, and CRUD courses/lessons/quizzes with a draft/publish workflow.

**Architecture:** A new `/app/admin` route tree gated by an env-allowlist admin check (`ADMIN_EMAILS`). The layout enforces the gate; every server action re-checks and writes via the service-role client (RLS denies non-service writes to content tables). A new `published` flag on courses/lessons (migration 0007) hides drafts from users via RLS while admin reads through the service client see everything. Lesson HTML is sanitized on save.

**Tech Stack:** Next.js 15 App Router (TS, RSC), Supabase (`@supabase/ssr` + service-role `supabase-js`), `sanitize-html`, vitest (unit), Playwright (e2e). Tailwind v4 + existing `ts-*` class system.

## Global Constraints

- App lives in `app/`, `basePath: '/app'`. In-app `href`/`redirect`/`revalidatePath` paths are written WITHOUT the `/app` prefix (e.g. `/admin`, `/learn`) — basePath adds it.
- Server-only secrets: `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`. Never import `lib/supabase/service.ts` into a client component.
- Content tables (`courses`, `lessons`, `quiz_questions`, `quiz_options`) have NO authenticated write policy — all writes go through `createServiceClient()`.
- Every admin server action MUST call `requireAdmin()` first.
- Unit tests: `npm test` (vitest, from `app/`). E2e: `npm run test:e2e` against a warm dev server.
- E2e signup usernames must be 3–20 chars (short prefix + base36 stamp).
- Migration 0007 must be applied to Supabase Cloud manually (dashboard SQL editor / `supabase db push`) — not auto-applied.
- TypeScript must stay clean: `npx tsc --noEmit` from `app/` passes after every task.

---

### Task 1: Migration 0007 — publish flags + RLS

**Files:**
- Create: `app/supabase/migrations/0007_publish_flags.sql`

**Interfaces:**
- Produces: `courses.published` (boolean, default false), `lessons.published` (boolean, default false); `courses_select`/`lessons_select` policies now `using(published)`.

- [ ] **Step 1: Write the migration**

```sql
-- Draft/publish flags for Learning Hub content. Drafts are hidden from users via
-- RLS; admin reads through the service-role client (bypasses RLS) and sees all.
alter table public.courses add column if not exists published boolean not null default false;
alter table public.lessons add column if not exists published boolean not null default false;

-- Keep existing seeded content live.
update public.courses set published = true;
update public.lessons set published = true;

-- Users see only published content.
drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses for select to authenticated using (published);

drop policy if exists lessons_select on public.lessons;
create policy lessons_select on public.lessons for select to authenticated using (published);
```

- [ ] **Step 2: Apply to Supabase Cloud**

Run the SQL in the Supabase dashboard SQL editor (or `supabase db push`). This is a manual step — note it in the commit body. Verify in the dashboard that `courses`/`lessons` each gained a `published` column = true for seeded rows.

- [ ] **Step 3: Commit**

```bash
git add app/supabase/migrations/0007_publish_flags.sql
git commit -m "feat(app): 0007 publish flags on courses/lessons + RLS gating drafts"
```

---

### Task 2: HTML sanitizer

**Files:**
- Create: `app/src/lib/sanitizeHtml.ts`
- Test: `app/tests/sanitizeHtml.test.ts`
- Modify: `app/package.json` (add `sanitize-html` + `@types/sanitize-html`)

**Interfaces:**
- Produces: `sanitizeLessonHtml(dirty: string): string`

- [ ] **Step 1: Install dependency**

Run (from `app/`):

```bash
npm install sanitize-html && npm install -D @types/sanitize-html
```

Expected: `package.json` gains `sanitize-html` in dependencies and `@types/sanitize-html` in devDependencies.

- [ ] **Step 2: Write the failing test**

```ts
// app/tests/sanitizeHtml.test.ts
import { describe, it, expect } from 'vitest'
import { sanitizeLessonHtml } from '@/lib/sanitizeHtml'

describe('sanitizeLessonHtml', () => {
  it('keeps allowed tags and links', () => {
    const out = sanitizeLessonHtml('<p>Hi <strong>there</strong> <a href="https://x.com">x</a></p>')
    expect(out).toContain('<strong>there</strong>')
    expect(out).toContain('href="https://x.com"')
  })
  it('strips script tags', () => {
    expect(sanitizeLessonHtml('<p>ok</p><script>alert(1)</script>')).not.toContain('<script>')
  })
  it('strips event handlers and javascript: hrefs', () => {
    const out = sanitizeLessonHtml('<a href="javascript:alert(1)" onclick="x()">bad</a>')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('javascript:')
  })
  it('drops disallowed tags but keeps inner text', () => {
    expect(sanitizeLessonHtml('<div><iframe></iframe>hello</div>')).toContain('hello')
    expect(sanitizeLessonHtml('<iframe src="x"></iframe>')).not.toContain('<iframe')
  })
})
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `npm test -- sanitizeHtml`
Expected: FAIL — cannot find module `@/lib/sanitizeHtml`.

- [ ] **Step 3: Implement the sanitizer**

```ts
// app/src/lib/sanitizeHtml.ts
import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'a', 'code', 'pre', 'blockquote']

/** Sanitize trusted-but-untrusted lesson HTML to a tight allowlist. Run on SAVE. */
export function sanitizeLessonHtml(dirty: string): string {
  return sanitizeHtml(dirty ?? '', {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sanitizeHtml`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/sanitizeHtml.ts app/tests/sanitizeHtml.test.ts app/package.json app/package-lock.json
git commit -m "feat(app): sanitizeLessonHtml + sanitize-html dep"
```

---

### Task 3: Admin identity + validators

**Files:**
- Create: `app/src/lib/admin.ts` (pure helpers: allowlist parse + match + validators)
- Create: `app/src/lib/server/admin.ts` (server gate using SSR client)
- Test: `app/tests/admin.test.ts`

**Interfaces:**
- Produces (from `lib/admin.ts`): `parseAdminEmails(raw: string | undefined): string[]`; `emailIsAdmin(email: string | null | undefined, allow: string[]): boolean`; `validateSlug(s: string): string | null`; `validateNonNegInt(n: unknown): string | null`; `validateQuizOptions(opts: { label: string; isCorrect: boolean }[]): string | null`.
- Produces (from `lib/server/admin.ts`): `isAdmin(user: { email?: string | null } | null): boolean`; `getAdminUser(): Promise<User | null>`; `requireAdmin(): Promise<User>` (calls `notFound()` if not admin).

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/admin.test.ts
import { describe, it, expect } from 'vitest'
import { parseAdminEmails, emailIsAdmin, validateSlug, validateNonNegInt, validateQuizOptions } from '@/lib/admin'

describe('parseAdminEmails', () => {
  it('splits, trims, lowercases, drops empties', () => {
    expect(parseAdminEmails(' Owner@Gmail.com , ,@Admin.Test ')).toEqual(['owner@gmail.com', '@admin.test'])
  })
  it('handles undefined', () => {
    expect(parseAdminEmails(undefined)).toEqual([])
  })
})

describe('emailIsAdmin', () => {
  const allow = ['owner@gmail.com', '@admin.test']
  it('matches exact email case-insensitively', () => {
    expect(emailIsAdmin('Owner@Gmail.com', allow)).toBe(true)
  })
  it('matches a @domain entry by suffix', () => {
    expect(emailIsAdmin('anyone@admin.test', allow)).toBe(true)
  })
  it('rejects non-listed', () => {
    expect(emailIsAdmin('user@tradingsocial.io', allow)).toBe(false)
  })
  it('rejects null email', () => {
    expect(emailIsAdmin(null, allow)).toBe(false)
  })
})

describe('validators', () => {
  it('validateSlug accepts good slugs, rejects bad', () => {
    expect(validateSlug('risk-basics')).toBeNull()
    expect(validateSlug('Bad Slug')).toBeTruthy()
    expect(validateSlug('')).toBeTruthy()
  })
  it('validateNonNegInt', () => {
    expect(validateNonNegInt(0)).toBeNull()
    expect(validateNonNegInt(-1)).toBeTruthy()
    expect(validateNonNegInt(1.5)).toBeTruthy()
  })
  it('validateQuizOptions requires >=2 and exactly one correct', () => {
    expect(validateQuizOptions([{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: false }])).toBeNull()
    expect(validateQuizOptions([{ label: 'a', isCorrect: true }])).toBeTruthy()
    expect(validateQuizOptions([{ label: 'a', isCorrect: false }, { label: 'b', isCorrect: false }])).toBeTruthy()
    expect(validateQuizOptions([{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: true }])).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- admin`
Expected: FAIL — cannot find module `@/lib/admin`.

- [ ] **Step 3: Implement pure helpers**

```ts
// app/src/lib/admin.ts
/** Parse ADMIN_EMAILS: comma-separated, trimmed, lowercased, empties dropped.
 *  Entries may be an exact email or a "@domain" suffix match. */
export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function emailIsAdmin(email: string | null | undefined, allow: string[]): boolean {
  if (!email) return false
  const e = email.toLowerCase()
  return allow.some((entry) => (entry.startsWith('@') ? e.endsWith(entry) : e === entry))
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function validateSlug(s: string): string | null {
  if (!s) return 'Slug is required.'
  if (s.length > 60) return 'Slug is too long (60 max).'
  if (!SLUG_RE.test(s)) return 'Slug must be lowercase letters, numbers, and single hyphens.'
  return null
}

export function validateNonNegInt(n: unknown): string | null {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return 'Must be a non-negative whole number.'
  return null
}

export function validateQuizOptions(opts: { label: string; isCorrect: boolean }[]): string | null {
  if (opts.length < 2) return 'A question needs at least 2 options.'
  if (opts.some((o) => !o.label.trim())) return 'Every option needs a label.'
  if (opts.filter((o) => o.isCorrect).length !== 1) return 'Exactly one option must be correct.'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- admin`
Expected: PASS.

- [ ] **Step 5: Implement the server gate**

```ts
// app/src/lib/server/admin.ts
import 'server-only'
import { notFound } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { parseAdminEmails, emailIsAdmin } from '@/lib/admin'

export function isAdmin(user: { email?: string | null } | null): boolean {
  return emailIsAdmin(user?.email ?? null, parseAdminEmails(process.env.ADMIN_EMAILS))
}

export async function getAdminUser(): Promise<User | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user && isAdmin(user) ? user : null
}

/** Gate for admin pages + every admin server action. 404s non-admins (hides the route). */
export async function requireAdmin(): Promise<User> {
  const user = await getAdminUser()
  if (!user) notFound()
  return user
}
```

If `server-only` is not already a dependency, install it: `npm install server-only`. (Next ships it transitively; if `tsc` errors on the import, add it explicitly.)

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add app/src/lib/admin.ts app/src/lib/server/admin.ts app/tests/admin.test.ts app/package.json app/package-lock.json
git commit -m "feat(app): admin identity (env allowlist) + validators"
```

---

### Task 4: Admin layout, gate, and home page

**Files:**
- Create: `app/src/app/admin/layout.tsx`
- Create: `app/src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `requireAdmin()` from `@/lib/server/admin`; `createServiceClient()` from `@/lib/supabase/service`.
- Produces: `/admin` route gated; admin sub-nav available to child pages.

- [ ] **Step 1: Implement the gated layout**

```tsx
// app/src/app/admin/layout.tsx
import Link from 'next/link'
import { requireAdmin } from '@/lib/server/admin'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return (
    <main className="ts-page" style={{ maxWidth: 980 }}>
      <header className="lb-head"><div className="tx">
        <h1 className="ts-h1">Admin</h1>
        <p>Owner tools — feedback triage and learning content.</p>
      </div></header>
      <nav className="ts-nav-links mt-3" style={{ gap: 16 }}>
        <Link className="ts-nav-link" href="/admin">Home</Link>
        <Link className="ts-nav-link" href="/admin/feedback">Feedback</Link>
        <Link className="ts-nav-link" href="/admin/courses">Courses</Link>
      </nav>
      <div className="mt-6">{children}</div>
    </main>
  )
}
```

- [ ] **Step 2: Implement the home page with counts**

```tsx
// app/src/app/admin/page.tsx
import { createServiceClient } from '@/lib/supabase/service'

async function count(table: string, filter?: (q: any) => any): Promise<number> {
  const svc = createServiceClient()
  let q = svc.from(table).select('id', { count: 'exact', head: true })
  if (filter) q = filter(q)
  const { count } = await q
  return count ?? 0
}

export default async function AdminHome() {
  const [openFeedback, users, trades, courses] = await Promise.all([
    count('feedback', (q) => q.eq('status', 'open')),
    count('profiles'),
    count('trades'),
    count('courses'),
  ])
  const cards = [
    { label: 'Open feedback', value: openFeedback },
    { label: 'Users', value: users },
    { label: 'Trades logged', value: trades },
    { label: 'Courses', value: courses },
  ]
  return (
    <div className="stat-grid">
      {cards.map((c) => (
        <div key={c.label} className="ts-card stat-card">
          <span className="faint" style={{ fontSize: 13 }}>{c.label}</span>
          <strong style={{ fontSize: 28 }}>{c.value}</strong>
        </div>
      ))}
    </div>
  )
}
```

(If `stat-grid`/`stat-card` are not in `globals.css`, fall back to `learn-grid` + `ts-card`; verify against existing class names in `app/src/app/globals.css` before finalizing.)

- [ ] **Step 3: Verify the gate manually + typecheck**

Run: `npx tsc --noEmit` → no errors.
Start dev server (`npm run dev`), as a non-admin visit `/app/admin` → 404; as admin → counts render. (Full e2e in Task 10.)

- [ ] **Step 4: Commit**

```bash
git add app/src/app/admin/layout.tsx app/src/app/admin/page.tsx
git commit -m "feat(app): admin layout gate + home counts"
```

---

### Task 5: Feedback triage

**Files:**
- Create: `app/src/app/actions/admin.ts` (feedback action first; grows in later tasks)
- Create: `app/src/app/admin/feedback/page.tsx`
- Create: `app/src/app/admin/_components/FeedbackStatus.tsx`

**Interfaces:**
- Consumes: `requireAdmin`, `createServiceClient`, `FEEDBACK_TYPE_LABELS` from `@/lib/feedback`.
- Produces: `setFeedbackStatus(id: string, status: 'open' | 'triaged' | 'closed'): Promise<{ error?: string }>`.

- [ ] **Step 1: Implement the action**

```ts
// app/src/app/actions/admin.ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'

const FEEDBACK_STATUSES = ['open', 'triaged', 'closed'] as const
type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<{ error?: string }> {
  await requireAdmin()
  if (!FEEDBACK_STATUSES.includes(status)) return { error: 'Bad status.' }
  const svc = createServiceClient()
  const { error } = await svc.from('feedback').update({ status }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  revalidatePath('/admin/feedback')
  return {}
}
```

- [ ] **Step 2: Implement the status control (client component)**

```tsx
// app/src/app/admin/_components/FeedbackStatus.tsx
'use client'

import { useState, useTransition } from 'react'
import { setFeedbackStatus } from '@/app/actions/admin'

const OPTIONS = ['open', 'triaged', 'closed'] as const

export function FeedbackStatus({ id, status }: { id: string; status: string }) {
  const [value, setValue] = useState(status)
  const [pending, start] = useTransition()
  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as (typeof OPTIONS)[number]
        setValue(next)
        start(() => { setFeedbackStatus(id, next) })
      }}
    >
      {OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
```

- [ ] **Step 3: Implement the feedback list page**

```tsx
// app/src/app/admin/feedback/page.tsx
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { FEEDBACK_TYPE_LABELS, type FeedbackType } from '@/lib/feedback'
import { FeedbackStatus } from '../_components/FeedbackStatus'

type Search = { status?: string; type?: string }

export default async function AdminFeedback({ searchParams }: { searchParams: Promise<Search> }) {
  const { status = 'open', type } = await searchParams
  const svc = createServiceClient()
  let q = svc.from('feedback')
    .select('id, type, message, page_url, status, created_at, profiles(username)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (status !== 'all') q = q.eq('status', status)
  if (type) q = q.eq('type', type)
  const { data: rows } = await q

  const statusTabs = ['open', 'triaged', 'closed', 'all']
  return (
    <div>
      <nav className="ts-nav-links" style={{ gap: 12, marginBottom: 16 }}>
        {statusTabs.map((s) => (
          <Link key={s} className="ts-nav-link" href={`/admin/feedback?status=${s}${type ? `&type=${type}` : ''}`}
            style={{ fontWeight: s === status ? 700 : 400 }}>{s}</Link>
        ))}
      </nav>
      <div className="ts-card" style={{ padding: 0 }}>
        {(rows ?? []).length === 0 && <p className="faint" style={{ padding: 16 }}>No feedback.</p>}
        {(rows ?? []).map((r) => {
          const username = (r.profiles as { username: string } | null)?.username
          return (
            <div key={r.id} className="fb-row" style={{ display: 'grid', gap: 6, padding: 16, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="eyebrow">{FEEDBACK_TYPE_LABELS[r.type as FeedbackType] ?? r.type}</span>
                {username && <Link className="ts-nav-link" href={`/${username}`}>@{username}</Link>}
                <span className="faint" style={{ fontSize: 12 }}>{new Date(r.created_at).toLocaleString()}</span>
                <span style={{ marginLeft: 'auto' }}><FeedbackStatus id={r.id} status={r.status} /></span>
              </div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{r.message}</p>
              {r.page_url && <span className="faint" style={{ fontSize: 12 }}>{r.page_url}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add app/src/app/actions/admin.ts app/src/app/admin/feedback/page.tsx app/src/app/admin/_components/FeedbackStatus.tsx
git commit -m "feat(app): admin feedback triage (list + status control)"
```

---

### Task 6: Course list + create/update/publish actions

**Files:**
- Modify: `app/src/app/actions/admin.ts` (add course actions)
- Create: `app/src/app/admin/courses/page.tsx`
- Create: `app/src/app/admin/_components/NewCourseForm.tsx`

**Interfaces:**
- Consumes: `validateSlug`, `validateNonNegInt` from `@/lib/admin`.
- Produces: `createCourse(input: CourseInput): Promise<{ id?: string; error?: string }>`; `updateCourse(id: string, input: CourseInput): Promise<{ error?: string }>`; `setCoursePublished(id: string, published: boolean): Promise<{ error?: string }>`. `type CourseInput = { slug: string; title: string; summary: string; difficulty: string; ord: number }`.

- [ ] **Step 1: Add course actions to `actions/admin.ts`**

Append:

```ts
import { validateSlug, validateNonNegInt } from '@/lib/admin'

export type CourseInput = { slug: string; title: string; summary: string; difficulty: string; ord: number }

function checkCourse(input: CourseInput): string | null {
  if (!input.title.trim()) return 'Title is required.'
  return validateSlug(input.slug) ?? validateNonNegInt(input.ord)
}

export async function createCourse(input: CourseInput): Promise<{ id?: string; error?: string }> {
  await requireAdmin()
  const err = checkCourse(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  const { data, error } = await svc.from('courses').insert({
    slug: input.slug, title: input.title, summary: input.summary || null,
    difficulty: input.difficulty || null, ord: input.ord, published: false,
  }).select('id').single()
  if (error) return { error: error.message.includes('duplicate') ? 'Slug already exists.' : 'Create failed.' }
  revalidatePath('/admin/courses')
  return { id: data.id }
}

export async function updateCourse(id: string, input: CourseInput): Promise<{ error?: string }> {
  await requireAdmin()
  const err = checkCourse(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  const { error } = await svc.from('courses').update({
    slug: input.slug, title: input.title, summary: input.summary || null,
    difficulty: input.difficulty || null, ord: input.ord,
  }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  revalidatePath('/admin/courses')
  revalidatePath(`/admin/courses/${id}`)
  revalidatePath('/learn')
  return {}
}

export async function setCoursePublished(id: string, published: boolean): Promise<{ error?: string }> {
  await requireAdmin()
  const svc = createServiceClient()
  const { error } = await svc.from('courses').update({ published }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  revalidatePath('/admin/courses')
  revalidatePath(`/admin/courses/${id}`)
  revalidatePath('/learn')
  return {}
}
```

- [ ] **Step 2: Implement the new-course form (client component)**

```tsx
// app/src/app/admin/_components/NewCourseForm.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createCourse } from '@/app/actions/admin'

export function NewCourseForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <form
      className="ts-card mt-4"
      style={{ display: 'grid', gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        start(async () => {
          const res = await createCourse({
            slug: String(f.get('slug') ?? ''), title: String(f.get('title') ?? ''),
            summary: String(f.get('summary') ?? ''), difficulty: String(f.get('difficulty') ?? ''),
            ord: Number(f.get('ord') ?? 0),
          })
          if (res.error) setError(res.error)
          else if (res.id) router.push(`/admin/courses/${res.id}`)
        })
      }}
    >
      <strong>New course</strong>
      <input name="title" placeholder="Title" required />
      <input name="slug" placeholder="slug-like-this" required />
      <input name="summary" placeholder="Summary" />
      <input name="difficulty" placeholder="beginner / intermediate / advanced" />
      <input name="ord" type="number" defaultValue={0} min={0} aria-label="Order" />
      {error && <span style={{ color: 'var(--danger, #e5484d)' }}>{error}</span>}
      <button className="btn btn-primary btn-sm" disabled={pending} type="submit">Create</button>
    </form>
  )
}
```

- [ ] **Step 3: Implement the courses list page**

```tsx
// app/src/app/admin/courses/page.tsx
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { NewCourseForm } from '../_components/NewCourseForm'

export default async function AdminCourses() {
  const svc = createServiceClient()
  const { data: courses } = await svc.from('courses').select('id, title, slug, published, ord').order('ord')
  return (
    <div>
      <div className="ts-card" style={{ padding: 0 }}>
        {(courses ?? []).map((c) => (
          <Link key={c.id} href={`/admin/courses/${c.id}`}
            style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 14, borderTop: '1px solid var(--border)' }}>
            <strong>{c.title}</strong>
            <span className="faint" style={{ fontSize: 12 }}>/{c.slug}</span>
            <span className="eyebrow" style={{ marginLeft: 'auto' }}>{c.published ? 'Published' : 'Draft'}</span>
          </Link>
        ))}
      </div>
      <NewCourseForm />
    </div>
  )
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add app/src/app/actions/admin.ts app/src/app/admin/courses/page.tsx app/src/app/admin/_components/NewCourseForm.tsx
git commit -m "feat(app): admin course list + create/update/publish actions"
```

---

### Task 7: Course detail (edit course + lessons list) + lesson actions

**Files:**
- Modify: `app/src/app/actions/admin.ts` (add lesson actions)
- Create: `app/src/app/admin/courses/[courseId]/page.tsx`
- Create: `app/src/app/admin/_components/CourseEditForm.tsx`
- Create: `app/src/app/admin/_components/PublishToggle.tsx`

**Interfaces:**
- Consumes: `updateCourse`, `setCoursePublished`, `CourseInput`.
- Produces: `createLesson(courseId: string, input: LessonInput): Promise<{ id?: string; error?: string }>`; `updateLesson(id: string, input: LessonInput): Promise<{ error?: string }>`; `setLessonPublished(id: string, published: boolean): Promise<{ error?: string }>`. `type LessonInput = { slug: string; title: string; body: string; ord: number; xpReward: number }`.

- [ ] **Step 1: Add lesson actions to `actions/admin.ts`**

Append:

```ts
import { sanitizeLessonHtml } from '@/lib/sanitizeHtml'

export type LessonInput = { slug: string; title: string; body: string; ord: number; xpReward: number }

function checkLesson(input: LessonInput): string | null {
  if (!input.title.trim()) return 'Title is required.'
  return validateSlug(input.slug) ?? validateNonNegInt(input.ord) ?? validateNonNegInt(input.xpReward)
}

export async function createLesson(courseId: string, input: LessonInput): Promise<{ id?: string; error?: string }> {
  await requireAdmin()
  const err = checkLesson(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  const { data, error } = await svc.from('lessons').insert({
    course_id: courseId, slug: input.slug, title: input.title,
    body: sanitizeLessonHtml(input.body), ord: input.ord, xp_reward: input.xpReward, published: false,
  }).select('id').single()
  if (error) return { error: error.message.includes('duplicate') ? 'Slug already used in this course.' : 'Create failed.' }
  revalidatePath(`/admin/courses/${courseId}`)
  return { id: data.id }
}

export async function updateLesson(id: string, input: LessonInput): Promise<{ error?: string }> {
  await requireAdmin()
  const err = checkLesson(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  const { error } = await svc.from('lessons').update({
    slug: input.slug, title: input.title, body: sanitizeLessonHtml(input.body),
    ord: input.ord, xp_reward: input.xpReward,
  }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  revalidatePath(`/admin/courses/${id}`)
  revalidatePath('/learn')
  return {}
}

export async function setLessonPublished(id: string, published: boolean): Promise<{ error?: string }> {
  await requireAdmin()
  const svc = createServiceClient()
  const { error } = await svc.from('lessons').update({ published }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  revalidatePath('/learn')
  return {}
}
```

- [ ] **Step 2: Implement a reusable publish toggle (client component)**

```tsx
// app/src/app/admin/_components/PublishToggle.tsx
'use client'

import { useState, useTransition } from 'react'

export function PublishToggle({ published, action }: { published: boolean; action: (next: boolean) => Promise<{ error?: string }> }) {
  const [on, setOn] = useState(published)
  const [pending, start] = useTransition()
  return (
    <button type="button" className="btn btn-sm" disabled={pending}
      onClick={() => start(async () => { const r = await action(!on); if (!r.error) setOn(!on) })}>
      {on ? 'Published — click to unpublish' : 'Draft — click to publish'}
    </button>
  )
}
```

Note: passing a server action as the `action` prop from a server component is allowed. In the page, wrap with a bound closure: `setCoursePublished.bind(null, course.id)`.

- [ ] **Step 3: Implement the course edit form (client component)**

```tsx
// app/src/app/admin/_components/CourseEditForm.tsx
'use client'

import { useState, useTransition } from 'react'
import { updateCourse, type CourseInput } from '@/app/actions/admin'

export function CourseEditForm({ id, initial }: { id: string; initial: CourseInput }) {
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()
  return (
    <form className="ts-card" style={{ display: 'grid', gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        start(async () => {
          setSaved(false); setError(null)
          const res = await updateCourse(id, {
            slug: String(f.get('slug') ?? ''), title: String(f.get('title') ?? ''),
            summary: String(f.get('summary') ?? ''), difficulty: String(f.get('difficulty') ?? ''),
            ord: Number(f.get('ord') ?? 0),
          })
          if (res.error) setError(res.error); else setSaved(true)
        })
      }}>
      <input name="title" defaultValue={initial.title} required />
      <input name="slug" defaultValue={initial.slug} required />
      <input name="summary" defaultValue={initial.summary} placeholder="Summary" />
      <input name="difficulty" defaultValue={initial.difficulty} placeholder="Difficulty" />
      <input name="ord" type="number" defaultValue={initial.ord} min={0} aria-label="Order" />
      {error && <span style={{ color: 'var(--danger, #e5484d)' }}>{error}</span>}
      {saved && <span className="faint">Saved.</span>}
      <button className="btn btn-primary btn-sm" disabled={pending} type="submit">Save course</button>
    </form>
  )
}
```

- [ ] **Step 4: Implement the course detail page**

```tsx
// app/src/app/admin/courses/[courseId]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { setCoursePublished } from '@/app/actions/admin'
import { CourseEditForm } from '../../_components/CourseEditForm'
import { PublishToggle } from '../../_components/PublishToggle'

export default async function CourseDetail({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  const svc = createServiceClient()
  const { data: course } = await svc.from('courses')
    .select('id, slug, title, summary, difficulty, ord, published').eq('id', courseId).maybeSingle()
  if (!course) notFound()
  const { data: lessons } = await svc.from('lessons')
    .select('id, slug, title, ord, published').eq('course_id', courseId).order('ord')

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Link className="ts-nav-link" href="/admin/courses">← All courses</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 className="ts-h2">{course.title}</h2>
        <span style={{ marginLeft: 'auto' }}>
          <PublishToggle published={course.published} action={setCoursePublished.bind(null, course.id)} />
        </span>
      </div>
      <CourseEditForm id={course.id} initial={{
        slug: course.slug, title: course.title, summary: course.summary ?? '',
        difficulty: course.difficulty ?? '', ord: course.ord,
      }} />

      <div>
        <h3 className="ts-h3">Lessons</h3>
        <div className="ts-card mt-3" style={{ padding: 0 }}>
          {(lessons ?? []).map((l) => (
            <Link key={l.id} href={`/admin/courses/${course.id}/lessons/${l.id}`}
              style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 12, borderTop: '1px solid var(--border)' }}>
              <span className="faint">{l.ord}</span>
              <strong>{l.title}</strong>
              <span className="eyebrow" style={{ marginLeft: 'auto' }}>{l.published ? 'Published' : 'Draft'}</span>
            </Link>
          ))}
        </div>
        <Link className="btn btn-sm mt-3" href={`/admin/courses/${course.id}/lessons/new`}>+ Add lesson</Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add app/src/app/actions/admin.ts "app/src/app/admin/courses/[courseId]/page.tsx" app/src/app/admin/_components/CourseEditForm.tsx app/src/app/admin/_components/PublishToggle.tsx
git commit -m "feat(app): admin course detail + lesson actions + publish toggle"
```

---

### Task 8: Lesson editor + quiz editor + quiz actions

**Files:**
- Modify: `app/src/app/actions/admin.ts` (add quiz actions)
- Create: `app/src/app/admin/courses/[courseId]/lessons/new/page.tsx`
- Create: `app/src/app/admin/courses/[courseId]/lessons/[lessonId]/page.tsx`
- Create: `app/src/app/admin/_components/LessonEditForm.tsx`
- Create: `app/src/app/admin/_components/QuizEditor.tsx`

**Interfaces:**
- Consumes: `createLesson`, `updateLesson`, `setLessonPublished`, `LessonInput`, `validateQuizOptions`.
- Produces: `setLessonQuiz(lessonId: string, questions: QuestionInput[]): Promise<{ error?: string }>` where `type QuestionInput = { prompt: string; options: { label: string; isCorrect: boolean }[] }`. (Replaces the whole quiz for a lesson — simplest correct model: delete existing questions for the lesson, re-insert. Cascade deletes their options.)

- [ ] **Step 1: Add the quiz action to `actions/admin.ts`**

Append:

```ts
import { validateQuizOptions } from '@/lib/admin'

export type QuestionInput = { prompt: string; options: { label: string; isCorrect: boolean }[] }

export async function setLessonQuiz(lessonId: string, questions: QuestionInput[]): Promise<{ error?: string }> {
  await requireAdmin()
  for (const q of questions) {
    if (!q.prompt.trim()) return { error: 'Every question needs a prompt.' }
    const e = validateQuizOptions(q.options)
    if (e) return { error: e }
  }
  const svc = createServiceClient()
  // Replace the whole quiz: delete existing questions (cascades to options), re-insert.
  await svc.from('quiz_questions').delete().eq('lesson_id', lessonId)
  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi]
    const { data: inserted, error } = await svc.from('quiz_questions')
      .insert({ lesson_id: lessonId, prompt: q.prompt, ord: qi }).select('id').single()
    if (error || !inserted) return { error: 'Save failed.' }
    const optRows = q.options.map((o, oi) => ({ question_id: inserted.id, label: o.label, is_correct: o.isCorrect, ord: oi }))
    const { error: optErr } = await svc.from('quiz_options').insert(optRows)
    if (optErr) return { error: 'Save failed.' }
  }
  revalidatePath('/learn')
  return {}
}
```

- [ ] **Step 2: Implement the lesson edit form (client component)**

```tsx
// app/src/app/admin/_components/LessonEditForm.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createLesson, updateLesson, type LessonInput } from '@/app/actions/admin'

export function LessonEditForm({ courseId, lessonId, initial }: {
  courseId: string; lessonId?: string; initial: LessonInput
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()
  return (
    <form className="ts-card" style={{ display: 'grid', gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const input: LessonInput = {
          slug: String(f.get('slug') ?? ''), title: String(f.get('title') ?? ''),
          body: String(f.get('body') ?? ''), ord: Number(f.get('ord') ?? 0),
          xpReward: Number(f.get('xpReward') ?? 0),
        }
        start(async () => {
          setSaved(false); setError(null)
          const res = lessonId ? await updateLesson(lessonId, input) : await createLesson(courseId, input)
          if (res.error) setError(res.error)
          else if (!lessonId && 'id' in res && res.id) router.push(`/admin/courses/${courseId}/lessons/${res.id}`)
          else setSaved(true)
        })
      }}>
      <input name="title" defaultValue={initial.title} placeholder="Title" required />
      <input name="slug" defaultValue={initial.slug} placeholder="slug" required />
      <textarea name="body" defaultValue={initial.body} placeholder="Lesson HTML" rows={12} style={{ fontFamily: 'monospace' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <input name="ord" type="number" defaultValue={initial.ord} min={0} aria-label="Order" />
        <input name="xpReward" type="number" defaultValue={initial.xpReward} min={0} aria-label="XP reward" />
      </div>
      {error && <span style={{ color: 'var(--danger, #e5484d)' }}>{error}</span>}
      {saved && <span className="faint">Saved.</span>}
      <button className="btn btn-primary btn-sm" disabled={pending} type="submit">{lessonId ? 'Save lesson' : 'Create lesson'}</button>
    </form>
  )
}
```

- [ ] **Step 3: Implement the quiz editor (client component)**

```tsx
// app/src/app/admin/_components/QuizEditor.tsx
'use client'

import { useState, useTransition } from 'react'
import { setLessonQuiz, type QuestionInput } from '@/app/actions/admin'

export function QuizEditor({ lessonId, initial }: { lessonId: string; initial: QuestionInput[] }) {
  const [questions, setQuestions] = useState<QuestionInput[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()

  const update = (fn: (qs: QuestionInput[]) => QuestionInput[]) => setQuestions((qs) => fn(structuredClone(qs)))

  return (
    <div className="ts-card" style={{ display: 'grid', gap: 12 }}>
      <strong>Quiz</strong>
      {questions.map((q, qi) => (
        <div key={qi} className="quiz-q-edit" style={{ display: 'grid', gap: 6, padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
          <input value={q.prompt} placeholder="Question prompt"
            onChange={(e) => update((qs) => { qs[qi].prompt = e.target.value; return qs })} />
          {q.options.map((o, oi) => (
            <div key={oi} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="radio" name={`correct-${qi}`} checked={o.isCorrect}
                onChange={() => update((qs) => { qs[qi].options = qs[qi].options.map((x, i) => ({ ...x, isCorrect: i === oi })); return qs })} />
              <input value={o.label} placeholder={`Option ${oi + 1}`} style={{ flex: 1 }}
                onChange={(e) => update((qs) => { qs[qi].options[oi].label = e.target.value; return qs })} />
              <button type="button" className="btn btn-sm"
                onClick={() => update((qs) => { qs[qi].options.splice(oi, 1); return qs })}>×</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm"
              onClick={() => update((qs) => { qs[qi].options.push({ label: '', isCorrect: false }); return qs })}>+ Option</button>
            <button type="button" className="btn btn-sm"
              onClick={() => update((qs) => { qs.splice(qi, 1); return qs })}>Remove question</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-sm"
        onClick={() => update((qs) => { qs.push({ prompt: '', options: [{ label: '', isCorrect: true }, { label: '', isCorrect: false }] }); return qs })}>+ Question</button>
      {error && <span style={{ color: 'var(--danger, #e5484d)' }}>{error}</span>}
      {saved && <span className="faint">Quiz saved.</span>}
      <button type="button" className="btn btn-primary btn-sm" disabled={pending}
        onClick={() => start(async () => { setSaved(false); setError(null); const r = await setLessonQuiz(lessonId, questions); if (r.error) setError(r.error); else setSaved(true) })}>
        Save quiz
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Implement the "new lesson" page**

```tsx
// app/src/app/admin/courses/[courseId]/lessons/new/page.tsx
import { LessonEditForm } from '@/app/admin/_components/LessonEditForm'

export default async function NewLesson({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h2 className="ts-h2">New lesson</h2>
      <LessonEditForm courseId={courseId} initial={{ slug: '', title: '', body: '', ord: 0, xpReward: 100 }} />
      <p className="faint">Save the lesson first, then add its quiz.</p>
    </div>
  )
}
```

- [ ] **Step 5: Implement the lesson edit page (with quiz)**

```tsx
// app/src/app/admin/courses/[courseId]/lessons/[lessonId]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { setLessonPublished, type QuestionInput } from '@/app/actions/admin'
import { LessonEditForm } from '@/app/admin/_components/LessonEditForm'
import { QuizEditor } from '@/app/admin/_components/QuizEditor'
import { PublishToggle } from '@/app/admin/_components/PublishToggle'

export default async function LessonEdit({ params }: { params: Promise<{ courseId: string; lessonId: string }> }) {
  const { courseId, lessonId } = await params
  const svc = createServiceClient()
  const { data: lesson } = await svc.from('lessons')
    .select('id, slug, title, body, ord, xp_reward, published').eq('id', lessonId).maybeSingle()
  if (!lesson) notFound()
  const { data: questions } = await svc.from('quiz_questions')
    .select('id, prompt, ord, quiz_options(label, is_correct, ord)').eq('lesson_id', lessonId).order('ord')
  const initialQuiz: QuestionInput[] = (questions ?? []).map((q) => ({
    prompt: q.prompt,
    options: ((q.quiz_options as { label: string; is_correct: boolean; ord: number }[]) ?? [])
      .sort((a, b) => a.ord - b.ord).map((o) => ({ label: o.label, isCorrect: o.is_correct })),
  }))

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Link className="ts-nav-link" href={`/admin/courses/${courseId}`}>← Back to course</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 className="ts-h2">Edit lesson</h2>
        <span style={{ marginLeft: 'auto' }}>
          <PublishToggle published={lesson.published} action={setLessonPublished.bind(null, lesson.id)} />
        </span>
      </div>
      <LessonEditForm courseId={courseId} lessonId={lesson.id} initial={{
        slug: lesson.slug, title: lesson.title, body: lesson.body, ord: lesson.ord, xpReward: lesson.xp_reward,
      }} />
      <QuizEditor lessonId={lesson.id} initial={initialQuiz} />
    </div>
  )
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add app/src/app/actions/admin.ts "app/src/app/admin/courses/[courseId]/lessons" app/src/app/admin/_components/LessonEditForm.tsx app/src/app/admin/_components/QuizEditor.tsx
git commit -m "feat(app): admin lesson editor + quiz editor + setLessonQuiz"
```

---

### Task 9: Conditional Admin link in nav

**Files:**
- Modify: `app/src/app/_components/AppNav.tsx`

**Interfaces:**
- Consumes: `isAdmin` from `@/lib/server/admin`.

- [ ] **Step 1: Add the conditional link**

In `AppNav.tsx`, import `isAdmin` and render an Admin icon link in the `ts-nav-right` cluster, just before the Settings link, only when the viewer is an admin:

```tsx
import { isAdmin } from '@/lib/server/admin'
```

Then inside `ts-nav-right`, before the `<Link href="/settings" ...>`:

```tsx
{isAdmin(user) && (
  <Link href="/admin" className="ts-nav-icon" title="Admin" aria-label="Admin">🛡</Link>
)}
```

(`user` is already in scope from `supabase.auth.getUser()` at the top of the component.)

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add app/src/app/_components/AppNav.tsx
git commit -m "feat(app): conditional Admin nav link for admins"
```

---

### Task 10: E2E — admin gate, feedback triage, course publish flow

**Files:**
- Create: `app/tests/e2e/admin.spec.ts`
- Modify: `app/.env.local` (add `ADMIN_EMAILS` including the e2e admin domain) — local only, untracked.

**Interfaces:**
- Consumes: the full admin surface.

- [ ] **Step 1: Configure the admin allowlist for the test run**

Add to `app/.env.local` (untracked):

```
ADMIN_EMAILS=onetradingsocial@gmail.com,@admin.tradingsocial.test
```

Restart the dev server so it picks up the env. The `@admin.tradingsocial.test` domain entry makes any e2e user signed up under that domain an admin, with a unique email per run (no collisions).

- [ ] **Step 2: Write the e2e spec**

```ts
// app/tests/e2e/admin.spec.ts
import { test, expect, type Page } from '@playwright/test'

async function signUpAndOnboard(page: Page, prefix: string, domain = 'tradingsocial.io') {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36)
  const username = `${prefix}_${stamp}`.slice(0, 20)
  await page.goto('/app/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@${domain}`)
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

test('non-admin cannot reach the admin area', async ({ page }) => {
  await signUpAndOnboard(page, 'na')
  const res = await page.goto('/app/admin')
  expect(res?.status()).toBe(404)
})

test('admin can publish a new course and it appears in Learn', async ({ page }) => {
  await signUpAndOnboard(page, 'ad', 'admin.tradingsocial.test')

  // Create a course
  const slug = 'e2e-' + Date.now().toString(36)
  await page.goto('/app/admin/courses')
  await page.fill('input[name="title"]', 'E2E Course')
  await page.fill('input[name="slug"]', slug)
  await page.click('button:has-text("Create")')
  await expect(page).toHaveURL(/\/app\/admin\/courses\/[0-9a-f-]+/)

  // Publish the course
  await page.click('button:has-text("Draft — click to publish")')
  await expect(page.locator('button:has-text("Published")')).toBeVisible()

  // Add + publish a lesson
  await page.click('text=+ Add lesson')
  await page.fill('input[name="title"]', 'E2E Lesson')
  await page.fill('input[name="slug"]', 'e2e-lesson')
  await page.fill('textarea[name="body"]', '<p>hello</p>')
  await page.click('button:has-text("Create lesson")')
  await expect(page).toHaveURL(/\/lessons\/[0-9a-f-]+/)
  await page.click('button:has-text("Draft — click to publish")')
  await expect(page.locator('button:has-text("Published")')).toBeVisible()

  // It now shows in Learn
  await page.goto('/app/learn')
  await expect(page.getByText('E2E Course')).toBeVisible()
})

test('admin can change feedback status', async ({ page }) => {
  await signUpAndOnboard(page, 'fb', 'admin.tradingsocial.test')
  await page.goto('/app/admin/feedback')
  // If a feedback row exists, flipping its status persists across reload.
  const firstSelect = page.locator('select').first()
  if (await firstSelect.count()) {
    await firstSelect.selectOption('triaged')
    await page.goto('/app/admin/feedback?status=triaged')
    await expect(page.locator('select').first()).toHaveValue('triaged')
  }
})
```

- [ ] **Step 3: Run the e2e against a warm server**

Ensure `npm run dev` is running and warm (hit `/app/admin` once). Then:

Run: `npm run test:e2e -- admin`
Expected: PASS (3 tests). The feedback test no-ops gracefully if no feedback rows exist.

- [ ] **Step 4: Commit**

```bash
git add app/tests/e2e/admin.spec.ts
git commit -m "test(app): e2e admin gate, course publish flow, feedback status"
```

---

## Self-Review

**Spec coverage:**
- Gating/identity (env allowlist, requireAdmin, per-action recheck) → Tasks 3, 4, all action tasks. ✓
- Service-role writes → Tasks 5–8. ✓
- Migration 0007 publish flags + RLS → Task 1. ✓
- Admin home counts → Task 4. ✓
- Feedback triage → Task 5. ✓
- Course CRUD → Tasks 6, 7. ✓
- Lesson CRUD + quiz editor → Tasks 7, 8. ✓
- Sanitization on save → Task 2 (sanitizer) + Task 7 (applied in create/update lesson). ✓
- Conditional nav link → Task 9. ✓
- Tests (vitest unit + e2e) → Tasks 2, 3, 10. ✓
- Soft delete (no hard delete actions; unpublish only) → reflected: no `deleteCourse`/`deleteLesson` actions exist. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete. ✓

**Type consistency:** `CourseInput`, `LessonInput`, `QuestionInput` defined in `actions/admin.ts` and consumed by client forms with matching field names (`xpReward`, `isCorrect`). `setCoursePublished`/`setLessonPublished` bound via `.bind(null, id)` and passed to `PublishToggle`'s `action(next: boolean)` signature — matches. `setLessonQuiz(lessonId, QuestionInput[])` consumed by `QuizEditor` — matches. ✓

**Open risk flagged for executor:** verify `stat-grid`/`stat-card` classes exist in `globals.css` (Task 4) — fall back to existing card classes if not. Confirm `lib/server/learning.ts` user reads still behave with the `using(published)` RLS (drafts 404 for users) — no query change expected, but verify during Task 1/10.
