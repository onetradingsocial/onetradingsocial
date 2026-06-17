# Social Core (Follow + Feed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 3a — a working social feed on the home page: follow traders, post text, like, comment, with clickable user links and real follower counts.

**Architecture:** Pure helpers (`lib/feed.ts`, `lib/time.ts`) are unit-tested. A `0003_social.sql` migration adds `follows`/`posts`/`likes`/`comments` with RLS. Server actions (`actions/social.ts`) mutate with auth+ownership checks. The home page (server component) assembles the feed; client components handle optimistic like/follow and lazy comment loading.

**Tech Stack:** Next.js 15 (App Router, TS), Tailwind + brand `globals.css`, `@supabase/ssr`, Vitest, Playwright.

---

## Conventions

- In-app route paths omit `/app` basePath in code.
- Supabase cookies: getAll/setAll only.
- Pure helpers take primitives; actions do I/O.
- Run npm from `app/`. Commit after every task.

---

## File Structure

```
app/src/lib/feed.ts                              # assembleFeed + tally (pure)
app/src/lib/time.ts                              # timeAgo (pure)
app/supabase/migrations/0003_social.sql          # follows, posts, likes, comments + RLS
app/src/app/actions/social.ts                    # post/like/comment/follow actions
app/src/app/_components/UserLink.tsx             # avatar + @username -> profile (shared)
app/src/app/_components/FollowButton.tsx         # client optimistic follow
app/src/app/feed/_components/
    PostComposer.tsx
    PostCard.tsx
    LikeButton.tsx
    CommentThread.tsx
    SuggestedTraders.tsx
app/src/app/page.tsx                             # home feed (modify)
app/src/app/[username]/page.tsx                  # real follow counts + button (modify)
app/src/app/globals.css                          # social styles (modify)
app/tests/unit/feed.test.ts
app/tests/e2e/social.spec.ts
```

---

## Task 1: Feed helpers (TDD)

**Files:** Create `app/src/lib/feed.ts`; Test `app/tests/unit/feed.test.ts`.

- [ ] **Step 1: Write the failing test**

`app/tests/unit/feed.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { assembleFeed, tally } from '@/lib/feed'

describe('assembleFeed', () => {
  it('keeps primary first, appends unique fallback, caps to limit', () => {
    const primary = [{ id: 'a' }, { id: 'b' }]
    const fallback = [{ id: 'b' }, { id: 'c' }, { id: 'd' }]
    expect(assembleFeed(primary, fallback, 3).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
  it('returns only primary when it already fills the limit', () => {
    expect(assembleFeed([{ id: 'a' }, { id: 'b' }], [{ id: 'c' }], 2).map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('tally', () => {
  it('counts occurrences of a key', () => {
    expect(tally([{ post_id: 'a' }, { post_id: 'a' }, { post_id: 'b' }], 'post_id')).toEqual({ a: 2, b: 1 })
  })
  it('handles empty/undefined', () => {
    expect(tally(null, 'post_id')).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- feed`
Expected: FAIL — `@/lib/feed` not found.

- [ ] **Step 3: Implement `app/src/lib/feed.ts`**

```ts
export function assembleFeed<T extends { id: string }>(primary: T[], fallback: T[], limit: number): T[] {
  const seen = new Set(primary.map((p) => p.id))
  const merged: T[] = [...primary]
  for (const f of fallback) {
    if (merged.length >= limit) break
    if (!seen.has(f.id)) { seen.add(f.id); merged.push(f) }
  }
  return merged.slice(0, limit)
}

export function tally<K extends string>(rows: Array<Record<K, string>> | null | undefined, key: K): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows ?? []) out[r[key]] = (out[r[key]] ?? 0) + 1
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- feed`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/feed.ts app/tests/unit/feed.test.ts
git commit -m "feat(app): feed assembly helpers"
```

---

## Task 2: Relative-time helper (TDD)

**Files:** Create `app/src/lib/time.ts`; append to `app/tests/unit/feed.test.ts`.

- [ ] **Step 1: Append failing test to `app/tests/unit/feed.test.ts`**

```ts
import { timeAgo } from '@/lib/time'

