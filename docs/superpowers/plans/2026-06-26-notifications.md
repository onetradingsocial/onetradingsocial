# Phase 9a: In-App Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time in-app notifications (bell icon + dropdown) that fire on like, comment, follow, trade-share, and @mention events.

**Architecture:** A `notifications` Postgres table receives rows via service-role writes in existing Server Actions; a `NotificationBell` client component subscribes to Supabase Realtime for instant updates; initial unread count is fetched server-side in `AppNav` to avoid flash.

**Tech Stack:** Next.js App Router, Supabase (Postgres + Realtime), `@supabase/supabase-js` browser client, Vitest (unit), Playwright (e2e).

## Global Constraints

- All DB writes to `notifications` use the **service-role client** (`createServiceClient()` from `@/lib/supabase/service`) — no authenticated-user RLS insert policy exists.
- Server-only modules must import `'server-only'` at top.
- No `replyComment` action exists in the codebase — the `reply` notification type is **deferred**; implement `like`, `comment`, `follow`, `post_share`, `mention` only.
- `toggleLike` toggles; only insert a notification when the result is a **like** (not unlike).
- `post_share` fires only for posts with `attachment_type === 'trade'`.
- Self-notifications suppressed: never insert when `actorId === userId`.
- `extractMentions` deduplicates: multiple @same mentions → one notification.
- Migration file lives at `app/supabase/migrations/0010_notifications.sql`; also apply to Supabase Cloud via MCP `apply_migration`.
- Unit tests: `app/tests/unit/notifications.test.ts` (vitest).
- E2E tests: `app/tests/e2e/notifications.spec.ts` (Playwright). Warm dev server before running. Usernames ≤ 20 chars.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `app/supabase/migrations/0010_notifications.sql` | Create | DB schema + RLS |
| `app/src/lib/notifications.ts` | Create | `insertNotification`, `extractMentions` — pure, no DB of their own |
| `app/src/lib/server/notifications.ts` | Create | `getNotifications`, `getUnreadCount`, `markAllRead`, `markRead` |
| `app/src/app/actions/notifications.ts` | Create | Server Actions: `markNotificationRead`, `markAllNotificationsRead` |
| `app/src/app/actions/social.ts` | Modify | Wire `insertNotification` into `toggleLike`, `addComment`, `follow`, `createPost` |
| `app/src/app/hooks/useNotifications.ts` | Create | Realtime subscription hook |
| `app/src/app/_components/NotificationBell.tsx` | Create | Bell icon + dropdown client component |
| `app/src/app/_components/AppNav.tsx` | Modify | Fetch `initialUnreadCount` + `initialNotifications` server-side; render `<NotificationBell>` |
| `app/tests/unit/notifications.test.ts` | Create | Unit tests |
| `app/tests/e2e/notifications.spec.ts` | Create | E2E tests |

---

### Task 1: Migration — `notifications` table

**Files:**
- Create: `app/supabase/migrations/0010_notifications.sql`

**Interfaces:**
- Produces: `notifications` table with columns `id, user_id, actor_id, type, entity_id, entity_type, read, created_at`; RLS owner-select policy; index on `(user_id, created_at desc)`

- [ ] **Step 1: Write migration SQL**

```sql
-- app/supabase/migrations/0010_notifications.sql
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete cascade not null,
  actor_id    uuid references profiles(id) on delete cascade not null,
  type        text not null check (type in ('like','comment','follow','post_share','mention')),
  entity_id   uuid,
  entity_type text check (entity_type in ('post','comment','trade')),
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index notifications_user_id_created_at on notifications (user_id, created_at desc);

alter table notifications enable row level security;

create policy "owner select" on notifications
  for select using (auth.uid() = user_id);
```

- [ ] **Step 2: Apply to Supabase Cloud via MCP**

Use the Supabase MCP tool `apply_migration` with:
- `name`: `0010_notifications`
- `query`: the full SQL above

Verify success: MCP returns no error.

- [ ] **Step 3: Enable Realtime on the table**

In the Supabase dashboard → Database → Replication → enable `notifications` table for realtime publication. (Or run via MCP `execute_sql`):

