# Phase 9b: Search — Design Spec

**Date:** 2026-06-26
**Status:** Approved
**Scope:** Live nav-dropdown search over Users + Posts. Trades deferred.

---

## Overview

The dead search input in the app nav becomes a live, debounced dropdown. Typing ≥2 characters searches public traders (by username/display_name) and public posts (full-text on body), showing grouped results inline. No dedicated results page in v1.

---

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Scope | Users + Posts (trades deferred) |
| Mechanism | Hybrid: ILIKE + trigram for users, Postgres FTS for posts |
| UI surface | Live dropdown in nav (no results page) |
| Fetch | Server Action `search(query)` (user-scoped client) |
| Visibility | Public only — `is_public = true` for both users and post authors |

**Critical security note:** `posts_select` RLS policy is `using (true)` — posts are world-readable regardless of author visibility. The search query MUST explicitly join `profiles` and filter `is_public = true` on the author. RLS will not enforce this.

---

## Data Layer

### Migration `0011_search`

```sql
-- Full-text search column on posts (stored generated — auto-maintained, no trigger)
alter table posts
  add column body_tsv tsvector
  generated always as (to_tsvector('english', coalesce(body, ''))) stored;

create index posts_body_tsv_idx on posts using gin (body_tsv);

-- Trigram indexes for fast user substring (ILIKE) match on short fields
create extension if not exists pg_trgm;
create index profiles_username_trgm on profiles using gin (username gin_trgm_ops);
create index profiles_display_name_trgm on profiles using gin (display_name gin_trgm_ops);
```

- `body_tsv` is a **stored generated column** — always in sync with `body`, no trigger.
- `pg_trgm` GIN indexes accelerate `ILIKE '%q%'` on usernames/display names.
- No RLS changes. Visibility enforced in the query layer.
- Applied to Supabase Cloud via MCP `apply_migration` at build time.

Note: `username` is `citext` (case-insensitive). `gin_trgm_ops` on a citext column works; ILIKE is already case-insensitive.

---

## App Layer

### `lib/search.ts` — pure helpers, no DB

```ts
export type UserResult = {
  username: string
  displayName: string | null
  avatarUrl: string | null
  bio: string | null
}

export type PostResult = {
  id: string
  body: string
  createdAt: string
  author: { username: string; displayName: string | null; avatarUrl: string | null }
}

export type SearchResults = { users: UserResult[]; posts: PostResult[] }

// Trim input; strip characters that break/inject PostgREST .or() filter syntax
// (keep letters, digits, spaces, @ _ - only); return null when < 2 chars after cleaning
export function normalizeQuery(raw: string): string | null

// Escape ILIKE wildcards so % and _ are treated as literals
export function escapeIlike(q: string): string
```

### `actions/search.ts` — Server Action

```ts
'use server'
export async function search(rawQuery: string): Promise<SearchResults>
```

Logic:
1. `normalizeQuery(rawQuery)` → if `null`, return `{ users: [], posts: [] }`. `normalizeQuery` strips PostgREST-filter-unsafe characters (`,` `(` `)` `.` `:` quotes) so the `.or()` filter string cannot be broken or injected by user input. `websearch_to_tsquery` is injection-safe by design (the `websearch` type parses user text without raising on special chars), so the post query needs no extra escaping beyond `normalizeQuery`.
2. Get `supabase = await createClient()` (user session — RLS applies).
3. Run both queries in `Promise.all`:
   - **Users:** `profiles`
     - `.select('username, display_name, avatar_url, bio')`
     - `.eq('is_public', true)`
     - `.or('username.ilike.%q%,display_name.ilike.%q%')` (q escaped via `escapeIlike`)
     - `.limit(5)`
   - **Posts:** `posts`
     - `.select('id, body, created_at, author:profiles!posts_author_id_fkey(username, display_name, avatar_url, is_public)')`
     - `.textSearch('body_tsv', q, { type: 'websearch' })`
     - `.order('created_at', { ascending: false })`
     - `.limit(20)` (over-fetch, then filter by author visibility in TS)
     - After fetch: keep only rows where `author.is_public === true`, slice to 5, map to `PostResult`.
4. Map raw rows → typed results (normalize Supabase array-or-object embed for `author`, same defensive pattern as analytics/comments).

**Why over-fetch+filter posts:** PostgREST cannot filter the outer table by an embedded table's column directly in a way that also limits correctly; fetch 20 recent matches, drop private authors in TS, slice to 5. Acceptable at current scale; revisit with an RPC if volume grows.

**Post ordering:** PostgREST cannot `ORDER BY ts_rank(...)` (computed expression). v1 orders by `created_at desc` (recency). Match quality/stemming still come from `websearch_to_tsquery`. True relevance ranking deferred (needs RPC).

---

## UI

### `NavSearch.tsx` (client component)

Replaces the static `<label className="ts-nav-search">` block in `AppNav` (rendered only for logged-in users, unchanged).

- Controlled `<input>`, debounced ~250ms.
- On debounced value with `normalizeQuery` non-null → call `search()`, store results, open dropdown. Empty/short → close dropdown, clear results.
- Dropdown (absolute below input, z-50):
  - **Traders** section header + up to 5 `UserResult` rows: avatar (or initial) + display_name + `@username`. Row → `Link href={'/' + username}`.
  - **Posts** section header + up to 5 `PostResult` rows: author avatar + `@username` + body excerpt (~60 chars) + relative time. Row → `Link href={'/#post-' + id}`.
  - Loading state ("Searching…") while action in flight.
  - Empty state ("No results for '<q>'") when both arrays empty and query valid.
  - Close on outside click + Escape (mirror `NotificationBell` pattern).
- Reuse relative-time helper pattern from `NotificationBell` (or extract shared util if convenient — not required).

### CSS

Append `.ts-search-*` rules to `globals.css` (dropdown, sections, rows), mirroring `.ts-notif-*` styling for visual consistency.

---

## Testing

### Unit — `search.test.ts` (vitest)

- `normalizeQuery('  ab ')` → `'ab'`
- `normalizeQuery(' a ')` → `null`
- `normalizeQuery('')` → `null`
- `normalizeQuery('   ')` → `null`
- `normalizeQuery('trading')` → `'trading'`
- `escapeIlike('50%_win')` → `'50\\%\\_win'`
- `escapeIlike('normal')` → `'normal'`
- `normalizeQuery('ab,c(d)')` → `'abcd'` (filter-unsafe chars stripped); if result `< 2` chars → `null`

### E2E — `search.spec.ts` (Playwright)

- User A (public) signs up → User B searches A's username → A appears in Traders dropdown.
- User A posts a unique-keyword body → User B searches the keyword → post appears in Posts dropdown.
- Query `< 2` chars → dropdown does not open / no results.
- Click a trader result → navigates to `/${username}`.
- **Privacy (critical):** User A toggles profile private (`is_public = false` in settings) → User B searches A → A does NOT appear in Traders, and A's posts do NOT appear in Posts. Proves explicit `is_public` filter despite `posts_select using (true)`.

Warm dev server before e2e (cold-compile busts 5s timeouts). Usernames ≤ 20 chars.

---

## Deferred

- Dedicated `/search` results page + "see all" (dropdown is v1).
- Trades search (RLS for public-closed-only).
- True `ts_rank` relevance ordering (needs RPC; v1 = recency).
- Follower-graph-aware results (private accounts the searcher follows).
- Search-as-you-type highlighting / keyboard nav of dropdown rows.
