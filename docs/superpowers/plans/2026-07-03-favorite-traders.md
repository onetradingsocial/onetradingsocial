# Favourite Traders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can star ("favourite") traders; starred traders' posts from the last 48h surface first in the home feed, and a hover card with follow/star controls appears over author identity blocks.

**Architecture:** New private `favorites` table (RLS owner-only) sits on top of the existing `follows` table — starring auto-follows, unstarring keeps the follow. The home feed applies a two-band sort after `assembleFeed`. A self-contained `TraderHoverCard` client component fetches its data on first open via a server action, so no list component needs new props.

**Tech Stack:** Next.js 15 App Router (server components + server actions), Supabase (Postgres + RLS), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-favorite-traders-design.md`

## Global Constraints

- All code lives under `app/` (the Next.js project root); tests run from `app/` with `npm test`.
- Table/column names use US spelling `favorites` / `favorite_id` (matches `likes`, `follows` style). UI copy uses "Favourite" (UK) only if existing copy does — default to icon-only star, no text label.
- Favourites are fully private: RLS owner-only on all operations, no notifications, no public counts.
- Server actions follow the existing `SocialState` return pattern in `app/src/app/actions/social.ts`.
- Reads in server components use `getSessionUser`; mutations in server actions use `supabase.auth.getUser()` (existing convention).
- Migration is applied to the Supabase project via the Supabase MCP `apply_migration` tool (matches how 0015 was applied), with the same SQL saved to `app/supabase/migrations/`.

---

### Task 1: Two-band feed sort (`boostFavorites`)

**Files:**
- Modify: `app/src/lib/feed.ts`
- Test: `app/tests/unit/feed.test.ts`

**Interfaces:**
- Produces: `boostFavorites<T extends { author_id: string; created_at: string }>(posts: T[], favoriteIds: Set<string>, now?: number): T[]` — exported from `@/lib/feed`. Band 1: posts whose `author_id` ∈ `favoriteIds` AND `created_at` within 48h of `now` (default `Date.now()`), newest first. Band 2: everything else, original order preserved (input is already newest-first).

- [ ] **Step 1: Write the failing tests**

Append to `app/tests/unit/feed.test.ts`:

```ts
import { boostFavorites } from '@/lib/feed'