```sql
alter publication supabase_realtime add table notifications;
```

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0010_notifications.sql
git commit -m "feat(notifications): migration 0010 — notifications table + RLS"
```

---

### Task 2: Pure helpers — `lib/notifications.ts`

**Files:**
- Create: `app/src/lib/notifications.ts`

**Interfaces:**
- Consumes: `SupabaseClient` (service-role), notification fields
- Produces:
  - `NotificationType` — `'like' | 'comment' | 'follow' | 'post_share' | 'mention'`
  - `insertNotification(args: InsertNotificationArgs): Promise<void>`
  - `extractMentions(text: string): string[]`

- [ ] **Step 1: Write the failing unit tests first** (in `app/tests/unit/notifications.test.ts`, partial — only the pure-function tests)

```ts
// app/tests/unit/notifications.test.ts
import { describe, it, expect, vi } from 'vitest'
import { extractMentions } from '@/lib/notifications'

describe('extractMentions', () => {
  it('returns empty array when no mentions', () => {
    expect(extractMentions('Hello world')).toEqual([])
  })
  it('parses single @mention', () => {
    expect(extractMentions('Nice trade @alice!')).toEqual(['alice'])
  })
  it('parses multiple @mentions deduped', () => {
    expect(extractMentions('@bob great call @alice @bob')).toEqual(['bob', 'alice'])
  })
  it('parses mention at start of string', () => {
    expect(extractMentions('@carol check this')).toEqual(['carol'])
  })
  it('ignores email-style patterns', () => {
    // @ preceded by a word char is an email — not a mention
    expect(extractMentions('email me@example.com')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd app && npx vitest run tests/unit/notifications.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/notifications'`

- [ ] **Step 3: Implement `lib/notifications.ts`**

```ts
// app/src/lib/notifications.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type NotificationType = 'like' | 'comment' | 'follow' | 'post_share' | 'mention'

export interface InsertNotificationArgs {
  supabase: SupabaseClient
  userId: string      // recipient
  actorId: string     // who triggered
  type: NotificationType
  entityId?: string
  entityType?: 'post' | 'comment' | 'trade'
}

export async function insertNotification({
  supabase, userId, actorId, type, entityId, entityType,
}: InsertNotificationArgs): Promise<void> {
  if (actorId === userId) return  // no self-notifications

  if (type === 'follow') {
    // deduplicate: skip if a follow notification already exists
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('actor_id', actorId)
      .eq('type', 'follow')
      .maybeSingle()
    if (existing) return
  }

  await supabase.from('notifications').insert({
    user_id: userId,
    actor_id: actorId,
    type,
    entity_id: entityId ?? null,
    entity_type: entityType ?? null,
  })
}

// Returns unique lowercase usernames mentioned with @username syntax.
// Ignores email patterns (@ preceded by a word char).
export function extractMentions(text: string): string[] {
  const matches = text.match(/(?<![a-zA-Z0-9_])@([a-zA-Z0-9_]+)/g) ?? []
  const seen = new Set<string>()
  const result: string[] = []
  for (const m of matches) {
    const username = m.slice(1).toLowerCase()
    if (!seen.has(username)) { seen.add(username); result.push(username) }
  }
  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd app && npx vitest run tests/unit/notifications.test.ts
```

Expected: PASS (extractMentions tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/notifications.ts app/tests/unit/notifications.test.ts
git commit -m "feat(notifications): extractMentions + insertNotification helpers"
```

---

### Task 3: Server reads — `lib/server/notifications.ts`

**Files:**
- Create: `app/src/lib/server/notifications.ts`

**Interfaces:**
- Consumes: `SupabaseClient` (service-role), `userId: string`
- Produces:
  ```ts
  export type Notification = {
    id: string
    actorId: string
    actorUsername: string
    actorAvatarUrl: string | null
    type: NotificationType
    entityId: string | null
    entityType: 'post' | 'comment' | 'trade' | null
    read: boolean
    createdAt: string
  }
  export async function getNotifications(supabase, userId, opts?): Promise<Notification[]>
  export async function getUnreadCount(supabase, userId): Promise<number>
  export async function markAllRead(supabase, userId): Promise<void>
  export async function markRead(supabase, userId, notificationId): Promise<void>
  ```

- [ ] **Step 1: Add server-read tests to `notifications.test.ts`**

```ts
// Append to app/tests/unit/notifications.test.ts
import { getUnreadCount, markAllRead } from '@/lib/server/notifications'

function makeMockSupabase(rows: object[], count?: number) {
  const chain: Record<string, unknown> = {}
  const builder = (table?: string) => ({
    select: () => builder(),
    eq: () => builder(),
    update: () => builder(),
    order: () => builder(),
    limit: () => Promise.resolve({ data: rows, count: count ?? rows.length, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: rows, count: count ?? rows.length, error: null }),
  })
  return { from: () => builder() } as unknown as import('@supabase/supabase-js').SupabaseClient
}

describe('getUnreadCount', () => {
  it('returns count of unread notifications', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ count: 3, error: null }),
          }),
        }),
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient
    expect(await getUnreadCount(supabase, 'user1')).toBe(3)
  })

  it('returns 0 on error', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ count: null, error: { message: 'err' } }),
          }),
        }),
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient
    expect(await getUnreadCount(supabase, 'user1')).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd app && npx vitest run tests/unit/notifications.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/server/notifications'`

