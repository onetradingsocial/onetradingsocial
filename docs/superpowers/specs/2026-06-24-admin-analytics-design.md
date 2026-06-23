# Phase 7b — Admin Analytics Dashboard (Design)

**Date:** 2026-06-24
**Status:** Approved, ready for implementation plan
**Depends on:** Phase 7a Admin (admin gate, service-role client, `ts-card` system)

## Goal

Give the solo owner one admin-only dashboard covering growth, engagement, content
performance, and ops health. Pure reads over existing tables — **no migration, no
new tracking**. Mirrors the established `lib/leaderboard.ts` / `lib/xp.ts` pattern:
fetch rows, aggregate in a tested pure function, render hand-rolled SVG.

## Non-Goals (YAGNI)

- No migration, no events/`last_seen` table — activity is derived from existing
  `created_at` timestamps.
- No date-range picker (fixed rolling windows: 12 weeks for charts, 7d/30d for
  active/new).
- No CSV export, no realtime, no retention cohorts, no per-user drilldown.
- No feedback time-to-close (no `closed_at` column on `feedback`).
- No charting library — inline SVG only, consistent with journal/leaderboard.

## Architecture

Four isolated layers, each independently understandable and testable:

1. **`src/lib/analytics.ts`** — pure functions, zero IO. Inputs: arrays of
   `{ createdAt: string; userId?: string }`-shaped rows plus an injected `now: Date`.
   Outputs: metric structs (totals, weekly buckets, distinct-active counts).
   Unit-testable in isolation (like `lib/xp.ts`, which injects `now`).
2. **`src/lib/server/analytics.ts`** — `getAnalytics(supabase, { now? })`. Uses the
   service-role client to fetch only the timestamp + user columns from each table,
   calls the pure fns, returns one `AnalyticsDashboard` struct. The only IO layer.
3. **`src/app/admin/analytics/page.tsx`** — RSC. Calls `getAnalytics` via the
   service client, renders the four sections. Gating is inherited from
   `src/app/admin/layout.tsx` (already 404s non-admins).
4. **`src/app/admin/analytics/_components/`** — presentational only:
   - `TrendBars.tsx` — weekly bar chart from a `WeeklyBucket[]` (inline SVG).
   - `StatGrid.tsx` (or reuse inline `ts-card` cards) — labelled number cards.
   - `CompletionsList.tsx` — top courses by completion count.

**Admin nav:** add an **Analytics** link alongside the existing admin nav entries
in `src/app/admin/layout.tsx`.

## Data Sources

All timestamps confirmed present (no schema change):

| Table | Column | Used for |
|---|---|---|
| `profiles` | `created_at` | signups / total users / new users |
| `trades` | `created_at`, `user_id`, closed/public flags | trades volume, active users, leaderboard participation |
| `posts` | `created_at`, `author_id` | posts volume, active users |
| `comments` | `created_at`, `user_id` (author) | social actions, active users |
| `likes` | `created_at`, `user_id` | social actions, active users |
| `follows` | `created_at` | (available; not surfaced in v1) |
| `lesson_completions` | `completed_at`, `user_id`, `lesson_id` | completions volume, active users, per-course |
| `lessons` | `published` flag | published lessons count, course join for per-course completions |
| `feedback` | `created_at`, `status` | feedback volume + status breakdown |

> Note: `comments`/`likes`/`posts` use `author_id`/`user_id` per their migrations —
> the server layer normalizes each to a common `userId` field before passing rows to
> the pure layer, so `lib/analytics.ts` never knows the source column names.

## Metrics by Section

### Growth
- Total users (count of `profiles`).
- New users in last 7d and 30d (rolling).
- Signups per week — 12 UTC-week bars from `profiles.created_at`.

### Engagement
- Active users 7d and 30d = distinct `userId` appearing in any of
  trades / posts / comments / likes / lesson_completions within the window.
- Trades logged — total + per-week (12 wk).
- Posts — per-week (12 wk).
- Social actions (likes + comments) — per-week (12 wk).

### Content
- Course completions — total + per-week (12 wk).
- Completions per course — top list (join `lesson_completions` → `lessons.course_id`).
- Published lessons count.
- Leaderboard participation — distinct users with ≥1 closed public trade.

### Ops
- Feedback total.
- Open / closed status breakdown.
- Feedback per-week (12 wk).

## Time Semantics

- **Week boundaries:** UTC, consistent with xp weekly quests. A helper
  `weekStart(date)` truncates to the UTC start of week; `lastNWeeks(now, 12)`
  produces the ordered bucket boundaries.
- **Rolling windows:** `now - 7d`, `now - 30d` for active/new metrics (not calendar
  weeks).
- `now` is injected everywhere it matters so tests are deterministic.

## Data Flow

```
page.tsx (RSC)
  -> getAnalytics(serviceClient)              [lib/server/analytics.ts]
       -> Promise.all fetch columns per table
       -> normalize rows to { createdAt, userId? }
       -> pure aggregate                      [lib/analytics.ts]
       -> AnalyticsDashboard struct
  -> render Growth / Engagement / Content / Ops sections
```

## Error Handling

- Counts default to `0` on null (existing admin `count()` convention).
- Fetch errors return empty arrays → charts render an empty axis, cards show 0.
- No throw on missing data; the dashboard always renders.

## Testing

- **`src/lib/analytics.test.ts`** (vitest): weekly bucketing correctness, distinct
  active-user counting across multiple source arrays, 7d/30d window boundaries
  (inclusive/exclusive edge), empty-input cases, per-course completion aggregation.
  All with injected `now`.
- **`tests/e2e/analytics.spec.ts`** (Playwright, warm server): admin signs in,
  navigates to `/admin/analytics`, sees the four section headings and at least the
  Growth stat cards. Non-admin 404 is already covered by the existing admin-gate
  e2e — not duplicated here.

## File Manifest

New:
- `src/lib/analytics.ts`
- `src/lib/analytics.test.ts`
- `src/lib/server/analytics.ts`
- `src/app/admin/analytics/page.tsx`
- `src/app/admin/analytics/_components/TrendBars.tsx`
- `src/app/admin/analytics/_components/CompletionsList.tsx`
- `tests/e2e/analytics.spec.ts`

Modified:
- `src/app/admin/layout.tsx` — add Analytics nav link.

## Open Questions

None. Ready for `writing-plans`.
