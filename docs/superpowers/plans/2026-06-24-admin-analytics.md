# Admin Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only `/admin/analytics` dashboard covering growth, engagement, content, and ops — derived purely from existing tables, no migration.

**Architecture:** Four layers mirroring `lib/leaderboard.ts` / `lib/xp.ts`: a pure `lib/analytics.ts` (no IO, injected `now`, unit-tested), a `lib/server/analytics.ts` that fetches via the service-role client and normalizes rows, a RSC page that renders sections, and presentational SVG chart components. Gating is inherited from the existing admin layout.

**Tech Stack:** Next.js 15 App Router (RSC, TS), `@supabase/supabase-js` service-role client, vitest (unit), Playwright (e2e), Tailwind v4 + existing `ts-*` class system. Hand-rolled inline SVG — no chart library.

## Global Constraints

- No database migration. Pure reads over existing tables. (Spec non-goal.)
- No new dependencies; no charting library — inline SVG only.
- Week boundaries are **UTC, Monday-start**, consistent with xp weekly quests.
- All time-dependent pure functions take an injected `now: Date` for deterministic tests.
- Service-role client is server-only (`src/lib/supabase/service.ts`); never import it into a client component.
- Unit tests live in `tests/unit/`, e2e in `tests/e2e/` (repo convention; overrides the spec's `src/lib/*.test.ts` path).
- e2e requires a warm dev server and email-confirm OFF; admin identity comes from an email matching `ADMIN_EMAILS` (test uses the `@admin.tradingsocial.test` domain, as in `tests/e2e/admin.spec.ts`).

---

### Task 1: Time + counting primitives in `lib/analytics.ts`

Pure helpers for UTC-week bucketing and rolling-window counts. No IO.

**Files:**
- Create: `app/src/lib/analytics.ts`
- Test: `app/tests/unit/analytics.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type DatedRow = { createdAt: string; userId?: string }`
  - `type WeekBucket = { weekStart: string; count: number }` (`weekStart` = `YYYY-MM-DD`)
  - `function weekStart(d: Date): Date` — UTC Monday 00:00 of `d`'s week
  - `function lastNWeeks(now: Date, n: number): Date[]` — `n` Monday boundaries ascending, last = current week
  - `function bucketByWeek(rows: DatedRow[], now: Date, n?: number): WeekBucket[]` (default `n=12`)
  - `function countSince(rows: DatedRow[], since: Date): number`
  - `function daysAgo(now: Date, n: number): Date`

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/unit/analytics.test.ts
import { describe, it, expect } from 'vitest'
import { weekStart, lastNWeeks, bucketByWeek, countSince, daysAgo } from '@/lib/analytics'

const iso = (s: string) => new Date(s + 'T00:00:00.000Z')

describe('weekStart', () => {
  it('truncates to Monday 00:00 UTC', () => {
    // 2026-06-24 is a Wednesday -> Monday is 2026-06-22
    expect(weekStart(new Date('2026-06-24T15:30:00Z')).toISOString()).toBe('2026-06-22T00:00:00.000Z')
  })
  it('keeps a Monday as itself', () => {
    expect(weekStart(iso('2026-06-22')).toISOString()).toBe('2026-06-22T00:00:00.000Z')
  })
  it('maps Sunday back to the prior Monday', () => {
    // 2026-06-21 is a Sunday -> 2026-06-15
    expect(weekStart(iso('2026-06-21')).toISOString()).toBe('2026-06-15T00:00:00.000Z')
  })
})

describe('lastNWeeks', () => {
  it('returns n ascending Monday boundaries ending with the current week', () => {
    const w = lastNWeeks(new Date('2026-06-24T12:00:00Z'), 3)
    expect(w.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-06-08', '2026-06-15', '2026-06-22'])
  })
})

describe('bucketByWeek', () => {
  it('counts rows into their week and zero-fills empty weeks', () => {
    const now = new Date('2026-06-24T12:00:00Z')
    const rows = [
      { createdAt: '2026-06-23T09:00:00Z' }, // current week
      { createdAt: '2026-06-22T00:00:01Z' }, // current week
      { createdAt: '2026-06-16T00:00:00Z' }, // prior week
    ]
    const out = bucketByWeek(rows, now, 3)
    expect(out).toEqual([
      { weekStart: '2026-06-08', count: 0 },
      { weekStart: '2026-06-15', count: 1 },
      { weekStart: '2026-06-22', count: 2 },
    ])
  })
  it('ignores rows older than the window and invalid dates', () => {
    const now = new Date('2026-06-24T12:00:00Z')
    const rows = [{ createdAt: '2020-01-01T00:00:00Z' }, { createdAt: 'not-a-date' }]
    expect(bucketByWeek(rows, now, 2).every((b) => b.count === 0)).toBe(true)
  })
})

describe('countSince', () => {
  it('counts rows at or after the cutoff (inclusive)', () => {
    const since = iso('2026-06-20')
    const rows = [
      { createdAt: '2026-06-20T00:00:00Z' }, // == cutoff, counted
      { createdAt: '2026-06-21T00:00:00Z' },
      { createdAt: '2026-06-19T23:59:59Z' }, // before, excluded
    ]
    expect(countSince(rows, since)).toBe(2)
  })
})

describe('daysAgo', () => {
  it('subtracts whole days in ms', () => {
    expect(daysAgo(new Date('2026-06-24T00:00:00Z'), 7).toISOString()).toBe('2026-06-17T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/analytics.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/analytics"`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// app/src/lib/analytics.ts
export type DatedRow = { createdAt: string; userId?: string }
export type WeekBucket = { weekStart: string; count: number }

const DAY = 864e5

export function daysAgo(now: Date, n: number): Date {
  return new Date(now.getTime() - n * DAY)
}

// UTC Monday 00:00 of the week containing d.
export function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = (x.getUTCDay() + 6) % 7 // 0 = Monday
  x.setUTCDate(x.getUTCDate() - dow)
  return x
}

// n Monday boundaries, ascending, last = current week.
export function lastNWeeks(now: Date, n: number): Date[] {
  const cur = weekStart(now)
  const out: Date[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(cur)
    d.setUTCDate(d.getUTCDate() - i * 7)
    out.push(d)
  }
  return out
}

export function bucketByWeek(rows: DatedRow[], now: Date, n = 12): WeekBucket[] {
  const weeks = lastNWeeks(now, n)
  const counts = new Array(n).fill(0)
  const firstMs = weeks[0].getTime()
  for (const r of rows) {
    const t = new Date(r.createdAt).getTime()
    if (Number.isNaN(t) || t < firstMs) continue
    const ws = weekStart(new Date(t)).getTime()
    const idx = weeks.findIndex((w) => w.getTime() === ws)
    if (idx >= 0) counts[idx] += 1
  }
  return weeks.map((w, i) => ({ weekStart: w.toISOString().slice(0, 10), count: counts[i] }))
}

export function countSince(rows: DatedRow[], since: Date): number {
  const s = since.getTime()
  let c = 0
  for (const r of rows) {
    const t = new Date(r.createdAt).getTime()
    if (!Number.isNaN(t) && t >= s) c += 1
  }
  return c
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/analytics.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/analytics.ts app/tests/unit/analytics.test.ts
git commit -m "feat(app): analytics week-bucketing + window-count primitives"
```

---

### Task 2: Aggregate metrics + `buildDashboard` in `lib/analytics.ts`

Distinct-active counting, top-course aggregation, and the dashboard assembler that composes Task 1's primitives into the render struct.

**Files:**
- Modify: `app/src/lib/analytics.ts` (append)
- Test: `app/tests/unit/analytics.test.ts` (append)

**Interfaces:**
- Consumes: `DatedRow`, `WeekBucket`, `bucketByWeek`, `countSince`, `daysAgo` (Task 1).
- Produces:
  - `function distinctActiveUsers(rowSets: DatedRow[][], since: Date): number`
  - `function topCourseCompletions(rows: { courseTitle: string }[], limit?: number): { courseTitle: string; count: number }[]`
  - `type AnalyticsInput` (fields below)
  - `type AnalyticsDashboard` (fields below)
  - `function buildDashboard(input: AnalyticsInput, now: Date): AnalyticsDashboard`

- [ ] **Step 1: Write the failing test**

```ts
// append to app/tests/unit/analytics.test.ts
import { distinctActiveUsers, topCourseCompletions, buildDashboard } from '@/lib/analytics'
import type { AnalyticsInput } from '@/lib/analytics'

describe('distinctActiveUsers', () => {
  it('unions distinct userIds across sets within the window', () => {
    const since = iso('2026-06-20')
    const trades = [{ createdAt: '2026-06-23T00:00:00Z', userId: 'a' }, { createdAt: '2026-06-23T00:00:00Z', userId: 'b' }]
    const posts = [{ createdAt: '2026-06-23T00:00:00Z', userId: 'a' }, { createdAt: '2026-06-19T00:00:00Z', userId: 'c' }]
    expect(distinctActiveUsers([trades, posts], since)).toBe(2) // a, b (c is before cutoff)
  })
  it('ignores rows without a userId', () => {
    expect(distinctActiveUsers([[{ createdAt: '2026-06-23T00:00:00Z' }]], iso('2026-06-20'))).toBe(0)
  })
})

describe('topCourseCompletions', () => {
  it('counts per course and sorts desc, capped to limit', () => {
    const rows = [
      { courseTitle: 'Risk' }, { courseTitle: 'Risk' }, { courseTitle: 'Risk' },
      { courseTitle: 'Foundations' }, { courseTitle: 'Foundations' },
      { courseTitle: 'Psychology' },
    ]
    expect(topCourseCompletions(rows, 2)).toEqual([
      { courseTitle: 'Risk', count: 3 },
      { courseTitle: 'Foundations', count: 2 },
    ])
  })
})

describe('buildDashboard', () => {
  const now = new Date('2026-06-24T12:00:00Z')
  const base: AnalyticsInput = {
    profiles: [{ createdAt: '2026-06-23T00:00:00Z' }, { createdAt: '2026-01-01T00:00:00Z' }],
    trades: [{ createdAt: '2026-06-23T00:00:00Z', userId: 'a' }],
    closedPublicTrades: [{ createdAt: '2026-06-23T00:00:00Z', userId: 'a' }, { createdAt: '2026-06-23T00:00:00Z', userId: 'b' }],
    posts: [{ createdAt: '2026-06-23T00:00:00Z', userId: 'b' }],
    comments: [],
    likes: [{ createdAt: '2026-06-23T00:00:00Z', userId: 'a' }],
    completions: [{ createdAt: '2026-06-23T00:00:00Z', userId: 'a' }],
    completionsByCourse: [{ courseTitle: 'Risk' }],
    publishedLessons: 4,
    feedback: [
      { createdAt: '2026-06-23T00:00:00Z', status: 'open' },
      { createdAt: '2026-06-23T00:00:00Z', status: 'triaged' },
    ],
  }

  it('rolls up growth, engagement, content, and ops', () => {
    const d = buildDashboard(base, now)
    expect(d.growth.totalUsers).toBe(2)
    expect(d.growth.new7d).toBe(1)
    expect(d.growth.signupsPerWeek).toHaveLength(12)
    expect(d.engagement.active7d).toBe(2) // a (trades/likes/completions) + b (posts)
    expect(d.engagement.totalTrades).toBe(1)
    expect(d.content.totalCompletions).toBe(1)
    expect(d.content.topCourses).toEqual([{ courseTitle: 'Risk', count: 1 }])
    expect(d.content.publishedLessons).toBe(4)
    expect(d.content.leaderboardParticipants).toBe(2) // a, b
    expect(d.ops.totalFeedback).toBe(2)
    expect(d.ops.openFeedback).toBe(1)
    expect(d.ops.closedFeedback).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/analytics.test.ts`
Expected: FAIL — `distinctActiveUsers`/`buildDashboard` not exported.

- [ ] **Step 3: Write the minimal implementation**

```ts
// append to app/src/lib/analytics.ts
export function distinctActiveUsers(rowSets: DatedRow[][], since: Date): number {
  const s = since.getTime()
  const set = new Set<string>()
  for (const rows of rowSets) {
    for (const r of rows) {
      if (!r.userId) continue
      const t = new Date(r.createdAt).getTime()
      if (!Number.isNaN(t) && t >= s) set.add(r.userId)
    }
  }
  return set.size
}

export function topCourseCompletions(
  rows: { courseTitle: string }[],
  limit = 5,
): { courseTitle: string; count: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.courseTitle, (m.get(r.courseTitle) ?? 0) + 1)
  return [...m.entries()]
    .map(([courseTitle, count]) => ({ courseTitle, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

export type AnalyticsInput = {
  profiles: DatedRow[]
  trades: DatedRow[]
  closedPublicTrades: DatedRow[]
  posts: DatedRow[]
  comments: DatedRow[]
  likes: DatedRow[]
  completions: DatedRow[]
  completionsByCourse: { courseTitle: string }[]
  publishedLessons: number
  feedback: { createdAt: string; status: string }[]
}

export type AnalyticsDashboard = {
  growth: { totalUsers: number; new7d: number; new30d: number; signupsPerWeek: WeekBucket[] }
  engagement: {
    active7d: number; active30d: number; totalTrades: number
    tradesPerWeek: WeekBucket[]; postsPerWeek: WeekBucket[]; socialPerWeek: WeekBucket[]
  }
  content: {
    totalCompletions: number; completionsPerWeek: WeekBucket[]
    topCourses: { courseTitle: string; count: number }[]
    publishedLessons: number; leaderboardParticipants: number
  }
  ops: { totalFeedback: number; openFeedback: number; closedFeedback: number; feedbackPerWeek: WeekBucket[] }
}

export function buildDashboard(input: AnalyticsInput, now: Date): AnalyticsDashboard {
  const d7 = daysAgo(now, 7)
  const d30 = daysAgo(now, 30)
  const activitySets = [input.trades, input.posts, input.comments, input.likes, input.completions]
  const social = [...input.likes, ...input.comments]
  const openFeedback = input.feedback.filter((f) => f.status === 'open').length
  return {
    growth: {
      totalUsers: input.profiles.length,
      new7d: countSince(input.profiles, d7),
      new30d: countSince(input.profiles, d30),
      signupsPerWeek: bucketByWeek(input.profiles, now),
    },
    engagement: {
      active7d: distinctActiveUsers(activitySets, d7),
      active30d: distinctActiveUsers(activitySets, d30),
      totalTrades: input.trades.length,
      tradesPerWeek: bucketByWeek(input.trades, now),
      postsPerWeek: bucketByWeek(input.posts, now),
      socialPerWeek: bucketByWeek(social, now),
    },
    content: {
      totalCompletions: input.completions.length,
      completionsPerWeek: bucketByWeek(input.completions, now),
      topCourses: topCourseCompletions(input.completionsByCourse),
      publishedLessons: input.publishedLessons,
      leaderboardParticipants: new Set(
        input.closedPublicTrades.map((t) => t.userId).filter((u): u is string => !!u),
      ).size,
    },
    ops: {
      totalFeedback: input.feedback.length,
      openFeedback,
      closedFeedback: input.feedback.length - openFeedback,
      feedbackPerWeek: bucketByWeek(input.feedback.map((f) => ({ createdAt: f.createdAt })), now),
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/analytics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/analytics.ts app/tests/unit/analytics.test.ts
git commit -m "feat(app): analytics distinct-active + buildDashboard aggregator"
```

---

### Task 3: Server fetch layer `lib/server/analytics.ts`

Fetch the timestamp/user columns via the service-role client, normalize each table's column names to `{ createdAt, userId }`, and call `buildDashboard`. IO layer — covered by the Task 6 e2e, not unit-tested (matches `lib/server/ranking.ts`).

**Files:**
- Create: `app/src/lib/server/analytics.ts`

**Interfaces:**
- Consumes: `buildDashboard`, `AnalyticsDashboard`, `AnalyticsInput` (Task 2); `SupabaseClient` from `@supabase/supabase-js`.
- Produces: `function getAnalytics(supabase: SupabaseClient, now?: Date): Promise<AnalyticsDashboard>`

- [ ] **Step 1: Write the implementation**

```ts
// app/src/lib/server/analytics.ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildDashboard, type AnalyticsDashboard } from '@/lib/analytics'

export async function getAnalytics(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<AnalyticsDashboard> {
  const [profiles, trades, closedPublic, posts, comments, likes, completions, lessons, feedback] =
    await Promise.all([
      supabase.from('profiles').select('created_at'),
      supabase.from('trades').select('user_id, created_at'),
      supabase.from('trades').select('user_id, created_at').eq('is_public', true).eq('status', 'closed'),
      supabase.from('posts').select('author_id, created_at'),
      supabase.from('comments').select('author_id, created_at'),
      supabase.from('likes').select('user_id, created_at'),
      supabase.from('lesson_completions').select('user_id, completed_at, lessons(courses(title))'),
      supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('published', true),
      supabase.from('feedback').select('created_at, status'),
    ])

  const data = <T,>(r: { data: T[] | null }): T[] => r.data ?? []
  const completionRows = data<any>(completions)

  return buildDashboard(
    {
      profiles: data<any>(profiles).map((p) => ({ createdAt: p.created_at })),
      trades: data<any>(trades).map((t) => ({ createdAt: t.created_at, userId: t.user_id })),
      closedPublicTrades: data<any>(closedPublic).map((t) => ({ createdAt: t.created_at, userId: t.user_id })),
      posts: data<any>(posts).map((p) => ({ createdAt: p.created_at, userId: p.author_id })),
      comments: data<any>(comments).map((c) => ({ createdAt: c.created_at, userId: c.author_id })),
      likes: data<any>(likes).map((l) => ({ createdAt: l.created_at, userId: l.user_id })),
      completions: completionRows.map((c) => ({ createdAt: c.completed_at, userId: c.user_id })),
      completionsByCourse: completionRows.map((c) => ({
        courseTitle: c.lessons?.courses?.title ?? 'Unknown',
      })),
      publishedLessons: lessons.count ?? 0,
      feedback: data<any>(feedback).map((f) => ({ createdAt: f.created_at, status: f.status })),
    },
    now,
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/analytics.ts
git commit -m "feat(app): getAnalytics service-role fetch + row normalization"
```

---

### Task 4: Presentational chart components

A weekly bar chart and a top-course list, both pure presentational (props in, SVG/markup out). No data fetching.

**Files:**
- Create: `app/src/app/admin/analytics/_components/TrendBars.tsx`
- Create: `app/src/app/admin/analytics/_components/CompletionsList.tsx`

**Interfaces:**
- Consumes: `WeekBucket` from `@/lib/analytics`.
- Produces:
  - `function TrendBars({ title, data }: { title: string; data: WeekBucket[] }): JSX.Element`
  - `function CompletionsList({ rows }: { rows: { courseTitle: string; count: number }[] }): JSX.Element`

- [ ] **Step 1: Write `TrendBars`**

```tsx
// app/src/app/admin/analytics/_components/TrendBars.tsx
import type { WeekBucket } from '@/lib/analytics'

export function TrendBars({ title, data }: { title: string; data: WeekBucket[] }) {
  const W = 320
  const H = 80
  const gap = 3
  const n = Math.max(1, data.length)
  const bw = (W - gap * (n - 1)) / n
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="ts-card" style={{ display: 'grid', gap: 8 }}>
      <span className="faint" style={{ fontSize: 13 }}>{title}</span>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={title}>
        {data.map((d, i) => {
          const h = (d.count / max) * (H - 4)
          return (
            <rect
              key={d.weekStart}
              x={i * (bw + gap)}
              y={H - h}
              width={bw}
              height={h}
              rx={2}
              fill="var(--ts-accent, #4f8cff)"
            >
              <title>{`${d.weekStart}: ${d.count}`}</title>
            </rect>
          )
        })}
      </svg>
    </div>
  )
}
```

- [ ] **Step 2: Write `CompletionsList`**

```tsx
// app/src/app/admin/analytics/_components/CompletionsList.tsx
export function CompletionsList({ rows }: { rows: { courseTitle: string; count: number }[] }) {
  if (rows.length === 0) return <p className="faint" style={{ fontSize: 13 }}>No completions yet.</p>
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
      {rows.map((r) => (
        <li key={r.courseTitle} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{r.courseTitle}</span>
          <strong>{r.count}</strong>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/admin/analytics/_components/TrendBars.tsx app/src/app/admin/analytics/_components/CompletionsList.tsx
git commit -m "feat(app): analytics TrendBars + CompletionsList components"
```

---

### Task 5: Analytics page + admin nav link

The RSC page that fetches the dashboard and renders the four sections, plus the nav entry in the admin layout.

**Files:**
- Create: `app/src/app/admin/analytics/page.tsx`
- Modify: `app/src/app/admin/layout.tsx:12-16` (add Analytics link)

**Interfaces:**
- Consumes: `getAnalytics` (Task 3), `createServiceClient` (`@/lib/supabase/service`), `TrendBars` + `CompletionsList` (Task 4).
- Produces: route `/admin/analytics` (page default export).

- [ ] **Step 1: Add the nav link**

In `app/src/app/admin/layout.tsx`, change the nav block to include Analytics:

```tsx
      <nav className="ts-nav-links mt-3" style={{ gap: 16 }}>
        <Link className="ts-nav-link" href="/admin">Home</Link>
        <Link className="ts-nav-link" href="/admin/analytics">Analytics</Link>
        <Link className="ts-nav-link" href="/admin/feedback">Feedback</Link>
        <Link className="ts-nav-link" href="/admin/courses">Courses</Link>
      </nav>
```

- [ ] **Step 2: Write the page**

```tsx
// app/src/app/admin/analytics/page.tsx
import { createServiceClient } from '@/lib/supabase/service'
import { getAnalytics } from '@/lib/server/analytics'
import { TrendBars } from './_components/TrendBars'
import { CompletionsList } from './_components/CompletionsList'

export const dynamic = 'force-dynamic'

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="ts-card" style={{ display: 'grid', gap: 6 }}>
      <span className="faint" style={{ fontSize: 13 }}>{label}</span>
      <strong style={{ fontSize: 28 }}>{value}</strong>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <h2 className="ts-h2">{title}</h2>
      {children}
    </section>
  )
}

const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 } as const

export default async function AnalyticsPage() {
  const supabase = createServiceClient()
  const d = await getAnalytics(supabase)
  return (
    <div style={{ display: 'grid', gap: 28 }}>
      <Section title="Growth">
        <div style={grid2}>
          <Stat label="Total users" value={d.growth.totalUsers} />
          <Stat label="New (7d)" value={d.growth.new7d} />
          <Stat label="New (30d)" value={d.growth.new30d} />
        </div>
        <TrendBars title="Signups / week" data={d.growth.signupsPerWeek} />
      </Section>

      <Section title="Engagement">
        <div style={grid2}>
          <Stat label="Active users (7d)" value={d.engagement.active7d} />
          <Stat label="Active users (30d)" value={d.engagement.active30d} />
          <Stat label="Trades logged" value={d.engagement.totalTrades} />
        </div>
        <TrendBars title="Trades / week" data={d.engagement.tradesPerWeek} />
        <TrendBars title="Posts / week" data={d.engagement.postsPerWeek} />
        <TrendBars title="Social actions / week" data={d.engagement.socialPerWeek} />
      </Section>

      <Section title="Content">
        <div style={grid2}>
          <Stat label="Course completions" value={d.content.totalCompletions} />
          <Stat label="Published lessons" value={d.content.publishedLessons} />
          <Stat label="Leaderboard participants" value={d.content.leaderboardParticipants} />
        </div>
        <TrendBars title="Completions / week" data={d.content.completionsPerWeek} />
        <div className="ts-card">
          <span className="faint" style={{ fontSize: 13 }}>Top courses</span>
          <div className="mt-3"><CompletionsList rows={d.content.topCourses} /></div>
        </div>
      </Section>

      <Section title="Ops">
        <div style={grid2}>
          <Stat label="Feedback total" value={d.ops.totalFeedback} />
          <Stat label="Open feedback" value={d.ops.openFeedback} />
          <Stat label="Resolved feedback" value={d.ops.closedFeedback} />
        </div>
        <TrendBars title="Feedback / week" data={d.ops.feedbackPerWeek} />
      </Section>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual smoke check**

Ensure the dev server is running (`cd app && npm run dev`), then sign in as an admin and open `/app/admin/analytics`. Confirm the four sections render with cards + bar charts and no console errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/admin/analytics/page.tsx app/src/app/admin/layout.tsx
git commit -m "feat(app): admin analytics page + nav link"
```

---

### Task 6: e2e coverage

Verify an admin can reach the dashboard and see the sections. Non-admin 404 is already covered by `tests/e2e/admin.spec.ts` — not duplicated.

**Files:**
- Create: `app/tests/e2e/analytics.spec.ts`

**Interfaces:**
- Consumes: the `/app/admin/analytics` route (Task 5).

- [ ] **Step 1: Write the e2e test**

```ts
// app/tests/e2e/analytics.spec.ts
import { test, expect, type Page } from '@playwright/test'

async function signUpAndOnboard(page: Page, prefix: string, domain: string) {
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

test('admin sees the analytics dashboard sections', async ({ page }) => {
  await signUpAndOnboard(page, 'an', 'admin.tradingsocial.test')
  await page.goto('/app/admin/analytics')
  await expect(page.getByRole('heading', { name: 'Growth' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Engagement' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ops' })).toBeVisible()
  await expect(page.getByText('Total users')).toBeVisible()
})
```

- [ ] **Step 2: Warm the server, then run the test**

Ensure `cd app && npm run dev` is running and warm (load any `/app` page once). Then:
Run: `cd app && npx playwright test tests/e2e/analytics.spec.ts`
Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add app/tests/e2e/analytics.spec.ts
git commit -m "test(app): e2e admin analytics dashboard sections"
```

---

## Self-Review

**Spec coverage:**
- Growth (total/new/signups-per-week) → Tasks 2, 5. ✓
- Engagement (active 7/30d, trades, posts, social per week) → Tasks 2, 5. ✓
- Content (completions total + per week, top courses, published lessons, leaderboard participants) → Tasks 2, 5. ✓
- Ops (feedback total, open/resolved, per week) → Tasks 2, 5. ✓
- Pure-fn + injected `now` + unit tests → Tasks 1, 2. ✓
- Service-role fetch + normalization → Task 3. ✓
- Dedicated `/admin/analytics` route + nav link → Task 5. ✓
- Inline SVG charts, no library → Task 4. ✓
- e2e (admin sees sections; non-admin 404 reused) → Task 6. ✓
- No migration → confirmed; no `supabase/migrations` changes in any task. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `DatedRow`, `WeekBucket`, `AnalyticsInput`, `AnalyticsDashboard` defined in Tasks 1–2 and consumed unchanged in Tasks 3–5. `getAnalytics(supabase, now?)` signature matches its Task 5 call (`getAnalytics(supabase)`). `TrendBars({ title, data })` / `CompletionsList({ rows })` props match Task 5 usage. Feedback "Resolved" label maps to `closedFeedback` field (open = `status==='open'`, resolved = rest) — consistent across Tasks 2 and 5. ✓

**Note:** spec listed the unit test at `src/lib/analytics.test.ts`; plan uses `tests/unit/analytics.test.ts` to match repo convention (`tests/unit/xp.test.ts`, `tests/unit/leaderboard.test.ts`).