- [ ] **Step 3: Implement `lib/server/notifications.ts`**

```ts
// app/src/lib/server/notifications.ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationType } from '@/lib/notifications'

export type Notification = {
  id: string
  actorId: string
  actorUsername: string
  actorAvatarUrl: string | null
  type: NotificationType
  entityId: string | null
  entityType: 'post' | 'comment' | 'trade' | null
  read: boolean
  createdAt: string
}

export async function getNotifications(
  supabase: SupabaseClient,
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<Notification[]> {
  const { limit = 20, offset = 0 } = opts
  const { data } = await supabase
    .from('notifications')
    .select('id, actor_id, type, entity_id, entity_type, read, created_at, actor:profiles!notifications_actor_id_fkey(username, avatar_url)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []).map((row) => {
    const actor = (Array.isArray(row.actor) ? row.actor[0] : row.actor) as { username: string; avatar_url: string | null } | null
    return {
      id: row.id,
      actorId: row.actor_id,
      actorUsername: actor?.username ?? 'unknown',
      actorAvatarUrl: actor?.avatar_url ?? null,
      type: row.type as NotificationType,
      entityId: row.entity_id ?? null,
      entityType: row.entity_type ?? null,
      read: row.read,
      createdAt: row.created_at,
    }
  })
}

export async function getUnreadCount(supabase: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false)
  if (error) return 0
  return count ?? 0
}

export async function markAllRead(supabase: SupabaseClient, userId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false)
}

export async function markRead(supabase: SupabaseClient, userId: string, notificationId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', notificationId)
    .eq('user_id', userId)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd app && npx vitest run tests/unit/notifications.test.ts
```

Expected: PASS (all tests so far)

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/notifications.ts app/tests/unit/notifications.test.ts
git commit -m "feat(notifications): server-side read helpers"
```

---

### Task 4: Server Actions for mark-read

**Files:**
- Create: `app/src/app/actions/notifications.ts`

**Interfaces:**
- Consumes: `markRead` and `markAllRead` from `@/lib/server/notifications`; `createServiceClient` from `@/lib/supabase/service`
- Produces:
  - `markNotificationRead(id: string): Promise<void>`
  - `markAllNotificationsRead(): Promise<void>`

- [ ] **Step 1: Create `actions/notifications.ts`**

```ts
// app/src/app/actions/notifications.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { markRead, markAllRead } from '@/lib/server/notifications'