describe('boostFavorites', () => {
  const now = new Date('2026-07-03T12:00:00Z').getTime()
  const p = (id: string, author: string, iso: string) => ({ id, author_id: author, created_at: iso })
  it('lifts favourited authors\' recent posts to the top, newest first', () => {
    const posts = [
      p('a', 'u1', '2026-07-03T11:00:00Z'),
      p('b', 'fav', '2026-07-03T10:00:00Z'),
      p('c', 'u2', '2026-07-02T09:00:00Z'),
      p('d', 'fav', '2026-07-03T11:30:00Z'),
    ]
    expect(boostFavorites(posts, new Set(['fav']), now).map((x) => x.id)).toEqual(['d', 'b', 'a', 'c'])
  })
  it('does not lift favourited posts older than 48h', () => {
    const posts = [
      p('a', 'u1', '2026-07-03T11:00:00Z'),
      p('b', 'fav', '2026-07-01T11:00:00Z'), // 49h old
    ]
    expect(boostFavorites(posts, new Set(['fav']), now).map((x) => x.id)).toEqual(['a', 'b'])
  })
  it('is a no-op with no favourites', () => {
    const posts = [p('a', 'u1', '2026-07-03T11:00:00Z'), p('b', 'u2', '2026-07-03T10:00:00Z')]
    expect(boostFavorites(posts, new Set(), now).map((x) => x.id)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `app/`): `npm test -- tests/unit/feed.test.ts`
Expected: FAIL — `boostFavorites` is not exported.

- [ ] **Step 3: Implement**

Append to `app/src/lib/feed.ts`:

```ts
const BOOST_WINDOW_MS = 48 * 60 * 60 * 1000

// Two-band sort: favourited authors' posts from the last 48h first (newest
// first), then everything else in its existing order.
export function boostFavorites<T extends { author_id: string; created_at: string }>(
  posts: T[], favoriteIds: Set<string>, now: number = Date.now(),
): T[] {
  if (favoriteIds.size === 0) return posts
  const boosted: T[] = [], rest: T[] = []
  for (const p of posts) {
    const fresh = now - Date.parse(p.created_at) <= BOOST_WINDOW_MS
    if (favoriteIds.has(p.author_id) && fresh) boosted.push(p)
    else rest.push(p)
  }
  boosted.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return [...boosted, ...rest]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/feed.test.ts`
Expected: PASS (all feed tests, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/feed.ts app/tests/unit/feed.test.ts
git commit -m "feat(feed): two-band boostFavorites sort"
```

---

### Task 2: `favorites` table migration

**Files:**
- Create: `app/supabase/migrations/0016_favorites.sql`

**Interfaces:**
- Produces: table `public.favorites(user_id uuid, favorite_id uuid, created_at timestamptz)` with PK `(user_id, favorite_id)`, owner-only RLS.

- [ ] **Step 1: Write the migration file**

Create `app/supabase/migrations/0016_favorites.sql`:

```sql
-- Favourite traders: a private, stronger tier on top of follows.
-- Unlike follows (public select), favourites are viewer-only.
create table if not exists public.favorites (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  favorite_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, favorite_id),
  constraint favorites_no_self check (user_id <> favorite_id)
);
create index if not exists favorites_user_idx on public.favorites(user_id);
alter table public.favorites enable row level security;
drop policy if exists favorites_select on public.favorites;
create policy favorites_select on public.favorites for select using (user_id = auth.uid());
drop policy if exists favorites_insert on public.favorites;
create policy favorites_insert on public.favorites for insert with check (user_id = auth.uid());
drop policy if exists favorites_delete on public.favorites;
create policy favorites_delete on public.favorites for delete using (user_id = auth.uid());
```

- [ ] **Step 2: Apply to the Supabase project**

Use the Supabase MCP tool `apply_migration` with name `favorites` and the SQL above (exactly the file contents).

- [ ] **Step 3: Verify**

Use Supabase MCP `list_tables` — expect `favorites` present with RLS enabled. Then `execute_sql`:
```sql
select policyname from pg_policies where tablename = 'favorites';
```
Expected: `favorites_select`, `favorites_insert`, `favorites_delete`.

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0016_favorites.sql
git commit -m "feat(db): private favorites table with owner-only RLS"
```

---

### Task 3: Server actions — `favorite`, `unfavorite`, `getTraderCardData`

**Files:**
- Modify: `app/src/app/actions/social.ts` (append after `unfollow`, ~line 233)

**Interfaces:**
- Consumes: `public.favorites` (Task 2). Existing in-file helpers: `createClient`, `SocialState`, `revalidatePath`. Existing libs: `getUserXp` from `@/lib/server/xp`.
- Produces:
  - `favorite(targetId: string): Promise<SocialState>` — upserts favourite + auto-follow. No notification.
  - `unfavorite(targetId: string): Promise<SocialState>` — deletes favourite only.
  - `getTraderCardData(userId: string): Promise<TraderCardData | null>` where
    `export type TraderCardData = { username: string; displayName: string | null; avatarUrl: string | null; winRate: number; trades: number; level: number; viewerFollows: boolean; viewerFavorited: boolean; isSelf: boolean }`

- [ ] **Step 1: Implement the actions**

Append to `app/src/app/actions/social.ts`:

```ts
export async function favorite(targetId: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (targetId === user.id) return { error: "You can't favourite yourself." }
  const { error } = await supabase.from('favorites').upsert(
    { user_id: user.id, favorite_id: targetId },
    { onConflict: 'user_id,favorite_id', ignoreDuplicates: true },
  )
  if (error) { console.error('favorite', error.message); return { error: 'Could not favourite. Try again.' } }
  // Star implies follow. Deliberately no notification for the favourite itself
  // (favourites are private); the follow upsert is silent too to avoid
  // re-notifying users who were already followed.
  await supabase.from('follows').upsert(
    { follower_id: user.id, following_id: targetId },
    { onConflict: 'follower_id,following_id', ignoreDuplicates: true },
  )
  revalidatePath('/')
  return { ok: true }
}

export async function unfavorite(targetId: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  await supabase.from('favorites').delete().eq('user_id', user.id).eq('favorite_id', targetId)
  revalidatePath('/')
  return { ok: true }
}

export type TraderCardData = {
  username: string; displayName: string | null; avatarUrl: string | null
  winRate: number; trades: number; level: number
  viewerFollows: boolean; viewerFavorited: boolean; isSelf: boolean
}

export async function getTraderCardData(userId: string): Promise<TraderCardData | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const [{ data: profile }, { data: closed }, xp, { data: vf }, { data: vfav }] = await Promise.all([
    supabase.from('profiles').select('username, display_name, avatar_url').eq('id', userId).maybeSingle(),
    supabase.from('trades').select('r_multiple').eq('user_id', userId).eq('is_public', true).eq('status', 'closed'),
    getUserXp(supabase, userId),
    supabase.from('follows').select('follower_id').eq('follower_id', user.id).eq('following_id', userId).maybeSingle(),
    supabase.from('favorites').select('user_id').eq('user_id', user.id).eq('favorite_id', userId).maybeSingle(),
  ])
  if (!profile) return null
  const trades = closed ?? []
  const wins = trades.filter((t) => (t.r_multiple ?? 0) > 0).length
  return {
    username: profile.username, displayName: profile.display_name, avatarUrl: profile.avatar_url,
    winRate: trades.length ? wins / trades.length : 0, trades: trades.length, level: xp.level.level,
    viewerFollows: !!vf, viewerFavorited: !!vfav, isSelf: userId === user.id,
  }
}
```

Add the import at the top of the file alongside the existing imports:

```ts
import { getUserXp } from '@/lib/server/xp'
```

(Before writing, check `getUserXp`'s actual signature in `app/src/lib/server/xp.ts` — the home page calls it as `getUserXp(supabase, user.id)` and reads `xp.level.level`. If the return shape differs, adapt the `level:` line, not the type.)

- [ ] **Step 2: Typecheck**

Run (from `app/`): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/actions/social.ts
git commit -m "feat(social): favorite/unfavorite actions + trader card data"
```

---

### Task 4: Feed wiring — boost, ★ badge, `favoriteIds` in HomeData

**Files:**
- Modify: `app/src/app/page.tsx`
- Modify: `app/src/app/feed/_components/FeedTabs.tsx` (line 6)
- Modify: `app/src/app/feed/_components/home/types.ts`
- Modify: `app/src/app/feed/_components/home/ArenaPostCard.tsx`
- Modify: `app/src/app/feed/_components/home/atoms.tsx` (ICONS map)

**Interfaces:**
- Consumes: `boostFavorites` from `@/lib/feed` (Task 1); `favorites` table (Task 2).
- Produces: `FeedTabItem` gains `fromFavorite: boolean`; `HomeData` gains `favoriteIds: string[]`; `Icon name="star"` available.

- [ ] **Step 1: Extend types**

`app/src/app/feed/_components/FeedTabs.tsx` line 6:

```ts
export type FeedTabItem = FeedItem & { fromFollowed: boolean; fromFavorite: boolean }
```

`app/src/app/feed/_components/home/types.ts` — in `HomeData`, after `followingIds: string[]`:

```ts
  favoriteIds: string[]
```

- [ ] **Step 2: Add star icon**

In `app/src/app/feed/_components/home/atoms.tsx`, add to the `ICONS` record (any position):

```tsx
  star: <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8L12 3z" {...IP} />,
```

- [ ] **Step 3: Wire the home page**

In `app/src/app/page.tsx`:

a. Import: change line 3 to

```ts
import { assembleFeed, boostFavorites, tally } from '@/lib/feed'
```

b. Stage A batch (the `Promise.all` at ~line 34): add a sixth entry and destructure it:

```ts
  const [
    { data: profile },
    weekBoard,
    xp,
    { data: follows },
    { data: ownTradeRows },
    { data: favRows },
  ] = await Promise.all([
    /* ...existing five queries unchanged..., then: */
    supabase.from('favorites').select('favorite_id').eq('user_id', user.id),
  ])
```

c. After `const followingSet = new Set(followingIds)` (~line 54), add:

```ts
  const favoriteIds = (favRows ?? []).map((f) => f.favorite_id)
  const favoriteSet = new Set(favoriteIds)
```

d. Replace the `assembleFeed` line (~line 65):

```ts
  const merged = boostFavorites(assembleFeed((primaryRaw ?? []) as RawPost[], fallbackRaw, 30), favoriteSet)
```

e. In the `items` mapping (~line 118), replace the return line:

```ts
    return [{ ...base, fromFollowed: author.id === user.id || followingSet.has(author.id), fromFavorite: favoriteSet.has(author.id) }]
```

f. In the `HomeData` literal (~line 171), after `followingIds,` add:

```ts
    favoriteIds,
```

- [ ] **Step 4: ★ badge on boosted cards**

In `app/src/app/feed/_components/home/ArenaPostCard.tsx`, inside the `<b>` in the `.who` block (line 99), after the `<Link>`:

```tsx
          <b>
            <Link href={`/${a.username}`}>{a.display_name || a.username}</Link>
            {item.fromFavorite && <Icon name="star" size={13} style={{ color: 'var(--xp)', fill: 'currentColor' }} />}
          </b>
```

(`Icon` is already imported. `.who b` is already `inline-flex` with gap, so the star aligns without CSS changes.)

- [ ] **Step 5: Typecheck + tests + build**

Run: `npx tsc --noEmit && npm test`
Expected: clean. (The `fromFavorite` field is only constructed in `page.tsx`, which Step 3e covers — the compiler will confirm no other constructor exists.)

- [ ] **Step 6: Commit**

```bash
git add app/src/app/page.tsx app/src/app/feed/_components/FeedTabs.tsx app/src/app/feed/_components/home/types.ts app/src/app/feed/_components/home/ArenaPostCard.tsx app/src/app/feed/_components/home/atoms.tsx
git commit -m "feat(feed): boost favourited traders' recent posts, star badge"
```

---

### Task 5: `StarButton` + profile page integration

**Files:**
- Create: `app/src/app/_components/StarButton.tsx`
- Modify: `app/src/app/[username]/page.tsx`
- Modify: `app/src/app/globals.css` (append)

**Interfaces:**
- Consumes: `favorite`, `unfavorite` from `@/app/actions/social` (Task 3).
- Produces: `StarButton({ targetId, initialFavorited }: { targetId: string; initialFavorited: boolean })` — used by profile page (here) and TraderHoverCard (Task 6).

- [ ] **Step 1: Create the component**

`app/src/app/_components/StarButton.tsx` (mirrors `FollowButton.tsx`):

```tsx
'use client'

import { useState, useTransition } from 'react'
import { favorite, unfavorite } from '@/app/actions/social'

export function StarButton({ targetId, initialFavorited }: { targetId: string; initialFavorited: boolean }) {
  const [starred, setStarred] = useState(initialFavorited)
  const [pending, start] = useTransition()
  function toggle() {
    const next = !starred
    setStarred(next)
    start(async () => {
      const r = next ? await favorite(targetId) : await unfavorite(targetId)
      if ('error' in r && r.error) setStarred(!next)
    })
  }
  return (
    <button type="button" className={'star-btn' + (starred ? ' on' : '')} onClick={toggle} disabled={pending}
      title={starred ? 'Remove from favourites' : 'Favourite this trader'}
      aria-label={starred ? 'Remove from favourites' : 'Favourite this trader'} aria-pressed={starred}>
      <svg viewBox="0 0 24 24" width={17} height={17}>
        <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8L12 3z"
          fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
      </svg>
    </button>
  )
}
```

- [ ] **Step 2: Style**

Append to `app/src/app/globals.css`:

```css
/* Favourite (star) toggle */
.star-btn { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: var(--faint); cursor: pointer; transition: color .15s, border-color .15s; }
.star-btn:hover { color: var(--xp); border-color: var(--xp); }
.star-btn.on { color: var(--xp); border-color: var(--xp); }
.star-btn:disabled { opacity: .6; cursor: default; }
```

(Check `--xp` exists in `globals.css` `:root`; it is used by rail.tsx as a trophy color. If missing, use `#E3A92B`.)

- [ ] **Step 3: Profile page**

In `app/src/app/[username]/page.tsx`:

a. Import after the `FollowButton` import (line 8):

```ts
import { StarButton } from '@/app/_components/StarButton'
```

b. In the viewer-state block (~line 76), extend to also read the favourite row:

```ts
    if (viewer && viewer.id !== profileId) {
      const [{ data: vf }, { data: vfav }] = await Promise.all([
        supabase.from('follows').select('follower_id').eq('follower_id', viewer.id).eq('following_id', profileId).maybeSingle(),
        supabase.from('favorites').select('user_id').eq('user_id', viewer.id).eq('favorite_id', profileId).maybeSingle(),
      ])
      isFollowing = !!vf
      isFavorited = !!vfav
    }
```

and declare `let isFavorited = false` alongside the existing `let ... isFollowing = false` (line 61).

c. Render next to `FollowButton` (line 227):

```tsx
                        {viewer && profileId && <FollowButton targetId={profileId} initialFollowing={isFollowing} />}
                        {viewer && profileId && <StarButton targetId={profileId} initialFavorited={isFavorited} />}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/_components/StarButton.tsx app/src/app/[username]/page.tsx app/src/app/globals.css
git commit -m "feat(profile): star toggle next to follow button"
```

---

### Task 6: `TraderHoverCard` component

**Files:**
- Create: `app/src/app/_components/TraderHoverCard.tsx`
- Modify: `app/src/app/globals.css` (append)

**Interfaces:**
- Consumes: `getTraderCardData`, `TraderCardData`, `follow`, `unfollow`, `favorite`, `unfavorite` from `@/app/actions/social` (Task 3).
- Produces: `TraderHoverCard({ userId, username, displayName, avatarUrl, children }: { userId: string; username: string; displayName: string | null; avatarUrl: string | null; children: React.ReactNode })` — wraps a trigger; renders the floating card in a portal.

- [ ] **Step 1: Create the component**

`app/src/app/_components/TraderHoverCard.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { getTraderCardData, follow, unfollow, favorite, unfavorite, type TraderCardData } from '@/app/actions/social'

// Session-scoped cache so repeat hovers don't refetch.
const cache = new Map<string, TraderCardData>()

const CARD_W = 300
const CARD_H = 172 // estimate for flip decision only

function CardActions({ userId, data, onChange }: { userId: string; data: TraderCardData; onChange: (d: TraderCardData) => void }) {
  const [pending, start] = useTransition()
  const flip = (patch: Partial<TraderCardData>, act: () => Promise<{ error?: string } | { ok: true }>) => {
    const prev = data
    onChange({ ...data, ...patch })
    start(async () => {
      const r = await act()
      if ('error' in r && r.error) onChange(prev)
    })
  }
  return (
    <div className="thc-actions">
      <button className={'h-followbtn' + (data.viewerFollows ? ' on' : '')} disabled={pending}
        onClick={() => flip({ viewerFollows: !data.viewerFollows },
          () => data.viewerFollows ? unfollow(userId) : follow(userId))}>
        {data.viewerFollows ? 'Following' : 'Follow'}
      </button>
      <button className={'star-btn thc-star' + (data.viewerFavorited ? ' on' : '')} disabled={pending}
        aria-pressed={data.viewerFavorited}
        aria-label={data.viewerFavorited ? 'Remove from favourites' : 'Favourite this trader'}
        onClick={() => flip(
          // Star implies follow, so reflect that optimistically too.
          data.viewerFavorited ? { viewerFavorited: false } : { viewerFavorited: true, viewerFollows: true },
          () => data.viewerFavorited ? unfavorite(userId) : favorite(userId))}>
        <svg viewBox="0 0 24 24" width={15} height={15}>
          <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8L12 3z"
            fill={data.viewerFavorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}

export function TraderHoverCard({ userId, username, displayName, avatarUrl, children }:
  { userId: string; username: string; displayName: string | null; avatarUrl: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [data, setData] = useState<TraderCardData | null>(null)
  const [failed, setFailed] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function place() {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    const below = r.bottom + 8 + CARD_H <= window.innerHeight
    setPos({
      top: below ? r.bottom + 8 : Math.max(8, r.top - CARD_H - 8),
      left: Math.min(Math.max(8, r.left), window.innerWidth - CARD_W - 8),
    })
  }

  function show() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    place()
    setOpen(true)
    if (!data) {
      const hit = cache.get(userId)
      if (hit) { setData(hit); return }
      getTraderCardData(userId)
        .then((d) => { if (d) { cache.set(userId, d); setData(d) } else setFailed(true) })
        .catch(() => setFailed(true))
    }
  }
  const scheduleShow = () => { if (!openTimer.current) openTimer.current = setTimeout(() => { openTimer.current = null; show() }, 300) }
  const cancelShow = () => { if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null } }
  const scheduleHide = () => { cancelShow(); closeTimer.current = setTimeout(() => setOpen(false), 200) }
  const cancelHide = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null } }

  // Touch: tap on the trigger toggles the card; tap outside closes.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node
      if (!wrapRef.current?.contains(t) && !document.getElementById(`thc-${userId}`)?.contains(t)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open, userId])
  useEffect(() => () => { cancelShow(); cancelHide() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const updateData = (d: TraderCardData) => { cache.set(userId, d); setData(d) }

  return (
    <div ref={wrapRef} className="thc-wrap"
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') scheduleShow() }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') scheduleHide() }}
      onClick={(e) => {
        // Touch fallback: tap on non-link parts of the trigger opens the card.
        const isTouch = window.matchMedia('(hover: none)').matches
        if (isTouch && !(e.target as HTMLElement).closest('a')) { e.preventDefault(); open ? setOpen(false) : show() }
      }}>
      {children}
      {open && pos && createPortal(
        <div id={`thc-${userId}`} className="thc-card" style={{ top: pos.top, left: pos.left, width: CARD_W }}
          onPointerEnter={cancelHide} onPointerLeave={(e) => { if (e.pointerType === 'mouse') scheduleHide() }}>
          <div className="thc-head">
            <Link href={`/${username}`} className="thc-id">
              {avatarUrl
                ? <img src={avatarUrl} alt="" className="thc-av" />
                : <span className="thc-av thc-av-ph">{(displayName || username).charAt(0).toUpperCase()}</span>}
              <span className="thc-names"><b>{displayName || username}</b><span>@{username}</span></span>
            </Link>
            {data && !data.isSelf && <CardActions userId={userId} data={data} onChange={updateData} />}
          </div>
          {data
            ? <div className="thc-stats">
                <span><b>{Math.round(data.winRate * 100)}%</b> win rate</span>
                <span><b>{data.trades}</b> trades</span>
                <span><b>Lvl {data.level}</b></span>
              </div>
            : !failed && <div className="thc-stats thc-loading">Loading…</div>}
        </div>,
        document.body,
      )}
    </div>
  )
}
```

- [ ] **Step 2: Style**

Append to `app/src/app/globals.css`:

```css
/* Trader hover card */
.thc-wrap { display: flex; align-items: center; gap: 11px; min-width: 0; flex: 1; }
.thc-card { position: fixed; z-index: 300; background: var(--card, #fff); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 12px 32px rgba(20,16,41,.14); padding: 14px; }
.thc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.thc-id { display: flex; align-items: center; gap: 10px; min-width: 0; color: inherit; text-decoration: none; }
.thc-av { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; flex: none; }
.thc-av-ph { display: inline-flex; align-items: center; justify-content: center; background: var(--sunk); color: var(--dim); font-weight: 700; }
.thc-names { min-width: 0; }
.thc-names b { display: block; font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thc-names span { display: block; font-family: var(--mono); font-size: 11.5px; color: var(--faint); }
.thc-actions { display: flex; align-items: center; gap: 7px; flex: none; }
.thc-star { width: 30px; height: 30px; border-radius: 8px; }
.thc-stats { display: flex; gap: 14px; margin-top: 12px; font-size: 12.5px; color: var(--dim); }
.thc-stats b { color: var(--text); font-weight: 700; }
.thc-loading { color: var(--faint); }
```

(Check the CSS variables used — `--card`, `--line`, `--sunk`, `--dim`, `--faint`, `--text`, `--mono` — all exist in `globals.css`; substitute the project's actual token names if any differ. `.h-followbtn` comes from `home-arena.css`, which is imported by the pages that render the card's consumers — verify when wiring in Task 7; if a consumer page lacks it, style the follow button with a `.thc-follow` class here instead.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (component not yet consumed anywhere).

- [ ] **Step 4: Commit**

```bash
git add app/src/app/_components/TraderHoverCard.tsx app/src/app/globals.css
git commit -m "feat(social): trader hover card with follow/star actions"
```

---

### Task 7: Wire hover card into feed, leaderboard, rail

**Files:**
- Modify: `app/src/app/feed/_components/home/ArenaPostCard.tsx` (header block, lines 96–105)
- Modify: `app/src/app/leaderboard/_components/LeaderboardTable.tsx` (lines 79–85)
- Modify: `app/src/app/leaderboard/_components/XpTable.tsx` (lines 59–65)
- Modify: `app/src/app/feed/_components/home/rail.tsx` (`TopTraders`, lines 64–73)

**Interfaces:**
- Consumes: `TraderHoverCard` (Task 6).

- [ ] **Step 1: ArenaPostCard**

Import: `import { TraderHoverCard } from '@/app/_components/TraderHoverCard'`

Wrap the avatar + `.who` block (keep the delete/follow chip outside):

```tsx
      <div className="h-trade-h">
        <TraderHoverCard userId={a.id} username={a.username} displayName={a.display_name} avatarUrl={a.avatar_url}>
          <Avatar seed={a.username} src={a.avatar_url} name={a.display_name || a.username} size={40} ring />
          <div className="who">
            <b>
              <Link href={`/${a.username}`}>{a.display_name || a.username}</Link>
              {item.fromFavorite && <Icon name="star" size={13} style={{ color: 'var(--xp)', fill: 'currentColor' }} />}
            </b>
            <div className="meta"><span>@{a.username}</span><span>·</span><span>{timeAgo(item.created_at)}</span></div>
          </div>
        </TraderHoverCard>
        {item.isOwn
          ? <button className="h-followbtn on" onClick={() => start(async () => { await deletePost(item.id); router.refresh() })}>Delete</button>
          : <FollowChip targetId={a.id} initial={isFollowing} />}
      </div>
```

(`.thc-wrap` is `flex: 1` with the same `gap: 11px` as `.h-trade-h`, so the layout — chip pushed right — is preserved. The `.h-trade-h .who` mobile styles still apply since `.who` remains a descendant.)

- [ ] **Step 2: LeaderboardTable + XpTable**

Same import in both. In each, wrap the `.lb-trader` inner content:

```tsx
                    <div className="lb-trader">
                      <TraderHoverCard userId={t.userId} username={t.username} displayName={t.displayName} avatarUrl={t.avatarUrl}>
                        <Avatar src={t.avatarUrl} name={t.displayName || t.username} size={38} ring={t.rank <= 3} />
                        <div className="who" style={{ minWidth: 0 }}>
                          <b>{t.displayName || t.username}{self && <span className="lb-you">You</span>}</b>
                          <span>@{t.username}</span>
                        </div>
                      </TraderHoverCard>
                    </div>
```

(XpTable has no `ring` on rank — keep each file's existing `Avatar` props exactly; only add the wrapper. Note: both leaderboard components render `FollowButton`, so they already work standalone; the hover card adds the star. `home-arena.css` is not imported by the leaderboard page — per Task 6 Step 2 note, verify `.h-followbtn` renders acceptably; if unstyled, add to `globals.css`: `.thc-actions .h-followbtn { font-size: 12px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: transparent; cursor: pointer; } .thc-actions .h-followbtn.on { color: var(--dim); }`.)

- [ ] **Step 3: Rail (`TopTraders`)**

In `rail.tsx`, `TopTraders` rows are wrapped in a `<Link>` — a hover card with interactive buttons inside a link is a nesting problem. Change the row so the identity part is the hover trigger and the link remains on the surrounding row via the P/L area only being plain content:

```tsx
      {leaders.map((t) => {
        const me = t.userId === userId
        return (
          <div key={t.userId} className={'h-lt g' + t.rank} style={me ? { background: 'rgba(124,92,230,0.06)' } : undefined}>
            <span className="rk">{t.rank}</span>
            <TraderHoverCard userId={t.userId} username={t.username} displayName={t.displayName} avatarUrl={t.avatarUrl}>
              <Link href={`/${t.username}`} style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, flex: 1, color: 'inherit', textDecoration: 'none' }}>
                <Avatar seed={t.username} src={t.avatarUrl} name={t.displayName || t.username} size={34} ring={t.rank <= 3} />
                <div className="who"><b>@{t.username}{me && <span className="h-mini-lv" style={{ marginLeft: 6 }}>You</span>}</b><span>{Math.round(t.winRate * 100)}% win · {t.trades} trades</span></div>
              </Link>
            </TraderHoverCard>
            <div className="pl"><div className={'v ' + (t.pnl >= 0 ? 'h-up' : 'h-down')}>{money(t.pnl)}</div><div className="sub"><Sparkline seed={t.username.length + t.rank} trend={t.pnl >= 0 ? 2 : -2} color={t.pnl >= 0 ? '#12A56B' : '#E5475D'} fill={false} w={56} h={14} strokeW={1.6} /></div></div>
          </div>
        )
      })}
```

Import `TraderHoverCard` in `rail.tsx`. Check `.h-lt` CSS in `home-arena.css`: it currently styles a link (likely has `cursor: pointer` etc.); the outer element is now a `div` — if row hover styling relies on `a.h-lt`, adjust the selector or keep visual parity by testing in preview. Row click-through to the profile is preserved via the inner `Link` (identity area) — the P/L area is no longer clickable, which is acceptable.

- [ ] **Step 4: Typecheck + tests + build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/feed/_components/home/ArenaPostCard.tsx app/src/app/leaderboard/_components/LeaderboardTable.tsx app/src/app/leaderboard/_components/XpTable.tsx app/src/app/feed/_components/home/rail.tsx app/src/app/globals.css
git commit -m "feat(social): hover card on author identity in feed, leaderboard, rail"
```

---

### Task 8: End-to-end verification (preview)

**Files:** none (verification only)

- [ ] **Step 1: Start dev server** (preview tools; `.claude/launch.json` config if present, else `npm run dev` from `app/`)

- [ ] **Step 2: Verify with a seeded demo user** (creds in `scripts/seed-users.md` per project memory)

1. Log in; open a seeded trader's profile → star button next to Follow; click → fills; reload → persists; Follow shows "Following" (auto-follow).
2. Home feed → starred trader's recent posts at top with ★ badge next to the author name.
3. Hover an author name in the feed → card appears after ~300ms with stats and Follow/★; toggle star from card → feed reorders after refresh.
4. Leaderboard → hover a trader row → card works.
5. Unstar from profile → Follow button still shows "Following" (follow kept).
6. Own posts/rows → hover card shows stats but no buttons.
7. Check browser console + server logs for errors.

- [ ] **Step 3: RLS spot check**

Supabase MCP `execute_sql`:
```sql
-- as service role this returns rows; the RLS check is that the API (anon key,
-- user A's JWT) cannot see user B's rows. Verify policy qual instead:
select policyname, qual from pg_policies where tablename = 'favorites';
```
Expected: every policy qual/with_check contains `user_id = auth.uid()`.

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: PASS.