describe('timeAgo', () => {
  const base = new Date('2026-06-18T12:00:00Z').getTime()
  it('formats seconds/minutes/hours/days', () => {
    expect(timeAgo('2026-06-18T11:59:30Z', base)).toBe('just now')
    expect(timeAgo('2026-06-18T11:45:00Z', base)).toBe('15m')
    expect(timeAgo('2026-06-18T09:00:00Z', base)).toBe('3h')
    expect(timeAgo('2026-06-15T12:00:00Z', base)).toBe('3d')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- feed`
Expected: FAIL — `@/lib/time` not found.

- [ ] **Step 3: Implement `app/src/lib/time.ts`**

```ts
export function timeAgo(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const s = Math.floor(diff / 1000)
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w`
  return new Date(iso).toLocaleDateString()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- feed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/time.ts app/tests/unit/feed.test.ts
git commit -m "feat(app): relative time helper"
```

---

## Task 3: Database migration

**Files:** Create `app/supabase/migrations/0003_social.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- Follows
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows(following_id);
alter table public.follows enable row level security;
drop policy if exists follows_select on public.follows;
create policy follows_select on public.follows for select using (true);
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows for insert with check (follower_id = auth.uid());
drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete using (follower_id = auth.uid());

-- Posts
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists posts_created_idx on public.posts(created_at desc);
create index if not exists posts_author_idx on public.posts(author_id, created_at desc);
drop trigger if exists posts_touch_updated_at on public.posts;
create trigger posts_touch_updated_at before update on public.posts
  for each row execute function public.touch_updated_at();
alter table public.posts enable row level security;
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select using (true);
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert with check (author_id = auth.uid());
drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts for update using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete using (author_id = auth.uid());

-- Likes
create table if not exists public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists likes_post_idx on public.likes(post_id);
alter table public.likes enable row level security;
drop policy if exists likes_select on public.likes;
create policy likes_select on public.likes for select using (true);
drop policy if exists likes_insert on public.likes;
create policy likes_insert on public.likes for insert with check (user_id = auth.uid());
drop policy if exists likes_delete on public.likes;
create policy likes_delete on public.likes for delete using (user_id = auth.uid());

-- Comments
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments(post_id, created_at);
alter table public.comments enable row level security;
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select using (true);
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert with check (author_id = auth.uid());
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete using (author_id = auth.uid());
```

- [ ] **Step 2: Apply the migration**

In Supabase dashboard → SQL Editor, run `0003_social.sql`. (`touch_updated_at` already exists from `0001`.)
Expected: 4 tables present with RLS policies.

- [ ] **Step 3: Verify**

```sql
select tablename, count(*) from pg_policies where tablename in ('follows','posts','likes','comments') group by tablename;
```
Expected: follows 3, posts 4, likes 3, comments 3.

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0003_social.sql
git commit -m "feat(app): social schema (follows, posts, likes, comments) + RLS"
```

---

## Task 4: Social server actions

**Files:** Create `app/src/app/actions/social.ts`.

- [ ] **Step 1: Implement `app/src/app/actions/social.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type SocialState = { error?: string; ok?: boolean }

export type CommentItem = {
  id: string; body: string; created_at: string; isOwn: boolean
  author: { username: string; display_name: string | null; avatar_url: string | null }
}

export async function createPost(formData: FormData): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const body = String(formData.get('body') ?? '').trim()
  if (!body) return { error: 'Write something first.' }
  if (body.length > 2000) return { error: 'Post is too long (2000 max).' }
  const { error } = await supabase.from('posts').insert({ author_id: user.id, body })
  if (error) return { error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function deletePost(postId: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  await supabase.from('posts').delete().eq('id', postId).eq('author_id', user.id)
  revalidatePath('/')
  return { ok: true }
}

export async function toggleLike(postId: string): Promise<{ liked: boolean; count: number } | SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const { data: existing } = await supabase.from('likes')
    .select('post_id').eq('post_id', postId).eq('user_id', user.id).maybeSingle()
  if (existing) await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', user.id)
  else await supabase.from('likes').insert({ post_id: postId, user_id: user.id })
  const { count } = await supabase.from('likes').select('*', { count: 'exact', head: true }).eq('post_id', postId)
  return { liked: !existing, count: count ?? 0 }
}

export async function getComments(postId: string): Promise<CommentItem[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase.from('comments')
    .select('id, body, created_at, author_id, author:profiles!comments_author_id_fkey(username, display_name, avatar_url)')
    .eq('post_id', postId).order('created_at', { ascending: true })
  return (data ?? []).map((c) => {
    const author = (Array.isArray(c.author) ? c.author[0] : c.author) as { username: string; display_name: string | null; avatar_url: string | null }
    return { id: c.id, body: c.body, created_at: c.created_at, isOwn: c.author_id === user?.id, author }
  })
}

export async function addComment(postId: string, body: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const text = body.trim()
  if (!text) return { error: 'Comment is empty.' }
  if (text.length > 1000) return { error: 'Comment too long.' }
  const { error } = await supabase.from('comments').insert({ post_id: postId, author_id: user.id, body: text })
  if (error) return { error: error.message }
  return { ok: true }
}

export async function deleteComment(commentId: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  await supabase.from('comments').delete().eq('id', commentId).eq('author_id', user.id)
  return { ok: true }
}

export async function follow(targetId: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (targetId === user.id) return { error: "You can't follow yourself." }
  await supabase.from('follows').upsert(
    { follower_id: user.id, following_id: targetId },
    { onConflict: 'follower_id,following_id', ignoreDuplicates: true },
  )
  revalidatePath('/')
  return { ok: true }
}

export async function unfollow(targetId: string): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', targetId)
  revalidatePath('/')
  return { ok: true }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/actions/social.ts
git commit -m "feat(app): social server actions (post/like/comment/follow)"
```

---

## Task 5: Social CSS

**Files:** Modify `app/src/app/globals.css`.

- [ ] **Step 1: Append to `app/src/app/globals.css`**

```css
/* ---------- Social feed ---------- */
.ts-feed { display: grid; grid-template-columns: 1fr 300px; gap: 22px; align-items: start; }
@media (max-width: 900px) { .ts-feed { grid-template-columns: 1fr; } .ts-feed-side { display: none; } }
.ts-feed-main { display: flex; flex-direction: column; gap: 16px; }

.ts-userlink { display: inline-flex; align-items: center; gap: 10px; }
.ts-userlink-av { width: 38px; height: 38px; border-radius: 11px; object-fit: cover; flex: none; }
.ts-userlink-ph { display: inline-flex; align-items: center; justify-content: center; background: var(--brand-grad); color: #fff; font-family: var(--display); font-weight: 700; }
.ts-userlink-meta { display: flex; flex-direction: column; line-height: 1.2; }
.ts-userlink-meta .nm { font-weight: 700; font-size: 14.5px; color: var(--text); }
.ts-userlink-meta .un { font-size: 12.5px; color: var(--faint); }
.ts-userlink:hover .nm { color: var(--violet-br); }

.ts-composer { padding: 18px; }
.ts-composer-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; gap: 12px; flex-wrap: wrap; }
.ts-composer-attach { display: flex; align-items: center; gap: 8px; }
.ts-attach { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 10px; border: 1px solid var(--border-2); background: var(--surface-2); font-size: 13px; font-weight: 600; color: var(--dim); }
.ts-attach:disabled { opacity: 0.6; }

.ts-post { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; box-shadow: var(--shadow-sm); padding: 18px; }
.ts-post-head { display: flex; align-items: center; justify-content: space-between; }
.ts-post-body { margin-top: 12px; white-space: pre-wrap; line-height: 1.55; color: var(--text); }
.ts-post-acts { display: flex; align-items: center; gap: 8px; margin-top: 14px; border-top: 1px solid var(--border); padding-top: 12px; }
.ts-act { display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border-radius: 10px; font-size: 13.5px; font-weight: 600; color: var(--dim); }
.ts-act:hover { background: var(--surface-2); }
.ts-act--on { color: var(--down); }
.ts-mini { font-size: 12.5px; color: var(--faint); font-weight: 600; }
.ts-mini:hover { color: var(--down); }

.ts-comments { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px; display: flex; flex-direction: column; gap: 12px; }
.ts-comment { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: start; }
.ts-comment p { font-size: 14px; color: var(--text); }
.ts-comment-add { display: flex; gap: 8px; }

.ts-suggest { padding: 18px; position: sticky; top: 80px; }
.ts-suggest-list { display: flex; flex-direction: column; gap: 14px; }
.ts-suggest-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: pass (CSS only).

- [ ] **Step 3: Commit**

```bash
git add app/src/app/globals.css
git commit -m "feat(app): social feed styles"
```

---

## Task 6: UserLink component

**Files:** Create `app/src/app/_components/UserLink.tsx`.

- [ ] **Step 1: Implement**

```tsx
import Link from 'next/link'

export function UserLink({ username, displayName, avatarUrl, sub }: {
  username: string; displayName?: string | null; avatarUrl?: string | null; sub?: string
}) {
  const name = displayName || username
  return (
    <Link href={`/${username}`} className="ts-userlink">
      {avatarUrl
        ? <img src={avatarUrl} alt="" className="ts-userlink-av" />
        : <span className="ts-userlink-av ts-userlink-ph">{name.charAt(0).toUpperCase()}</span>}
      <span className="ts-userlink-meta">
        <span className="nm">{name}</span>
        <span className="un">@{username}{sub ? ` · ${sub}` : ''}</span>
      </span>
    </Link>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/_components/UserLink.tsx
git commit -m "feat(app): clickable UserLink component"
```

---

## Task 7: FollowButton + profile counts

**Files:** Create `app/src/app/_components/FollowButton.tsx`; Modify `app/src/app/[username]/page.tsx`.

- [ ] **Step 1: Implement `FollowButton.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { follow, unfollow } from '@/app/actions/social'

export function FollowButton({ targetId, initialFollowing }: { targetId: string; initialFollowing: boolean }) {
  const [following, setFollowing] = useState(initialFollowing)
  const [pending, start] = useTransition()
  function toggle() {
    const next = !following
    setFollowing(next)
    start(async () => {
      const r = next ? await follow(targetId) : await unfollow(targetId)
      if ('error' in r && r.error) setFollowing(!next)
    })
  }
  return (
    <button type="button" className={following ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'} onClick={toggle} disabled={pending}>
      {following ? 'Following' : 'Follow'}
    </button>
  )
}
```

- [ ] **Step 2: Wire counts + button into `app/src/app/[username]/page.tsx`**

Read the current file. After `if (!profile) notFound()` and the existing `idRow` query, add follow data. Add import at top:

```tsx
import { FollowButton } from '@/app/_components/FollowButton'
```

After the existing `const { data: idRow } = ...` block (which selects `id, account_currency`), add:

```tsx
  const profileId = idRow?.id
  const { data: { user: viewer } } = await supabase.auth.getUser()
  let followerCount = 0, followingCount = 0, isFollowing = false
  if (profileId) {
    const fc = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', profileId)
    const gc = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', profileId)
    followerCount = fc.count ?? 0
    followingCount = gc.count ?? 0
    if (viewer && viewer.id !== profileId) {
      const { data: vf } = await supabase.from('follows')
        .select('follower_id').eq('follower_id', viewer.id).eq('following_id', profileId).maybeSingle()
      isFollowing = !!vf
    }
  }
  const isSelf = !!(viewer && profileId && viewer.id === profileId)
```

Replace the existing Followers stat cell:

```tsx
          <div className="ts-stat"><dt>Followers</dt><dd>0 · 0 following</dd></div>
```

with:

```tsx
          <div className="ts-stat"><dt>Followers</dt><dd>{followerCount} · {followingCount} following</dd></div>
```

And in the profile header, after the `<div>` containing name + @username, add a follow button when viewing someone else. Find:

```tsx
          <div>
            <h1 className="ts-h1">{name}</h1>
            <p className="muted" style={{ fontWeight: 600 }}>@{profile.username}</p>
          </div>
```

Replace with:

```tsx
          <div style={{ flex: 1 }}>
            <h1 className="ts-h1">{name}</h1>
            <p className="muted" style={{ fontWeight: 600 }}>@{profile.username}</p>
          </div>
          {viewer && !isSelf && profileId && <FollowButton targetId={profileId} initialFollowing={isFollowing} />}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/_components/FollowButton.tsx app/src/app/[username]/page.tsx
git commit -m "feat(app): follow button and real follower counts on profile"
```

---

## Task 8: PostComposer

**Files:** Create `app/src/app/feed/_components/PostComposer.tsx`.

- [ ] **Step 1: Implement**

```tsx
'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createPost } from '@/app/actions/social'

export function PostComposer() {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()

  function onSubmit(formData: FormData) {
    setError('')
    start(async () => {
      const r = await createPost(formData)
      if (r.error) { setError(r.error); return }
      formRef.current?.reset()
      router.refresh()
    })
  }

  return (
    <form ref={formRef} action={onSubmit} className="ts-card ts-composer">
      <textarea name="body" className="ts-textarea" rows={3} maxLength={2000}
        placeholder="Share an idea, a setup, or a win…" />
      <div className="ts-composer-foot">
        <div className="ts-composer-attach">
          <button type="button" className="ts-attach" disabled title="Attach trade — coming soon">📈 Trade</button>
          <button type="button" className="ts-attach" disabled title="Attach image — coming soon">🖼 Image</button>
          <button type="button" className="ts-attach" disabled title="Add poll — coming soon">📊 Poll</button>
          <span className="ts-soon">soon</span>
        </div>
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Posting…' : 'Post'}</button>
      </div>
      {error && <p className="ts-error" style={{ marginTop: 10 }}>{error}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/feed/_components/PostComposer.tsx
git commit -m "feat(app): post composer"
```

---

## Task 9: LikeButton

**Files:** Create `app/src/app/feed/_components/LikeButton.tsx`.

- [ ] **Step 1: Implement**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toggleLike } from '@/app/actions/social'

export function LikeButton({ postId, initialLiked, initialCount }: { postId: string; initialLiked: boolean; initialCount: number }) {
  const [liked, setLiked] = useState(initialLiked)
  const [count, setCount] = useState(initialCount)
  const [pending, start] = useTransition()

  function toggle() {
    const next = !liked
    setLiked(next); setCount((c) => c + (next ? 1 : -1))
    start(async () => {
      const r = await toggleLike(postId)
      if ('liked' in r) { setLiked(r.liked); setCount(r.count) }
    })
  }

  return (
    <button type="button" className={`ts-act ${liked ? 'ts-act--on' : ''}`} onClick={toggle} disabled={pending}>
      {liked ? '♥' : '♡'} {count}
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/app/feed/_components/LikeButton.tsx
git commit -m "feat(app): optimistic like button"
```

---

## Task 10: CommentThread

**Files:** Create `app/src/app/feed/_components/CommentThread.tsx`.

- [ ] **Step 1: Implement**

```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { addComment, deleteComment, getComments, type CommentItem } from '@/app/actions/social'
import { UserLink } from '@/app/_components/UserLink'

export function CommentThread({ postId, onCountChange }: { postId: string; onCountChange?: (n: number) => void }) {
  const [comments, setComments] = useState<CommentItem[]>([])
  const [text, setText] = useState('')
  const [pending, start] = useTransition()

  async function load() {
    const cs = await getComments(postId)
    setComments(cs)
    onCountChange?.(cs.length)
  }
  useEffect(() => { load() }, [postId])

  function submit() {
    if (!text.trim()) return
    const b = text; setText('')
    start(async () => { await addComment(postId, b); await load() })
  }
  function remove(id: string) {
    start(async () => { await deleteComment(id); await load() })
  }

  return (
    <div className="ts-comments">
      {comments.map((c) => (
        <div key={c.id} className="ts-comment">
          <UserLink username={c.author.username} displayName={c.author.display_name} avatarUrl={c.author.avatar_url} />
          <p>{c.body}</p>
          {c.isOwn ? <button type="button" className="ts-mini" onClick={() => remove(c.id)}>Delete</button> : <span />}
        </div>
      ))}
      <div className="ts-comment-add">
        <input className="ts-input" placeholder="Write a comment…" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={pending || !text.trim()}>Reply</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/feed/_components/CommentThread.tsx
git commit -m "feat(app): comment thread with lazy load"
```

---

## Task 11: PostCard

**Files:** Create `app/src/app/feed/_components/PostCard.tsx`.

- [ ] **Step 1: Implement**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserLink } from '@/app/_components/UserLink'
import { LikeButton } from './LikeButton'
import { CommentThread } from './CommentThread'
import { deletePost } from '@/app/actions/social'
import { timeAgo } from '@/lib/time'

export type FeedItem = {
  id: string; body: string; created_at: string
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null }
  likeCount: number; commentCount: number; viewerLiked: boolean; isOwn: boolean
}

export function PostCard({ post }: { post: FeedItem }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [commentCount, setCommentCount] = useState(post.commentCount)
  const [, start] = useTransition()

  return (
    <article className="ts-post">
      <div className="ts-post-head">
        <UserLink username={post.author.username} displayName={post.author.display_name} avatarUrl={post.author.avatar_url} sub={timeAgo(post.created_at)} />
        {post.isOwn && <button type="button" className="ts-mini" onClick={() => start(async () => { await deletePost(post.id); router.refresh() })}>Delete</button>}
      </div>
      <p className="ts-post-body">{post.body}</p>
      <div className="ts-post-acts">
        <LikeButton postId={post.id} initialLiked={post.viewerLiked} initialCount={post.likeCount} />
        <button type="button" className="ts-act" onClick={() => setOpen((o) => !o)}>💬 {commentCount}</button>
      </div>
      {open && <CommentThread postId={post.id} onCountChange={setCommentCount} />}
    </article>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/feed/_components/PostCard.tsx
git commit -m "feat(app): post card with like + comments"
```

---

## Task 12: SuggestedTraders + home feed page

**Files:** Create `app/src/app/feed/_components/SuggestedTraders.tsx`; rewrite `app/src/app/page.tsx`.

- [ ] **Step 1: Implement `SuggestedTraders.tsx`**

```tsx
import { UserLink } from '@/app/_components/UserLink'
import { FollowButton } from '@/app/_components/FollowButton'

type Trader = { id: string; username: string; display_name: string | null; avatar_url: string | null }

export function SuggestedTraders({ traders }: { traders: Trader[] }) {
  if (traders.length === 0) return null
  return (
    <div className="ts-card ts-suggest">
      <h2 className="ts-h2">Suggested traders</h2>
      <div className="ts-suggest-list mt-3">
        {traders.map((t) => (
          <div key={t.id} className="ts-suggest-item">
            <UserLink username={t.username} displayName={t.display_name} avatarUrl={t.avatar_url} />
            <FollowButton targetId={t.id} initialFollowing={false} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `app/src/app/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { assembleFeed, tally } from '@/lib/feed'
import { PostComposer } from './feed/_components/PostComposer'
import { PostCard, type FeedItem } from './feed/_components/PostCard'
import { SuggestedTraders } from './feed/_components/SuggestedTraders'

const EMPTY = ['00000000-0000-0000-0000-000000000000']

type RawPost = {
  id: string; body: string; created_at: string; author_id: string
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null } | { id: string; username: string; display_name: string | null; avatar_url: string | null }[]
}

const SELECT = 'id, body, created_at, author_id, author:profiles!posts_author_id_fkey(id, username, display_name, avatar_url)'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: follows } = await supabase.from('follows').select('following_id').eq('follower_id', user.id)
  const followingIds = (follows ?? []).map((f) => f.following_id)
  const authorIds = [user.id, ...followingIds]

  const { data: primaryRaw } = await supabase.from('posts').select(SELECT)
    .in('author_id', authorIds).order('created_at', { ascending: false }).limit(30)

  let fallbackRaw: RawPost[] = []
  if ((primaryRaw?.length ?? 0) < 5) {
    const { data } = await supabase.from('posts').select(SELECT)
      .order('created_at', { ascending: false }).limit(30)
    fallbackRaw = (data ?? []) as RawPost[]
  }

  const merged = assembleFeed((primaryRaw ?? []) as RawPost[], fallbackRaw, 30)
  const postIds = merged.map((p) => p.id)
  const idFilter = postIds.length ? postIds : EMPTY

  const [{ data: likeRows }, { data: myLikes }, { data: commentRows }] = await Promise.all([
    supabase.from('likes').select('post_id').in('post_id', idFilter),
    supabase.from('likes').select('post_id').eq('user_id', user.id).in('post_id', idFilter),
    supabase.from('comments').select('post_id').in('post_id', idFilter),
  ])
  const likeCount = tally(likeRows, 'post_id')
  const commentCount = tally(commentRows, 'post_id')
  const myLikeSet = new Set((myLikes ?? []).map((r) => r.post_id))

  const items: FeedItem[] = merged.map((p) => {
    const author = (Array.isArray(p.author) ? p.author[0] : p.author)
    return {
      id: p.id, body: p.body, created_at: p.created_at, author,
      likeCount: likeCount[p.id] ?? 0, commentCount: commentCount[p.id] ?? 0,
      viewerLiked: myLikeSet.has(p.id), isOwn: author.id === user.id,
    }
  })

  let suggested: { id: string; username: string; display_name: string | null; avatar_url: string | null }[] = []
  if (followingIds.length < 3) {
    const { data: sug } = await supabase.from('profiles')
      .select('id, username, display_name, avatar_url')
      .eq('is_public', true).eq('onboarding_completed', true).neq('id', user.id)
      .order('created_at', { ascending: false }).limit(8)
    suggested = (sug ?? []).filter((s) => !followingIds.includes(s.id)).slice(0, 5)
  }

  return (
    <main className="ts-page ts-feed">
      <div className="ts-feed-main">
        <PostComposer />
        {items.length === 0
          ? <p className="faint" style={{ textAlign: 'center', padding: 40 }}>No posts yet. Be the first to share.</p>
          : items.map((p) => <PostCard key={p.id} post={p} />)}
      </div>
      <aside className="ts-feed-side">
        <SuggestedTraders traders={suggested} />
      </aside>
    </main>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/feed/_components/SuggestedTraders.tsx app/src/app/page.tsx
git commit -m "feat(app): home feed page with suggestions"
```

---

## Task 13: Playwright e2e

**Files:** Create `app/tests/e2e/social.spec.ts`.

- [ ] **Step 1: Write the e2e spec**

```ts
import { test, expect } from '@playwright/test'

async function signUp(page: import('@playwright/test').Page) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const username = `s_${stamp}`
  await page.goto('/app/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `s_${stamp}@tradingsocial.io`)
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

test('post, like, and comment on the feed', async ({ page }) => {
  await signUp(page)
  await page.fill('textarea[name="body"]', 'My first setup idea')
  await page.click('button:has-text("Post")')
  await expect(page.locator('.ts-post-body')).toContainText('My first setup idea')

  await page.locator('.ts-act').first().click() // like
  await expect(page.locator('.ts-act--on')).toContainText('1')

  await page.locator('.ts-act', { hasText: '💬' }).click() // open comments
  await page.fill('.ts-comment-add input', 'Nice one')
  await page.click('button:has-text("Reply")')
  await expect(page.locator('.ts-comment')).toContainText('Nice one')
})

test('follow another trader and see their post in the feed', async ({ page }) => {
  const userA = await signUp(page)
  await page.fill('textarea[name="body"]', 'Trader A breakout call')
  await page.click('button:has-text("Post")')
  await expect(page.locator('.ts-post-body')).toContainText('Trader A breakout call')
  // log out
  await page.goto('/app/settings')
  await page.click('button:has-text("Log out")')
  await expect(page).toHaveURL(/\/app\/login/)

  // user B follows A
  await signUp(page)
  await page.goto(`/app/${userA}`)
  await page.click('button:has-text("Follow")')
  await expect(page.locator('button:has-text("Following")')).toBeVisible()
  await page.goto('/app')
  await expect(page.locator('.ts-feed-main')).toContainText('Trader A breakout call')
})
```

- [ ] **Step 2: Run the suite**

Run: `npm run test:e2e -- social`
Expected: 2 passed. (Dev server with valid `.env.local`; migration `0003` applied.)

- [ ] **Step 3: Commit**

```bash
git add app/tests/e2e/social.spec.ts
git commit -m "test(app): e2e social post/like/comment/follow"
```

---

## Final Verification

- [ ] `cd app && npm test` → unit tests pass (feed + time + earlier).
- [ ] `cd app && npm run build` → production build succeeds.
- [ ] `cd app && npm run test:e2e -- social` → social e2e passes.
- [ ] Apply `0003_social.sql` to Supabase before running anything live.
- [ ] Manual: post text, like, comment, delete; follow/unfollow a trader and confirm feed + counts update; click an avatar/@username → lands on that profile.
```