export async function markNotificationRead(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const service = createServiceClient()
  await markRead(service, user.id, id)
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const service = createServiceClient()
  await markAllRead(service, user.id)
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/app/actions/notifications.ts
git commit -m "feat(notifications): mark-read Server Actions"
```

---

### Task 5: Wire `insertNotification` into social actions

**Files:**
- Modify: `app/src/app/actions/social.ts`

**Interfaces:**
- Consumes: `insertNotification` from `@/lib/notifications`; `createServiceClient` from `@/lib/supabase/service`; `extractMentions` from `@/lib/notifications`
- Produces: notifications fired on `toggleLike` (like only), `addComment`, `follow`, `createPost` (trade posts + mentions)

- [ ] **Step 1: Add imports at top of `actions/social.ts`**

After the existing imports, add:

```ts
import { createServiceClient } from '@/lib/supabase/service'
import { insertNotification, extractMentions } from '@/lib/notifications'
```

- [ ] **Step 2: Wire `toggleLike` — fire notification only on like (not unlike)**

In `toggleLike`, after the upsert/delete block and before the count fetch, add:

```ts
  // fire notification only when liking (not unliking)
  if (!existing) {
    const { data: post } = await supabase.from('posts').select('author_id').eq('id', postId).maybeSingle()
    if (post?.author_id) {
      const service = createServiceClient()
      await insertNotification({ supabase: service, userId: post.author_id, actorId: user.id, type: 'like', entityId: postId, entityType: 'post' })
    }
  }
```

- [ ] **Step 3: Wire `addComment` — notify post author + mention scan**

In `addComment`, after the successful comment insert (`if (error) { ... return ... }`), add:

```ts
  // notify post author
  const { data: post } = await supabase.from('posts').select('author_id').eq('id', postId).maybeSingle()
  const service = createServiceClient()
  if (post?.author_id) {
    await insertNotification({ supabase: service, userId: post.author_id, actorId: user.id, type: 'comment', entityId: postId, entityType: 'post' })
  }
  // notify @mentions
  const mentionedUsernames = extractMentions(text)
  if (mentionedUsernames.length > 0) {
    const { data: mentionedProfiles } = await supabase
      .from('profiles').select('id').in('username', mentionedUsernames)
    for (const p of mentionedProfiles ?? []) {
      await insertNotification({ supabase: service, userId: p.id, actorId: user.id, type: 'mention', entityId: postId, entityType: 'post' })
    }
  }
```

- [ ] **Step 4: Wire `follow` — notify followed user**

In `follow`, after the upsert succeeds (before `revalidatePath`), add:

```ts
  const service = createServiceClient()
  await insertNotification({ supabase: service, userId: targetId, actorId: user.id, type: 'follow' })
```

- [ ] **Step 5: Wire `createPost` — post_share fanout + mention scan**

In `createPost`, after the post insert succeeds and after the poll options block (before `revalidatePath`), add:

```ts
  const service = createServiceClient()

  // post_share: notify followers only for trade-share posts
  if (type === 'trade') {
    const { data: followers } = await supabase
      .from('follows').select('follower_id').eq('following_id', user.id)
    for (const f of followers ?? []) {
      await insertNotification({ supabase: service, userId: f.follower_id, actorId: user.id, type: 'post_share', entityId: post.id, entityType: 'post' })
    }
  }

  // mention scan for all post types
  const mentionedUsernames = extractMentions(body)
  if (mentionedUsernames.length > 0) {
    const { data: mentionedProfiles } = await supabase
      .from('profiles').select('id').in('username', mentionedUsernames)
    for (const p of mentionedProfiles ?? []) {
      await insertNotification({ supabase: service, userId: p.id, actorId: user.id, type: 'mention', entityId: post.id, entityType: 'post' })
    }
  }
```

- [ ] **Step 6: Commit**

```bash
git add app/src/app/actions/social.ts
git commit -m "feat(notifications): wire insertNotification into social actions"
```

---

### Task 6: `useNotifications` hook

**Files:**
- Create: `app/src/app/hooks/useNotifications.ts`

**Interfaces:**
- Consumes:
  - `Notification` type from `@/lib/server/notifications`
  - `markNotificationRead`, `markAllNotificationsRead` from `@/app/actions/notifications`
  - `createClient` from `@/lib/supabase/client`
- Produces:
  ```ts
  export function useNotifications(initial: { count: number; items: Notification[] }): {
    unreadCount: number
    notifications: Notification[]
    markRead: (id: string) => void
    markAllRead: () => void
  }
  ```

- [ ] **Step 1: Create `app/src/app/hooks/` directory and file**

```ts
// app/src/app/hooks/useNotifications.ts
'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { markNotificationRead, markAllNotificationsRead } from '@/app/actions/notifications'
import type { Notification } from '@/lib/server/notifications'

export function useNotifications(initial: { count: number; items: Notification[] }) {
  const [notifications, setNotifications] = useState<Notification[]>(initial.items)
  const [unreadCount, setUnreadCount] = useState(initial.count)

  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return
      const userId = session.user.id
      const channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          (payload) => {
            const row = payload.new as Record<string, unknown>
            const newNotif: Notification = {
              id: row.id as string,
              actorId: row.actor_id as string,
              actorUsername: '',   // will be enriched by full fetch; acceptable for badge count
              actorAvatarUrl: null,
              type: row.type as Notification['type'],
              entityId: (row.entity_id as string) ?? null,
              entityType: (row.entity_type as Notification['entityType']) ?? null,
              read: false,
              createdAt: row.created_at as string,
            }
            setNotifications((prev) => [newNotif, ...prev].slice(0, 20))
            setUnreadCount((c) => c + 1)
          },
        )
        .subscribe()

      return () => { supabase.removeChannel(channel) }
    })
    return () => { authSub.unsubscribe() }
  }, [])

  const markRead = useCallback(async (id: string) => {
    await markNotificationRead(id)
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n))
    setUnreadCount((c) => Math.max(0, c - 1))
  }, [])

  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead()
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
  }, [])

  return { unreadCount, notifications, markRead, markAllRead }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/app/hooks/useNotifications.ts
git commit -m "feat(notifications): useNotifications realtime hook"
```

---

### Task 7: `NotificationBell` client component

**Files:**
- Create: `app/src/app/_components/NotificationBell.tsx`

**Interfaces:**
- Consumes:
  - `useNotifications` from `@/app/hooks/useNotifications`
  - `Notification` type from `@/lib/server/notifications`
  - Props: `initialCount: number`, `initialItems: Notification[]`
- Produces: exported `NotificationBell` React component

- [ ] **Step 1: Create `NotificationBell.tsx`**

```tsx
// app/src/app/_components/NotificationBell.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useNotifications } from '@/app/hooks/useNotifications'
import type { Notification } from '@/lib/server/notifications'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function notifText(n: Notification): string {
  switch (n.type) {
    case 'like':       return `@${n.actorUsername} liked your post`
    case 'comment':    return `@${n.actorUsername} commented on your post`
    case 'follow':     return `@${n.actorUsername} followed you`
    case 'post_share': return `@${n.actorUsername} shared a trade`
    case 'mention':    return `@${n.actorUsername} mentioned you`
    default:           return `@${n.actorUsername} interacted with you`
  }
}

function notifHref(n: Notification): string {
  if (n.entityType === 'post' && n.entityId) return `/feed#post-${n.entityId}`
  if (n.type === 'follow') return `/${n.actorUsername}`
  return '/'
}

export function NotificationBell({
  initialCount,
  initialItems,
}: {
  initialCount: number
  initialItems: Notification[]
}) {
  const { unreadCount, notifications, markRead, markAllRead } = useNotifications({
    count: initialCount,
    items: initialItems,
  })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    if (open) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="ts-nav-icon ts-notif-bell"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {unreadCount > 0 && (
          <span className="ts-notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="ts-notif-dropdown" role="dialog" aria-label="Notifications">
          <div className="ts-notif-header">
            <span style={{ fontWeight: 600 }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                className="ts-notif-mark-all"
                onClick={() => markAllRead()}
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="ts-notif-empty">No notifications yet</p>
          ) : (
            <ul className="ts-notif-list">
              {notifications.map((n) => (
                <li key={n.id} className={`ts-notif-row${n.read ? '' : ' ts-notif-unread'}`}>
                  <Link
                    href={notifHref(n)}
                    onClick={() => { if (!n.read) markRead(n.id); setOpen(false) }}
                    className="ts-notif-row-link"
                  >
                    <span className="ts-notif-avatar">
                      {n.actorAvatarUrl
                        ? <img src={n.actorAvatarUrl} alt="" width={28} height={28} style={{ borderRadius: '50%' }} />
                        : <span className="ts-notif-avatar-initial">{(n.actorUsername[0] ?? '?').toUpperCase()}</span>
                      }
                    </span>
                    <span className="ts-notif-body">
                      <span className="ts-notif-text">{notifText(n)}</span>
                      <span className="ts-notif-time">{relativeTime(n.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add CSS to `globals.css`**

Append to `app/src/app/globals.css`:

```css
/* Notifications */
.ts-notif-bell { position: relative; }
.ts-notif-badge {
  position: absolute; top: -4px; right: -4px;
  background: #ef4444; color: #fff;
  font-size: 10px; font-weight: 700; line-height: 1;
  padding: 2px 4px; border-radius: 9999px; min-width: 16px; text-align: center;
  pointer-events: none;
}
.ts-notif-dropdown {
  position: absolute; top: calc(100% + 8px); right: 0;
  width: 320px; max-height: 400px;
  background: var(--ts-surface, #1a1a2e); border: 1px solid var(--ts-border, #2d2d4e);
  border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.4);
  z-index: 50; overflow: hidden; display: flex; flex-direction: column;
}
.ts-notif-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-bottom: 1px solid var(--ts-border, #2d2d4e);
}
.ts-notif-mark-all {
  font-size: 12px; color: var(--ts-accent, #6c63ff);
  background: none; border: none; cursor: pointer; padding: 0;
}
.ts-notif-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
.ts-notif-row { border-bottom: 1px solid var(--ts-border, #2d2d4e); }
.ts-notif-row:last-child { border-bottom: none; }
.ts-notif-unread { background: rgba(108,99,255,.08); }
.ts-notif-row-link {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; text-decoration: none; color: inherit;
}
.ts-notif-row-link:hover { background: rgba(255,255,255,.04); }
.ts-notif-avatar { flex-shrink: 0; width: 28px; height: 28px; }
.ts-notif-avatar-initial {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--ts-accent, #6c63ff); color: #fff; font-size: 12px; font-weight: 700;
}
.ts-notif-body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.ts-notif-text { font-size: 13px; line-height: 1.4; }
.ts-notif-time { font-size: 11px; color: var(--ts-muted, #888); }
.ts-notif-empty { padding: 24px 16px; text-align: center; color: var(--ts-muted, #888); font-size: 13px; margin: 0; }
```

- [ ] **Step 3: Commit**

```bash
git add app/src/app/_components/NotificationBell.tsx app/src/app/globals.css
git commit -m "feat(notifications): NotificationBell client component + styles"
```

---

### Task 8: Wire `NotificationBell` into `AppNav`

**Files:**
- Modify: `app/src/app/_components/AppNav.tsx`

**Interfaces:**
- Consumes: `getNotifications`, `getUnreadCount` from `@/lib/server/notifications`; `NotificationBell` from `./NotificationBell`; `createServiceClient` from `@/lib/supabase/service`

- [ ] **Step 1: Add imports to `AppNav.tsx`**

After existing imports, add:

```ts
import { createServiceClient } from '@/lib/supabase/service'
import { getNotifications, getUnreadCount } from '@/lib/server/notifications'
import { NotificationBell } from './NotificationBell'
```

- [ ] **Step 2: Fetch notification data in the `AppNav` function body**

After the existing `profile`/`isPro` fetching block (still inside `if (user)`), add:

```ts
    const service = createServiceClient()
    const [initialNotifCount, initialNotifItems] = await Promise.all([
      getUnreadCount(service, user.id),
      getNotifications(service, user.id),
    ])
```

- [ ] **Step 3: Replace the static 🔔 button with `<NotificationBell>`**

Replace:

```tsx
<button type="button" className="ts-nav-icon" title="Notifications — soon" aria-label="Notifications">🔔</button>
```

With:

```tsx
<NotificationBell initialCount={initialNotifCount} initialItems={initialNotifItems} />
```

- [ ] **Step 4: Commit**

```bash
git add app/src/app/_components/AppNav.tsx
git commit -m "feat(notifications): wire NotificationBell into AppNav"
```

---

### Task 9: Unit tests (remaining)

**Files:**
- Modify: `app/tests/unit/notifications.test.ts`

**Interfaces:**
- Consumes: `insertNotification` from `@/lib/notifications`

- [ ] **Step 1: Add insertNotification self-notification and dedup tests**

Append to `app/tests/unit/notifications.test.ts`:

```ts
import { insertNotification } from '@/lib/notifications'

function makeInsertSpy() {
  const inserted: unknown[] = []
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
      insert: (row: unknown) => { inserted.push(row); return Promise.resolve({ error: null }) },
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient
  return { supabase, inserted }
}

describe('insertNotification', () => {
  it('skips when actorId === userId (self-notification)', async () => {
    const { supabase, inserted } = makeInsertSpy()
    await insertNotification({ supabase, userId: 'abc', actorId: 'abc', type: 'like', entityId: 'p1', entityType: 'post' })
    expect(inserted).toHaveLength(0)
  })

  it('inserts when actorId !== userId', async () => {
    const { supabase, inserted } = makeInsertSpy()
    await insertNotification({ supabase, userId: 'user1', actorId: 'user2', type: 'like', entityId: 'p1', entityType: 'post' })
    expect(inserted).toHaveLength(1)
  })

  it('deduplicates follow notifications (existing follow notif → skip)', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: 'existing' }, error: null }),
              }),
            }),
          }),
        }),
        insert: () => { throw new Error('should not insert') },
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient
    await expect(
      insertNotification({ supabase, userId: 'user1', actorId: 'user2', type: 'follow' })
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run all unit tests**

```bash
cd app && npx vitest run tests/unit/notifications.test.ts
```

Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add app/tests/unit/notifications.test.ts
git commit -m "test(notifications): unit tests for insertNotification + extractMentions + server reads"
```

---

### Task 10: E2E tests

**Files:**
- Create: `app/tests/e2e/notifications.spec.ts`

**Interfaces:**
- Consumes: running dev server at `http://localhost:3000`; Supabase Cloud with email-confirm OFF

- [ ] **Step 1: Warm the dev server before running**

```bash
cd app && npm run dev &
# wait ~10s for compile, then run e2e
```

- [ ] **Step 2: Create `notifications.spec.ts`**

```ts
// app/tests/e2e/notifications.spec.ts
import { test, expect, type Page, type BrowserContext } from '@playwright/test'

const DOMAIN = 'notif.tradingsocial.test'

async function signUp(page: Page, prefix: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36)
  const username = `${prefix}_${stamp}`.slice(0, 20)
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@${DOMAIN}`)
  await page.fill('input[name="password"]', 'password123')
  await page.check('input[name="terms"]')
  await page.click('button:has-text("Join the Beta")')
  await expect(page).toHaveURL(/\/onboarding/)
  await page.locator('label.ts-chip', { hasText: 'forex' }).click()
  await page.fill('input[name="goal"]', 'Be consistent')
  await page.click('button:has-text("Finish")')
  await expect(page).toHaveURL('/')
  return username
}

async function logout(page: Page) {
  await page.goto('/settings')
  await page.click('button:has-text("Log out")')
  await expect(page).toHaveURL(/\/login/)
}

test('follow notification appears in bell', async ({ page }) => {
  const userA = await signUp(page)
  await logout(page)

  const userB = await signUp(page)
  // B follows A
  await page.goto(`/${userA}`)
  await page.click('button:has-text("Follow")')
  await logout(page)

  // A logs in, checks bell
  await page.goto('/login')
  await page.fill('input[name="email"]', `${userA}@${DOMAIN}`)
  await page.fill('input[name="password"]', 'password123')
  await page.click('button:has-text("Log in")')
  await expect(page).toHaveURL('/')

  await page.click('.ts-notif-bell')
  await expect(page.locator('.ts-notif-list')).toContainText(`@${userB} followed you`)
})

test('like notification appears in bell', async ({ page }) => {
  // A posts; B likes it; A sees notification
  const userA = await signUp(page)
  await page.fill('.h-composer textarea', `Like test post ${userA}`)
  await page.click('.h-composer button:has-text("Post")')
  await expect(page.locator('.h-trade').first()).toContainText(`Like test post ${userA}`)
  await logout(page)

  const userB = await signUp(page)
  await page.goto(`/${userA}`)
  // find A's post and like it
  await page.locator('.h-trade').first().locator('.h-react').first().click()
  await logout(page)

  await page.goto('/login')
  await page.fill('input[name="email"]', `${userA}@${DOMAIN}`)
  await page.fill('input[name="password"]', 'password123')
  await page.click('button:has-text("Log in")')
  await expect(page).toHaveURL('/')

  await page.click('.ts-notif-bell')
  await expect(page.locator('.ts-notif-list')).toContainText(`@${userB} liked your post`)
})

test('comment notification appears in bell', async ({ page }) => {
  const userA = await signUp(page)
  await page.fill('.h-composer textarea', `Comment test post ${userA}`)
  await page.click('.h-composer button:has-text("Post")')
  await expect(page.locator('.h-trade').first()).toContainText(`Comment test post ${userA}`)
  await logout(page)

  const userB = await signUp(page)
  await page.goto(`/${userA}`)
  const firstPost = page.locator('.h-trade').first()
  await firstPost.locator('.h-react').nth(1).click()
  await firstPost.locator('.ts-comment-add input').fill('Great setup!')
  await firstPost.locator('button:has-text("Reply")').click()
  await logout(page)

  await page.goto('/login')
  await page.fill('input[name="email"]', `${userA}@${DOMAIN}`)
  await page.fill('input[name="password"]', 'password123')
  await page.click('button:has-text("Log in")')
  await expect(page).toHaveURL('/')

  await page.click('.ts-notif-bell')
  await expect(page.locator('.ts-notif-list')).toContainText(`@${userB} commented on your post`)
})

test('mark all read clears badge', async ({ page }) => {
  const userA = await signUp(page)
  await logout(page)

  const userB = await signUp(page)
  await page.goto(`/${userA}`)
  await page.click('button:has-text("Follow")')
  await logout(page)

  await page.goto('/login')
  await page.fill('input[name="email"]', `${userA}@${DOMAIN}`)
  await page.fill('input[name="password"]', 'password123')
  await page.click('button:has-text("Log in")')
  await expect(page).toHaveURL('/')

  await expect(page.locator('.ts-notif-badge')).toBeVisible()
  await page.click('.ts-notif-bell')
  await page.click('.ts-notif-mark-all')
  await expect(page.locator('.ts-notif-badge')).not.toBeVisible()
})

test('realtime: User B bell updates when User A likes without page refresh', async ({ browser }) => {
  const ctxA: BrowserContext = await browser.newContext()
  const ctxB: BrowserContext = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  const userA = await signUp(pageA, 'rta')
  // A posts
  await pageA.fill('.h-composer textarea', `RT post ${userA}`)
  await pageA.click('.h-composer button:has-text("Post")')
  await expect(pageA.locator('.h-trade').first()).toContainText(`RT post ${userA}`)

  // B signs up and logs in (separate context)
  const stamp = Date.now().toString(36)
  const userB = `rtb_${stamp}`.slice(0, 20)
  await pageB.goto('/signup')
  await pageB.fill('input[name="username"]', userB)
  await pageB.fill('input[name="email"]', `${userB}@${DOMAIN}`)
  await pageB.fill('input[name="password"]', 'password123')
  await pageB.check('input[name="terms"]')
  await pageB.click('button:has-text("Join the Beta")')
  await expect(pageB).toHaveURL(/\/onboarding/)
  await pageB.locator('label.ts-chip', { hasText: 'forex' }).click()
  await pageB.fill('input[name="goal"]', 'Be consistent')
  await pageB.click('button:has-text("Finish")')
  await expect(pageB).toHaveURL('/')

  // A navigates to B's profile and follows B (to get B's post in feed) — actually A just navigates to find B
  // Simpler: A likes their own post is self-notif (skipped), so go via B liking A's post
  // B goes to A's profile and likes their post — A's bell updates in pageA
  await pageB.goto(`/${userA}`)
  // wait for feed to load
  await pageB.waitForSelector('.h-trade')
  await pageB.locator('.h-trade').first().locator('.h-react').first().click()

  // A's bell badge should appear without refresh (realtime)
  await expect(pageA.locator('.ts-notif-badge')).toBeVisible({ timeout: 10000 })

  await ctxA.close()
  await ctxB.close()
})
```

- [ ] **Step 3: Run E2E tests**

```bash
cd app && npx playwright test tests/e2e/notifications.spec.ts
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add app/tests/e2e/notifications.spec.ts
git commit -m "test(notifications): e2e — follow/like/comment/realtime notifications"
```

---

### Task 11: Final merge to main

- [ ] **Step 1: Run full unit suite**

```bash
cd app && npx vitest run
```

Expected: all PASS

- [ ] **Step 2: Run full E2E suite**

```bash
cd app && npx playwright test
```

Expected: all PASS (or pre-existing failures only)

- [ ] **Step 3: Merge feature branch to main**

```bash
git checkout main
git merge --no-ff phase9a-notifications -m "Merge phase9a-notifications: in-app realtime notifications"
```

- [ ] **Step 4: Push**

```bash
git push
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Migration 0010 + RLS | Task 1 |
| `insertNotification` + self-notif guard | Task 2 |
| `extractMentions` | Task 2 |
| `getNotifications`, `getUnreadCount`, `markAllRead`, `markRead` | Task 3 |
| Server Actions mark-read | Task 4 |
| `toggleLike` → like notif | Task 5 |
| `addComment` → comment notif + mention scan | Task 5 |
| `follow` → follow notif | Task 5 |
| `createPost` → post_share (trade only) + mention scan | Task 5 |
| `useNotifications` hook + Realtime | Task 6 |
| Bell icon + badge + dropdown | Task 7 |
| Close on outside click / Escape | Task 7 |
| Mark all read button | Task 7 |
| Empty state | Task 7 |
| Wire into AppNav server-side initial count | Task 8 |
| Unit tests | Tasks 2, 3, 9 |
| E2E tests incl. realtime two-context | Task 10 |

**Deferred (per spec):** `reply` type (needs threaded comments first), email digest, browser push, `/settings/notifications`, pagination beyond 20.

**Placeholder scan:** None found.

**Type consistency:** `Notification` type defined once in `lib/server/notifications.ts`, imported everywhere it's used. `NotificationType` defined in `lib/notifications.ts`, re-used in server file.
