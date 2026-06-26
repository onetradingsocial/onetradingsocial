# Messaging (Direct Messages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private 1-on-1 direct messaging (text + images + trade-share) with Realtime delivery, unread badge, read receipts, and typing indicators, on a dedicated `/messages` page.

**Architecture:** The established 4-layer per-feature pattern — pure `lib/messaging.ts` (unit-tested, no I/O) → server-only `lib/server/messaging.ts` (data access) → `actions/messaging.ts` (`getUser` auth + service-role writes) → client hooks + components. Realtime via Postgres `postgres_changes` on the `messages` table (same as Phase 9a notifications); typing indicators ride a separate ephemeral Realtime broadcast channel (no DB writes).

**Tech Stack:** Next.js (App Router, TS), `@supabase/ssr` + `@supabase/supabase-js`, Supabase Postgres + RLS + Realtime + Storage, vitest (unit), Playwright (e2e). Spec: `docs/superpowers/specs/2026-06-26-messaging-dms-design.md`.

## Global Constraints

- Repo root is the static marketing site; the app lives in `app/`. All paths below are relative to `app/` unless absolute. Source under `app/src/`.
- App routes are at ROOT (`/messages`), NOT `/app/*` (basePath dropped in commit 7cebe4a). e2e must use root paths.
- Server actions / route handlers / mutations use `supabase.auth.getUser()` (authoritative). Server-component READS use `getSessionUser(supabase)` (`getClaims`, local verify). Never mix.
- All `messages`/`conversations` WRITES go through the service-role client (`createServiceClient()` from `@/lib/supabase/service`). The tables have NO insert/update/delete RLS policy — service-role only. Mirrors notifications/subscriptions.
- Mutual-follow is re-checked server-side on every `sendMessage`, fail closed. Never trusted from the client.
- PostgREST has NO `.offset()` method — use `.range(from, to)`. (Phase 9a bug.)
- Realtime channel must be captured in the outer effect scope and removed on unmount (Phase 9a pattern).
- `getUnreadTotal` / unread counts FAIL TO 0 on error (never throw into nav render).
- Signup usernames in e2e must stay ≤20 chars (short prefix + base36 stamp).
- Migration 0012 must be APPLIED to Supabase Cloud via MCP `apply_migration` (this is a build-time action by the implementer with MCP access, not committed-and-forgotten). Add `messages` to the `supabase_realtime` publication.
- Reuse existing CSS tokens only — `--violet #7C5CE6`, `--violet-deep #5530C8`, `--brand-grad`, `--brand-grad-soft`, `--surface-2`, `--border-vio`, `--faint`. New classes use the `ts-msg-*` convention in `globals.css`. No new color system.
- Image attachments: ≤4 per message, content-type `image/png` or `image/jpeg` only. Trade attachments: ≤1 per message. A message must have a non-empty body OR ≥1 attachment.
- Free for all tiers — do NOT add `messaging` to `FEATURE_MIN_TIER`.
- Branch: `phase10-messaging`. Merge no-ff to main at the end. Pushing requires explicit user authorization.

---

## File Structure

**Create:**
- `app/supabase/migrations/0012_messaging.sql` — schema, RLS, realtime publication, notifications type/entity extension.
- `app/src/lib/messaging.ts` — pure helpers + types.
- `app/src/lib/server/messaging.ts` — server-only data access.
- `app/src/app/actions/messaging.ts` — server actions.
- `app/src/app/api/message-image-url/route.ts` — signed image upload URL.
- `app/src/app/hooks/useConversation.ts` — Realtime thread hook.
- `app/src/app/hooks/useTyping.ts` — broadcast typing hook.
- `app/src/app/hooks/useUnreadMessages.ts` — nav badge hook.
- `app/src/app/messages/page.tsx` — server shell (inbox + optional `?to=`/`?c=` deep link).
- `app/src/app/messages/MessagesClient.tsx` — top-level client island (two-pane state).
- `app/src/app/messages/_components/ConversationList.tsx`
- `app/src/app/messages/_components/ConversationRow.tsx`
- `app/src/app/messages/_components/MessageThread.tsx`
- `app/src/app/messages/_components/MessageBubble.tsx`
- `app/src/app/messages/_components/MessageComposer.tsx`
- `app/src/app/messages/_components/TypingIndicator.tsx`
- `app/src/app/_components/MessagesBell.tsx` — nav ✉ icon + live unread badge.
- `app/tests/unit/messaging.test.ts` — vitest.
- `app/tests/e2e/messaging.spec.ts` — Playwright.

**Modify:**
- `app/src/lib/notifications.ts` — add `'message'` to `NotificationType`.
- `app/src/lib/storage.ts` — add `messageImageKey` / `messageImagePublicUrl` / `signMessageImageUpload`.
- `app/src/lib/server/notifications.ts` — extend `Notification.entityType` to include `'conversation'`.
- `app/src/app/_components/NotificationBell.tsx` — handle `'message'` type text + href.
- `app/src/app/_components/AppNav.tsx` — replace the placeholder `✉` button with `<MessagesBell>`; fetch initial unread total.
- `app/src/app/[username]/page.tsx` — add "Message" button (mutual-follow only).
- `app/src/app/globals.css` — `ts-msg-*` styles.

---

## Task 1: Migration 0012 — schema, RLS, realtime, notification extension

**Files:**
- Create: `app/supabase/migrations/0012_messaging.sql`

**Interfaces:**
- Produces: tables `conversations(id, user_a, user_b, created_at, last_message_at)` and `messages(id, conversation_id, sender_id, body, attachments, read_at, created_at, deleted_at)`; `notifications.type` now allows `'message'`; `notifications.entity_type` now allows `'conversation'`.

- [ ] **Step 1: Write the migration SQL**

Create `app/supabase/migrations/0012_messaging.sql`:

```sql
-- conversations: one row per unordered user pair, stored in canonical (a<b) order
create table conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references profiles(id) on delete cascade,
  user_b          uuid not null references profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);
create index conversations_user_a_last on conversations (user_a, last_message_at desc);
create index conversations_user_b_last on conversations (user_b, last_message_at desc);

alter table conversations enable row level security;

-- participants may read their conversations; writes are service-role only (no write policy)
create policy "participant select" on conversations
  for select using (auth.uid() = user_a or auth.uid() = user_b);

-- messages
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid not null references profiles(id) on delete cascade,
  body            text,
  attachments     jsonb not null default '[]'::jsonb,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  check (body is not null or jsonb_array_length(attachments) > 0)
);
create index messages_conversation_created on messages (conversation_id, created_at desc);

alter table messages enable row level security;

-- participants of the parent conversation may read; writes are service-role only
create policy "participant select" on messages
  for select using (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and (auth.uid() = c.user_a or auth.uid() = c.user_b)
    )
  );

-- enable realtime for live delivery + read receipts
alter publication supabase_realtime add table messages;

-- extend notifications to support direct-message alerts
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('like','comment','follow','post_share','mention','message'));
alter table notifications drop constraint notifications_entity_type_check;
alter table notifications add constraint notifications_entity_type_check
  check (entity_type in ('post','comment','trade','conversation'));
```

> NOTE: The two notification constraints are named `notifications_type_check` and `notifications_entity_type_check` by Postgres auto-naming (column-level `check` on a single column in 0010). If `apply_migration` reports a different constraint name, query `select conname from pg_constraint where conrelid='notifications'::regclass and contype='c'` and substitute the actual names.

- [ ] **Step 2: Apply to Supabase Cloud via MCP**

Use the MCP tool `apply_migration` with name `0012_messaging` and the SQL above. Then verify:

Run (MCP `execute_sql`):
```sql
select table_name from information_schema.tables where table_name in ('conversations','messages');
select conname from pg_constraint where conrelid='notifications'::regclass and contype='c';
```
Expected: both tables present; a type check that includes `'message'` and an entity check that includes `'conversation'`.

- [ ] **Step 3: Verify realtime publication**

Run (MCP `execute_sql`):
```sql
select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='messages';
```
Expected: one row (`messages`).

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0012_messaging.sql
git commit -m "feat(messaging): migration 0012 — conversations + messages tables, RLS, realtime"
```

---

## Task 2: Pure `lib/messaging.ts`

**Files:**
- Create: `app/src/lib/messaging.ts`
- Test: `app/tests/unit/messaging.test.ts`
- Modify: `app/src/lib/notifications.ts`

**Interfaces:**
- Produces:
  - `type ImageAttachment = { type: 'image'; url: string }`
  - `type TradeAttachment = { type: 'trade'; tradeId: string }`
  - `type Attachment = ImageAttachment | TradeAttachment`
  - `interface Message { id; conversationId; senderId; body: string | null; attachments: Attachment[]; readAt: string | null; createdAt: string; deletedAt: string | null }`
  - `interface ConversationListItem { conversationId; other: { id; username; displayName: string | null; avatarUrl: string | null }; lastMessageAt: string; preview: string; unreadCount: number }`
  - `orderPair(id1: string, id2: string): { userA: string; userB: string }`
  - `canMessage(aFollowsB: boolean, bFollowsA: boolean): boolean`
  - `validateAttachments(atts: Attachment[]): { ok: true } | { ok: false; error: string }`
  - `summarizePreview(m: { body: string | null; attachments: Attachment[]; deletedAt: string | null }): string`

- [ ] **Step 1: Write the failing tests**

Create `app/tests/unit/messaging.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { orderPair, canMessage, validateAttachments, summarizePreview, type Attachment } from '@/lib/messaging'

describe('orderPair', () => {
  it('returns the same canonical order regardless of argument order', () => {
    const a = orderPair('aaa', 'bbb')
    const b = orderPair('bbb', 'aaa')
    expect(a).toEqual(b)
    expect(a.userA < a.userB).toBe(true)
  })
})

describe('canMessage', () => {
  it('allows when both follow each other', () => {
    expect(canMessage(true, true)).toBe(true)
  })
  it('blocks one-way follows', () => {
    expect(canMessage(true, false)).toBe(false)
    expect(canMessage(false, true)).toBe(false)
  })
  it('blocks strangers', () => {
    expect(canMessage(false, false)).toBe(false)
  })
})

describe('validateAttachments', () => {
  const img: Attachment = { type: 'image', url: 'https://x/1.png' }
  const trade: Attachment = { type: 'trade', tradeId: 't1' }
  it('accepts up to 4 images', () => {
    expect(validateAttachments([img, img, img, img]).ok).toBe(true)
  })
  it('rejects more than 4 images', () => {
    expect(validateAttachments([img, img, img, img, img]).ok).toBe(false)
  })
  it('accepts a single trade', () => {
    expect(validateAttachments([trade]).ok).toBe(true)
  })
  it('rejects more than one trade', () => {
    expect(validateAttachments([trade, trade]).ok).toBe(false)
  })
  it('accepts an empty attachment list', () => {
    expect(validateAttachments([]).ok).toBe(true)
  })
})

describe('summarizePreview', () => {
  it('shows body text when present', () => {
    expect(summarizePreview({ body: 'hello there', attachments: [], deletedAt: null })).toBe('hello there')
  })
  it('labels image-only messages', () => {
    expect(summarizePreview({ body: null, attachments: [{ type: 'image', url: 'x' }], deletedAt: null })).toBe('📷 Photo')
  })
  it('labels trade-only messages', () => {
    expect(summarizePreview({ body: null, attachments: [{ type: 'trade', tradeId: 't' }], deletedAt: null })).toBe('📈 Shared a trade')
  })
  it('shows a placeholder for deleted messages', () => {
    expect(summarizePreview({ body: 'hi', attachments: [], deletedAt: '2026-06-26T00:00:00Z' })).toBe('Message deleted')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/messaging.test.ts`
Expected: FAIL — cannot resolve `@/lib/messaging`.

- [ ] **Step 3: Implement `lib/messaging.ts`**

Create `app/src/lib/messaging.ts`:

```ts
export type ImageAttachment = { type: 'image'; url: string }
export type TradeAttachment = { type: 'trade'; tradeId: string }
export type Attachment = ImageAttachment | TradeAttachment

export interface Message {
  id: string
  conversationId: string
  senderId: string
  body: string | null
  attachments: Attachment[]
  readAt: string | null
  createdAt: string
  deletedAt: string | null
}

export interface ConversationListItem {
  conversationId: string
  other: { id: string; username: string; displayName: string | null; avatarUrl: string | null }
  lastMessageAt: string
  preview: string
  unreadCount: number
}

export function orderPair(id1: string, id2: string): { userA: string; userB: string } {
  return id1 < id2 ? { userA: id1, userB: id2 } : { userA: id2, userB: id1 }
}

export function canMessage(aFollowsB: boolean, bFollowsA: boolean): boolean {
  return aFollowsB && bFollowsA
}

export function validateAttachments(atts: Attachment[]): { ok: true } | { ok: false; error: string } {
  const images = atts.filter((a) => a.type === 'image')
  const trades = atts.filter((a) => a.type === 'trade')
  if (images.length > 4) return { ok: false, error: 'Up to 4 images per message.' }
  if (trades.length > 1) return { ok: false, error: 'Only one trade per message.' }
  return { ok: true }
}

export function summarizePreview(m: { body: string | null; attachments: Attachment[]; deletedAt: string | null }): string {
  if (m.deletedAt) return 'Message deleted'
  if (m.body && m.body.trim()) return m.body.trim()
  if (m.attachments.some((a) => a.type === 'trade')) return '📈 Shared a trade'
  if (m.attachments.some((a) => a.type === 'image')) return '📷 Photo'
  return ''
}
```

- [ ] **Step 4: Add `'message'` to the notification type union**

In `app/src/lib/notifications.ts`, change:

```ts
export type NotificationType = 'like' | 'comment' | 'follow' | 'post_share' | 'mention'
```
to:
```ts
export type NotificationType = 'like' | 'comment' | 'follow' | 'post_share' | 'mention' | 'message'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/messaging.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/messaging.ts app/tests/unit/messaging.test.ts app/src/lib/notifications.ts
git commit -m "feat(messaging): pure helpers + types, message notification type"
```

---

## Task 3: Server data access `lib/server/messaging.ts`

**Files:**
- Create: `app/src/lib/server/messaging.ts`
- Modify: `app/src/lib/server/notifications.ts`

**Interfaces:**
- Consumes: `orderPair`, `summarizePreview`, types from `@/lib/messaging`; `createServiceClient`.
- Produces (all server-only):
  - `areMutualFollowers(supabase: SupabaseClient, a: string, b: string): Promise<boolean>`
  - `getOrCreateConversation(service: SupabaseClient, id1: string, id2: string): Promise<string>` (returns conversation id)
  - `getConversations(supabase: SupabaseClient, userId: string): Promise<ConversationListItem[]>`
  - `getMessages(supabase: SupabaseClient, conversationId: string, userId: string, opts?: { before?: string; limit?: number }): Promise<Message[]>` (ascending by createdAt; returns `[]` if viewer not a participant)
  - `getUnreadTotal(supabase: SupabaseClient, userId: string): Promise<number>` (fails to 0)
  - `getConversationPeer(supabase: SupabaseClient, conversationId: string, userId: string): Promise<{ id; username; displayName: string | null; avatarUrl: string | null } | null>`

- [ ] **Step 1: Extend the Notification entityType**

In `app/src/lib/server/notifications.ts`, change every occurrence of the entity-type union from:
```ts
entityType: 'post' | 'comment' | 'trade' | null
```
to:
```ts
entityType: 'post' | 'comment' | 'trade' | 'conversation' | null
```
(There are two: the `Notification` type field and the cast in `.map`.)

- [ ] **Step 2: Implement `lib/server/messaging.ts`**

Create `app/src/lib/server/messaging.ts`:

```ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { orderPair, summarizePreview, type Attachment, type Message, type ConversationListItem } from '@/lib/messaging'

type ProfileLite = { id: string; username: string; display_name: string | null; avatar_url: string | null }

function normProfile(p: unknown): ProfileLite | null {
  const row = (Array.isArray(p) ? p[0] : p) as ProfileLite | null
  return row ?? null
}

export async function areMutualFollowers(supabase: SupabaseClient, a: string, b: string): Promise<boolean> {
  const { data } = await supabase
    .from('follows')
    .select('follower_id, following_id')
    .or(`and(follower_id.eq.${a},following_id.eq.${b}),and(follower_id.eq.${b},following_id.eq.${a})`)
  const rows = data ?? []
  const aFollowsB = rows.some((r) => r.follower_id === a && r.following_id === b)
  const bFollowsA = rows.some((r) => r.follower_id === b && r.following_id === a)
  return aFollowsB && bFollowsA
}

export async function getOrCreateConversation(service: SupabaseClient, id1: string, id2: string): Promise<string> {
  const { userA, userB } = orderPair(id1, id2)
  const { data: existing } = await service
    .from('conversations').select('id').eq('user_a', userA).eq('user_b', userB).maybeSingle()
  if (existing) return existing.id as string
  const { data: created, error } = await service
    .from('conversations').insert({ user_a: userA, user_b: userB }).select('id').single()
  if (error || !created) {
    // race: another insert won; re-read
    const { data: row } = await service
      .from('conversations').select('id').eq('user_a', userA).eq('user_b', userB).single()
    return row!.id as string
  }
  return created.id as string
}

export async function getConversations(supabase: SupabaseClient, userId: string): Promise<ConversationListItem[]> {
  const { data: convos } = await supabase
    .from('conversations')
    .select('id, user_a, user_b, last_message_at, a:profiles!conversations_user_a_fkey(id,username,display_name,avatar_url), b:profiles!conversations_user_b_fkey(id,username,display_name,avatar_url)')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order('last_message_at', { ascending: false })
    .range(0, 49)
  const list = convos ?? []

  const items: ConversationListItem[] = []
  for (const c of list) {
    const other = c.user_a === userId ? normProfile(c.b) : normProfile(c.a)
    if (!other) continue
    const { data: lastRows } = await supabase
      .from('messages')
      .select('body, attachments, deleted_at')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .range(0, 0)
    const last = lastRows?.[0]
    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', c.id)
      .neq('sender_id', userId)
      .is('read_at', null)
    items.push({
      conversationId: c.id,
      other: { id: other.id, username: other.username, displayName: other.display_name, avatarUrl: other.avatar_url },
      lastMessageAt: c.last_message_at,
      preview: last ? summarizePreview({ body: last.body, attachments: (last.attachments ?? []) as Attachment[], deletedAt: last.deleted_at }) : '',
      unreadCount: count ?? 0,
    })
  }
  return items
}

export async function getMessages(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<Message[]> {
  const { before, limit = 50 } = opts
  // participant guard (RLS also enforces, but fail fast + empty)
  const { data: convo } = await supabase
    .from('conversations').select('user_a, user_b').eq('id', conversationId).maybeSingle()
  if (!convo || (convo.user_a !== userId && convo.user_b !== userId)) return []

  let q = supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, attachments, read_at, created_at, deleted_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .range(0, limit - 1)
  if (before) q = q.lt('created_at', before)
  const { data } = await q
  const rows = (data ?? []).map((r): Message => ({
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    body: r.body ?? null,
    attachments: (r.attachments ?? []) as Attachment[],
    readAt: r.read_at ?? null,
    createdAt: r.created_at,
    deletedAt: r.deleted_at ?? null,
  }))
  return rows.reverse() // ascending for display
}

export async function getUnreadTotal(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data: convos, error: cErr } = await supabase
    .from('conversations').select('id').or(`user_a.eq.${userId},user_b.eq.${userId}`)
  if (cErr || !convos || convos.length === 0) return 0
  const ids = convos.map((c) => c.id)
  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .in('conversation_id', ids)
    .neq('sender_id', userId)
    .is('read_at', null)
  if (error) return 0
  return count ?? 0
}

export async function getConversationPeer(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<{ id: string; username: string; displayName: string | null; avatarUrl: string | null } | null> {
  const { data: c } = await supabase
    .from('conversations')
    .select('user_a, user_b, a:profiles!conversations_user_a_fkey(id,username,display_name,avatar_url), b:profiles!conversations_user_b_fkey(id,username,display_name,avatar_url)')
    .eq('id', conversationId).maybeSingle()
  if (!c || (c.user_a !== userId && c.user_b !== userId)) return null
  const other = c.user_a === userId ? normProfile(c.b) : normProfile(c.a)
  if (!other) return null
  return { id: other.id, username: other.username, displayName: other.display_name, avatarUrl: other.avatar_url }
}
```

> NOTE on FK alias names: the embeds use `conversations_user_a_fkey` / `conversations_user_b_fkey`. These are Postgres auto-named from Task 1's `references profiles(id)`. If PostgREST errors with "could not find relationship", run `select conname from pg_constraint where conrelid='conversations'::regclass and contype='f'` and substitute the actual FK names.

- [ ] **Step 3: Type-check**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/server/messaging.ts app/src/lib/server/notifications.ts
git commit -m "feat(messaging): server data access — conversations, messages, mutual-follow, unread"
```

---

## Task 4: Server actions `actions/messaging.ts`

**Files:**
- Create: `app/src/app/actions/messaging.ts`

**Interfaces:**
- Consumes: `validateAttachments`, types from `@/lib/messaging`; `areMutualFollowers`, `getOrCreateConversation` from `@/lib/server/messaging`; `insertNotification` from `@/lib/notifications`; `createClient` (server), `createServiceClient`.
- Produces:
  - `sendMessage(recipientId: string, body: string, attachments: Attachment[]): Promise<{ messageId?: string; conversationId?: string; error?: string }>`
  - `markThreadRead(conversationId: string): Promise<void>`
  - `deleteMessage(messageId: string): Promise<void>`

- [ ] **Step 1: Implement `actions/messaging.ts`**

Create `app/src/app/actions/messaging.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { validateAttachments, type Attachment } from '@/lib/messaging'
import { areMutualFollowers, getOrCreateConversation } from '@/lib/server/messaging'
import { insertNotification } from '@/lib/notifications'

export async function sendMessage(
  recipientId: string,
  body: string,
  attachments: Attachment[] = [],
): Promise<{ messageId?: string; conversationId?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (recipientId === user.id) return { error: 'You cannot message yourself.' }

  const text = (body ?? '').trim()
  const atts = Array.isArray(attachments) ? attachments : []
  if (!text && atts.length === 0) return { error: 'Write a message first.' }
  if (text.length > 4000) return { error: 'Message is too long (4000 max).' }
  const v = validateAttachments(atts)
  if (!v.ok) return { error: v.error }

  // mutual-follow gate — re-checked every send, fail closed
  const mutual = await areMutualFollowers(supabase, user.id, recipientId)
  if (!mutual) return { error: 'You can only message people who follow you back.' }

  // validate any trade attachment belongs to the sender
  const tradeAtt = atts.find((a) => a.type === 'trade')
  if (tradeAtt && tradeAtt.type === 'trade') {
    const { data: t } = await supabase.from('trades').select('user_id').eq('id', tradeAtt.tradeId).single()
    if (!t || t.user_id !== user.id) return { error: 'Trade not found.' }
  }

  const service = createServiceClient()
  const conversationId = await getOrCreateConversation(service, user.id, recipientId)

  const { data: msg, error } = await service.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: text || null,
    attachments: atts,
  }).select('id').single()
  if (error || !msg) return { error: 'Could not send message.' }

  await service.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)

  await insertNotification({
    supabase: service, userId: recipientId, actorId: user.id,
    type: 'message', entityId: conversationId, entityType: 'conversation',
  })

  return { messageId: msg.id, conversationId }
}

export async function markThreadRead(conversationId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  // confirm participant
  const { data: c } = await supabase
    .from('conversations').select('user_a, user_b').eq('id', conversationId).maybeSingle()
  if (!c || (c.user_a !== user.id && c.user_b !== user.id)) return
  const service = createServiceClient()
  await service.from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', user.id)
    .is('read_at', null)
}

export async function deleteMessage(messageId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const service = createServiceClient()
  // own message only
  await service.from('messages')
    .update({ deleted_at: new Date().toISOString(), body: null, attachments: [] })
    .eq('id', messageId)
    .eq('sender_id', user.id)
}
```

> NOTE: `insertNotification` already guards `actorId === userId` (no self-notify) and only special-cases `'follow'` dedup; a `'message'` notification inserts on every send. That is acceptable for v1 (each DM is a real alert). If this proves noisy later, add per-conversation dedup in a follow-up — out of scope here.

- [ ] **Step 2: Type-check**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/actions/messaging.ts
git commit -m "feat(messaging): server actions — sendMessage (mutual-follow gate), markThreadRead, deleteMessage"
```

---

## Task 5: Image upload — storage helper + signed-URL route

**Files:**
- Modify: `app/src/lib/storage.ts`
- Create: `app/src/app/api/message-image-url/route.ts`

**Interfaces:**
- Consumes: existing `BUCKET`, `createServiceClient` already in `storage.ts`.
- Produces:
  - `messageImagePublicUrl(userId: string, draftId: string, idx: number, contentType: string): string`
  - `signMessageImageUpload(userId: string, draftId: string, idx: number, contentType: string): Promise<{ path; token } | { error: string }>`
  - Route `GET /api/message-image-url?draftId=<uuid>&idx=<0-3>&ct=image/png|image/jpeg` → `{ path, token, publicUrl }`

- [ ] **Step 1: Add storage helpers**

In `app/src/lib/storage.ts`, after the post-image functions, add (mirror the existing `postImage*` block, including a private `messageImageKey` matching the file's `*Key` convention):

```ts
function messageImageKey(userId: string, draftId: string, idx: number, contentType: string) {
  const ext = contentType === 'image/png' ? 'png' : 'jpg'
  return `messages/${userId}/${draftId}/${idx}.${ext}`
}

export function messageImagePublicUrl(userId: string, draftId: string, idx: number, contentType: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${messageImageKey(userId, draftId, idx, contentType)}`
}

export async function signMessageImageUpload(userId: string, draftId: string, idx: number, contentType: string) {
  const path = messageImageKey(userId, draftId, idx, contentType)
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return { error: 'Could not create upload URL.' as const }
  return { path: data.path, token: data.token }
}
```

> If `storage.ts` defines `postImageKey` differently (e.g. inline in `postImagePublicUrl`), match that file's actual style; the key string `messages/<userId>/<draftId>/<idx>.<ext>` is the requirement. The `<userId>` prefix scopes writes to the authenticated user — a user can never write under another user's prefix.

- [ ] **Step 2: Implement the route**

Create `app/src/app/api/message-image-url/route.ts` (mirror `app/src/app/api/post-image-url/route.ts`):

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signMessageImageUpload, messageImagePublicUrl } from '@/lib/storage'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const draftId = searchParams.get('draftId')
  const idx = Number(searchParams.get('idx'))
  const ct = searchParams.get('ct')
  if (!draftId || !UUID_RE.test(draftId) || !Number.isInteger(idx) || idx < 0 || idx > 3 || (ct !== 'image/png' && ct !== 'image/jpeg')) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const signed = await signMessageImageUpload(user.id, draftId, idx, ct)
  if ('error' in signed) return NextResponse.json({ error: signed.error }, { status: 500 })
  return NextResponse.json({ ...signed, publicUrl: messageImagePublicUrl(user.id, draftId, idx, ct) })
}
```

- [ ] **Step 3: Type-check**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/storage.ts app/src/app/api/message-image-url/route.ts
git commit -m "feat(messaging): signed image upload route + storage helper"
```

---

## Task 6: Client hooks — `useConversation`, `useTyping`, `useUnreadMessages`

**Files:**
- Create: `app/src/app/hooks/useConversation.ts`
- Create: `app/src/app/hooks/useTyping.ts`
- Create: `app/src/app/hooks/useUnreadMessages.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/client`; `sendMessage`, `markThreadRead` from `@/app/actions/messaging`; `Message`, `Attachment` from `@/lib/messaging`.
- Produces:
  - `useConversation(conversationId: string, currentUserId: string, initial: Message[]): { messages: Message[]; send: (body: string, attachments: Attachment[], recipientId: string) => Promise<{ error?: string }> }`
  - `useTyping(conversationId: string, currentUserId: string): { peerTyping: boolean; notifyTyping: () => void }`
  - `useUnreadMessages(initialCount: number): { unreadCount: number }`

- [ ] **Step 1: Implement `useConversation.ts`**

Create `app/src/app/hooks/useConversation.ts`:

```ts
'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sendMessage, markThreadRead } from '@/app/actions/messaging'
import type { Message, Attachment } from '@/lib/messaging'

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    senderId: row.sender_id as string,
    body: (row.body as string) ?? null,
    attachments: ((row.attachments as Attachment[]) ?? []),
    readAt: (row.read_at as string) ?? null,
    createdAt: row.created_at as string,
    deletedAt: (row.deleted_at as string) ?? null,
  }
}

export function useConversation(conversationId: string, currentUserId: string, initial: Message[]) {
  const [messages, setMessages] = useState<Message[]>(initial)

  // reset when switching conversations
  useEffect(() => { setMessages(initial) }, [conversationId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!conversationId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const m = rowToMessage(payload.new as Record<string, unknown>)
          setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m])
          if (m.senderId !== currentUserId) void markThreadRead(conversationId)
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const m = rowToMessage(payload.new as Record<string, unknown>)
          setMessages((prev) => prev.map((x) => x.id === m.id ? m : x))
        })
      .subscribe()
    // mark inbound as read on open
    void markThreadRead(conversationId)
    return () => { supabase.removeChannel(channel) }
  }, [conversationId, currentUserId])

  const send = useCallback(async (body: string, attachments: Attachment[], recipientId: string) => {
    const optimistic: Message = {
      id: `tmp-${Date.now()}`, conversationId, senderId: currentUserId,
      body: body.trim() || null, attachments, readAt: null,
      createdAt: new Date().toISOString(), deletedAt: null,
    }
    setMessages((prev) => [...prev, optimistic])
    const res = await sendMessage(recipientId, body, attachments)
    if (res.error) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      return { error: res.error }
    }
    // replace temp id with the real one (realtime INSERT may also arrive; dedupe by id)
    setMessages((prev) => prev.map((m) => m.id === optimistic.id ? { ...m, id: res.messageId! } : m))
    return {}
  }, [conversationId, currentUserId])

  return { messages, send }
}
```

- [ ] **Step 2: Implement `useTyping.ts`** (ephemeral broadcast, no DB)

Create `app/src/app/hooks/useTyping.ts`:

```ts
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useTyping(conversationId: string, currentUserId: string) {
  const [peerTyping, setPeerTyping] = useState(false)
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!conversationId) return
    const supabase = createClient()
    const channel = supabase.channel(`typing:${conversationId}`, { config: { broadcast: { self: false } } })
    channel.on('broadcast', { event: 'typing' }, (payload) => {
      if ((payload.payload as { userId: string }).userId === currentUserId) return
      setPeerTyping(true)
      if (clearTimer.current) clearTimeout(clearTimer.current)
      clearTimer.current = setTimeout(() => setPeerTyping(false), 3000)
    })
    channel.subscribe()
    channelRef.current = channel
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current)
      supabase.removeChannel(channel)
      channelRef.current = null
      setPeerTyping(false)
    }
  }, [conversationId, currentUserId])

  const lastSent = useRef(0)
  const notifyTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastSent.current < 1500) return // throttle
    lastSent.current = now
    channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId } })
  }, [currentUserId])

  return { peerTyping, notifyTyping }
}
```

- [ ] **Step 3: Implement `useUnreadMessages.ts`** (nav badge)

Create `app/src/app/hooks/useUnreadMessages.ts`:

```ts
'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useUnreadMessages(initialCount: number) {
  const [unreadCount, setUnreadCount] = useState(initialCount)

  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (channel) { supabase.removeChannel(channel); channel = null }
      if (!session?.user) return
      const userId = session.user.id
      channel = supabase
        .channel(`messages-unread:${userId}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload) => {
            const row = payload.new as Record<string, unknown>
            // RLS only delivers rows in the user's conversations; count inbound only
            if ((row.sender_id as string) !== userId) setUnreadCount((c) => c + 1)
          })
        .subscribe()
    })
    return () => { authSub.unsubscribe(); if (channel) supabase.removeChannel(channel) }
  }, [])

  return { unreadCount, setUnreadCount }
}
```

> NOTE: Realtime `postgres_changes` respects RLS — a client only receives `messages` rows for conversations where it is a participant (the SELECT policy from Task 1). So the unfiltered INSERT subscription above never leaks other users' messages.

- [ ] **Step 4: Type-check**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/hooks/useConversation.ts app/src/app/hooks/useTyping.ts app/src/app/hooks/useUnreadMessages.ts
git commit -m "feat(messaging): client hooks — realtime thread, typing broadcast, unread badge"
```

---

## Task 7: UI — `/messages` page, two-pane client, components, CSS

**Files:**
- Create: `app/src/app/messages/page.tsx`
- Create: `app/src/app/messages/MessagesClient.tsx`
- Create: `app/src/app/messages/_components/ConversationList.tsx`
- Create: `app/src/app/messages/_components/ConversationRow.tsx`
- Create: `app/src/app/messages/_components/MessageThread.tsx`
- Create: `app/src/app/messages/_components/MessageBubble.tsx`
- Create: `app/src/app/messages/_components/MessageComposer.tsx`
- Create: `app/src/app/messages/_components/TypingIndicator.tsx`
- Modify: `app/src/app/globals.css`

**Interfaces:**
- Consumes: `getConversations`, `getMessages`, `getConversationPeer`, `getOrCreateConversation`, `areMutualFollowers` (server); hooks from Task 6; `summarizePreview`, types.
- Produces: `MessagesClient` props `{ currentUserId: string; conversations: ConversationListItem[]; initialActive: { conversationId: string; peer: PeerLite; messages: Message[] } | null; pendingPeer: PeerLite | null }` where `PeerLite = { id; username; displayName: string | null; avatarUrl: string | null }`.

- [ ] **Step 1: Server page `messages/page.tsx`**

Create `app/src/app/messages/page.tsx`. Resolves `?c=<conversationId>` (open existing thread) or `?to=<username>` (start/find a thread, mutual-follow gated), loads the inbox, and hands everything to the client.

```tsx
import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  getConversations, getMessages, getConversationPeer,
  getOrCreateConversation, areMutualFollowers,
} from '@/lib/server/messaging'
import { MessagesClient } from './MessagesClient'

export const dynamic = 'force-dynamic'

type PeerLite = { id: string; username: string; displayName: string | null; avatarUrl: string | null }

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; to?: string }>
}) {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const { c, to } = await searchParams
  const conversations = await getConversations(supabase, user.id)

  let activeConversationId: string | null = null
  let pendingPeer: PeerLite | null = null

  if (c) {
    const peer = await getConversationPeer(supabase, c, user.id)
    if (peer) activeConversationId = c
  } else if (to) {
    const { data: target } = await supabase
      .from('profiles').select('id, username, display_name, avatar_url').eq('username', to).maybeSingle()
    if (target && target.id !== user.id) {
      const mutual = await areMutualFollowers(supabase, user.id, target.id)
      if (mutual) {
        // open existing convo if any, else stage a pending (no row until first send)
        const existing = conversations.find((cv) => cv.other.id === target.id)
        if (existing) activeConversationId = existing.conversationId
        else pendingPeer = { id: target.id, username: target.username, displayName: target.display_name, avatarUrl: target.avatar_url }
      }
    }
  }

  let initialActive = null
  if (activeConversationId) {
    const peer = await getConversationPeer(supabase, activeConversationId, user.id)
    const messages = await getMessages(supabase, activeConversationId, user.id)
    if (peer) initialActive = { conversationId: activeConversationId, peer, messages }
  }

  return (
    <main className="ts-msg-page">
      <MessagesClient
        currentUserId={user.id}
        conversations={conversations}
        initialActive={initialActive}
        pendingPeer={pendingPeer}
      />
    </main>
  )
}
```

- [ ] **Step 2: `MessagesClient.tsx`** (two-pane state owner)

Create `app/src/app/messages/MessagesClient.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { ConversationListItem, Message } from '@/lib/messaging'
import { ConversationList } from './_components/ConversationList'
import { MessageThread } from './_components/MessageThread'

type PeerLite = { id: string; username: string; displayName: string | null; avatarUrl: string | null }
type Active = { conversationId: string | null; peer: PeerLite; messages: Message[] }

export function MessagesClient({
  currentUserId, conversations, initialActive, pendingPeer,
}: {
  currentUserId: string
  conversations: ConversationListItem[]
  initialActive: { conversationId: string; peer: PeerLite; messages: Message[] } | null
  pendingPeer: PeerLite | null
}) {
  const [active, setActive] = useState<Active | null>(
    initialActive ?? (pendingPeer ? { conversationId: null, peer: pendingPeer, messages: [] } : null),
  )

  function openConversation(item: ConversationListItem) {
    setActive({ conversationId: item.conversationId, peer: item.other, messages: [] })
  }

  return (
    <div className="ts-msg-shell">
      <aside className="ts-msg-rail">
        <header className="ts-msg-rail-head"><h1 className="ts-h2">Messages</h1></header>
        <ConversationList
          items={conversations}
          activeId={active?.conversationId ?? null}
          onSelect={openConversation}
        />
      </aside>
      <section className="ts-msg-pane">
        {active ? (
          <MessageThread
            key={active.conversationId ?? `pending-${active.peer.id}`}
            currentUserId={currentUserId}
            conversationId={active.conversationId}
            peer={active.peer}
            initialMessages={active.messages}
          />
        ) : (
          <div className="ts-msg-empty-pane">
            <p className="faint">Select a conversation to start messaging.</p>
          </div>
        )}
      </section>
    </div>
  )
}
```

> NOTE: When `openConversation` is used, `MessageThread` starts with empty `initialMessages` and back-fills via a one-time fetch (Step 4). `initialActive` (deep link) arrives pre-filled from the server. A `pendingPeer` thread has `conversationId === null` until the first `sendMessage` returns one.

- [ ] **Step 3: `ConversationList.tsx` + `ConversationRow.tsx`**

Create `app/src/app/messages/_components/ConversationRow.tsx`:

```tsx
'use client'

import type { ConversationListItem } from '@/lib/messaging'

export function ConversationRow({
  item, active, onClick,
}: {
  item: ConversationListItem
  active: boolean
  onClick: () => void
}) {
  const name = item.other.displayName || item.other.username
  return (
    <button type="button" className={`ts-msg-row${active ? ' ts-msg-row-active' : ''}`} onClick={onClick}>
      <span className="ts-msg-avatar">
        {item.other.avatarUrl
          ? <img src={item.other.avatarUrl} alt="" width={40} height={40} style={{ borderRadius: '50%' }} />
          : <span className="ts-msg-avatar-initial">{name.charAt(0).toUpperCase()}</span>}
      </span>
      <span className="ts-msg-row-body">
        <span className="ts-msg-row-top">
          <span className="ts-msg-row-name">{name}</span>
          {item.unreadCount > 0 && <span className="ts-notif-badge">{item.unreadCount > 99 ? '99+' : item.unreadCount}</span>}
        </span>
        <span className="ts-msg-row-preview">{item.preview || 'No messages yet'}</span>
      </span>
    </button>
  )
}
```

Create `app/src/app/messages/_components/ConversationList.tsx`:

```tsx
'use client'

import type { ConversationListItem } from '@/lib/messaging'
import { ConversationRow } from './ConversationRow'

export function ConversationList({
  items, activeId, onSelect,
}: {
  items: ConversationListItem[]
  activeId: string | null
  onSelect: (item: ConversationListItem) => void
}) {
  if (items.length === 0) {
    return <p className="ts-msg-rail-empty faint">No conversations yet. Visit a profile you both follow and tap “Message”.</p>
  }
  return (
    <div className="ts-msg-list">
      {items.map((item) => (
        <ConversationRow
          key={item.conversationId}
          item={item}
          active={item.conversationId === activeId}
          onClick={() => onSelect(item)}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: `MessageThread.tsx`** (wires hooks + composer)

Create `app/src/app/messages/_components/MessageThread.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useConversation } from '@/app/hooks/useConversation'
import { useTyping } from '@/app/hooks/useTyping'
import { getThreadMessages } from '@/app/actions/messaging-read'
import type { Message } from '@/lib/messaging'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import { TypingIndicator } from './TypingIndicator'

type PeerLite = { id: string; username: string; displayName: string | null; avatarUrl: string | null }

export function MessageThread({
  currentUserId, conversationId, peer, initialMessages,
}: {
  currentUserId: string
  conversationId: string | null
  peer: PeerLite
  initialMessages: Message[]
}) {
  const [seed, setSeed] = useState<Message[]>(initialMessages)
  // backfill when opened from the rail (no server-provided history)
  useEffect(() => {
    let cancelled = false
    if (conversationId && initialMessages.length === 0) {
      getThreadMessages(conversationId).then((msgs) => { if (!cancelled) setSeed(msgs) })
    }
    return () => { cancelled = true }
  }, [conversationId, initialMessages.length])

  const { messages, send } = useConversation(conversationId ?? '', currentUserId, seed)
  const { peerTyping, notifyTyping } = useTyping(conversationId ?? '', currentUserId)
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length, peerTyping])

  const name = peer.displayName || peer.username
  return (
    <div className="ts-msg-thread">
      <header className="ts-msg-thread-head">
        <span className="ts-msg-avatar">
          {peer.avatarUrl
            ? <img src={peer.avatarUrl} alt="" width={36} height={36} style={{ borderRadius: '50%' }} />
            : <span className="ts-msg-avatar-initial">{name.charAt(0).toUpperCase()}</span>}
        </span>
        <a href={`/${peer.username}`} className="ts-msg-thread-name">{name}</a>
      </header>

      <div className="ts-msg-scroll">
        {messages.map((m, i) => {
          const mine = m.senderId === currentUserId
          const isLastMine = mine && i === messages.length - 1
          return (
            <MessageBubble key={m.id} message={m} mine={mine} showSeen={isLastMine && !!m.readAt} />
          )
        })}
        {peerTyping && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      <MessageComposer
        recipientId={peer.id}
        disabled={false}
        onTyping={notifyTyping}
        onSend={(body, attachments) => send(body, attachments, peer.id)}
      />
    </div>
  )
}
```

This references a tiny read-only action `getThreadMessages` — create `app/src/app/actions/messaging-read.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { getMessages } from '@/lib/server/messaging'
import type { Message } from '@/lib/messaging'

export async function getThreadMessages(conversationId: string): Promise<Message[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  return getMessages(supabase, conversationId, user.id)
}
```

- [ ] **Step 5: `MessageBubble.tsx`**

Create `app/src/app/messages/_components/MessageBubble.tsx`:

```tsx
'use client'

import type { Message } from '@/lib/messaging'

export function MessageBubble({ message, mine, showSeen }: { message: Message; mine: boolean; showSeen: boolean }) {
  const images = message.attachments.filter((a) => a.type === 'image')
  return (
    <div className={`ts-msg-bubble-row${mine ? ' ts-msg-bubble-mine' : ''}`}>
      <div className={`ts-msg-bubble${mine ? ' ts-msg-bubble-out' : ' ts-msg-bubble-in'}`}>
        {message.deletedAt
          ? <span className="ts-msg-deleted faint">Message deleted</span>
          : <>
              {images.length > 0 && (
                <div className={`ts-msg-images ts-msg-images-${Math.min(images.length, 4)}`}>
                  {images.map((img, i) => img.type === 'image' && <img key={i} src={img.url} alt="" className="ts-msg-image" />)}
                </div>
              )}
              {message.attachments.some((a) => a.type === 'trade') && (
                <div className="ts-msg-trade-chip">📈 Shared a trade</div>
              )}
              {message.body && <span className="ts-msg-text">{message.body}</span>}
            </>}
      </div>
      {showSeen && <span className="ts-msg-seen faint">Seen</span>}
    </div>
  )
}
```

> NOTE: The trade attachment renders as a simple chip in v1 (the spec's full trade-share card is a presentational add-on; the data path — attach, send, persist, display — is complete). Enriching the chip into the existing trade-share card component is a follow-up that needs no schema or action change.

- [ ] **Step 6: `MessageComposer.tsx`** (text + image upload + trade pick)

Create `app/src/app/messages/_components/MessageComposer.tsx`:

```tsx
'use client'

import { useState, useRef } from 'react'
import { TradePickerModal } from '@/app/feed/_components/TradePickerModal'
import type { Attachment } from '@/lib/messaging'

async function uploadImage(file: File, draftId: string, idx: number): Promise<string | null> {
  const ct = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const res = await fetch(`/api/message-image-url?draftId=${draftId}&idx=${idx}&ct=${ct}`)
  if (!res.ok) return null
  const { token, path, publicUrl } = await res.json()
  const { createClient } = await import('@/lib/supabase/client')
  const supabase = createClient()
  const { error } = await supabase.storage.from('OneTradingSocial').uploadToSignedUrl(path, token, file)
  if (error) return null
  return publicUrl as string
}

export function MessageComposer({
  recipientId, disabled, onTyping, onSend,
}: {
  recipientId: string
  disabled: boolean
  onTyping: () => void
  onSend: (body: string, attachments: Attachment[]) => Promise<{ error?: string }>
}) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null) {
    if (!files) return
    const draftId = crypto.randomUUID()
    const current = attachments.filter((a) => a.type === 'image').length
    const room = 4 - current
    const picked = Array.from(files).slice(0, room)
    setBusy(true)
    const uploaded: Attachment[] = []
    for (let i = 0; i < picked.length; i++) {
      const url = await uploadImage(picked[i], draftId, current + i)
      if (url) uploaded.push({ type: 'image', url })
    }
    setAttachments((prev) => [...prev, ...uploaded])
    setBusy(false)
  }

  async function submit() {
    const body = text.trim()
    if (!body && attachments.length === 0) return
    setBusy(true); setError(null)
    const res = await onSend(body, attachments)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setText(''); setAttachments([])
  }

  const hasTrade = attachments.some((a) => a.type === 'trade')

  return (
    <div className="ts-msg-composer">
      {error && <p className="ts-msg-error" role="alert">{error}</p>}
      {attachments.length > 0 && (
        <div className="ts-msg-composer-atts">
          {attachments.map((a, i) => (
            <span key={i} className="ts-msg-att-chip">
              {a.type === 'image' ? '📷 Image' : '📈 Trade'}
              <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="ts-msg-composer-row">
        <button type="button" className="ts-msg-attach-btn" title="Add image" disabled={busy} onClick={() => fileRef.current?.click()}>＋</button>
        <button type="button" className="ts-msg-attach-btn" title="Attach trade" disabled={busy || hasTrade} onClick={() => setShowPicker(true)}>📈</button>
        <input
          ref={fileRef} type="file" accept="image/png,image/jpeg" multiple hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        <textarea
          className="ts-msg-input"
          placeholder="Write a message…"
          value={text}
          disabled={disabled || busy}
          onChange={(e) => { setText(e.target.value); onTyping() }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }}
        />
        <button type="button" className="ts-msg-send" disabled={disabled || busy} onClick={() => void submit()}>▸</button>
      </div>
      {showPicker && (
        <TradePickerModal
          onPick={(t) => { setAttachments((prev) => [...prev.filter((a) => a.type !== 'trade'), { type: 'trade', tradeId: t.id }]); setShowPicker(false) }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
```

> NOTE: bucket name `OneTradingSocial` matches the project's public Storage bucket (per the migration memory). If `lib/storage.ts` exports the bucket constant, import and reuse it instead of the string literal.

- [ ] **Step 7: `TypingIndicator.tsx`**

Create `app/src/app/messages/_components/TypingIndicator.tsx`:

```tsx
export function TypingIndicator() {
  return (
    <div className="ts-msg-typing" aria-label="typing">
      <span className="ts-msg-typing-dot" />
      <span className="ts-msg-typing-dot" />
      <span className="ts-msg-typing-dot" />
    </div>
  )
}
```

- [ ] **Step 8: Styles in `globals.css`**

Append to `app/src/app/globals.css` (reuse existing tokens; full self-contained block):

```css
/* ===== Messaging ===== */
.ts-msg-page { max-width: 1100px; margin: 0 auto; padding: 18px 16px 40px; }
.ts-msg-shell { display: grid; grid-template-columns: 320px 1fr; gap: 16px; height: calc(100vh - 150px); min-height: 480px; }
.ts-msg-rail { background: var(--surface-1, #fff); border: 1px solid var(--border-vio); border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; }
.ts-msg-rail-head { padding: 14px 16px; border-bottom: 1px solid var(--border-vio); }
.ts-msg-rail-empty { padding: 18px; font-size: 13px; }
.ts-msg-list { overflow-y: auto; flex: 1; }
.ts-msg-row { width: 100%; display: flex; gap: 10px; align-items: center; padding: 12px 14px; background: none; border: none; border-bottom: 1px solid rgba(124,92,230,0.08); cursor: pointer; text-align: left; }
.ts-msg-row:hover { background: var(--brand-grad-soft); }
.ts-msg-row-active { background: var(--brand-grad-soft); }
.ts-msg-avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--brand-grad); color: #fff; font-weight: 700; overflow: hidden; }
.ts-msg-avatar-initial { font-size: 15px; }
.ts-msg-row-body { flex: 1; min-width: 0; }
.ts-msg-row-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.ts-msg-row-name { font-weight: 600; font-size: 14px; }
.ts-msg-row-preview { display: block; font-size: 12px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ts-msg-pane { background: var(--surface-1, #fff); border: 1px solid var(--border-vio); border-radius: 16px; overflow: hidden; display: flex; }
.ts-msg-empty-pane { margin: auto; padding: 40px; text-align: center; }
.ts-msg-thread { display: flex; flex-direction: column; width: 100%; }
.ts-msg-thread-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border-vio); }
.ts-msg-thread-name { font-weight: 700; color: var(--violet-deep); text-decoration: none; }
.ts-msg-scroll { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.ts-msg-bubble-row { display: flex; flex-direction: column; align-items: flex-start; }
.ts-msg-bubble-mine { align-items: flex-end; }
.ts-msg-bubble { max-width: 72%; padding: 9px 13px; border-radius: 16px; font-size: 14px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
.ts-msg-bubble-in { background: var(--surface-2); border: 1px solid var(--border-vio); color: var(--ink, #1a1730); border-bottom-left-radius: 5px; }
.ts-msg-bubble-out { background: var(--brand-grad); color: #fff; border-bottom-right-radius: 5px; }
.ts-msg-text { display: block; }
.ts-msg-images { display: grid; gap: 4px; margin-bottom: 6px; }
.ts-msg-images-1 { grid-template-columns: 1fr; }
.ts-msg-images-2, .ts-msg-images-3, .ts-msg-images-4 { grid-template-columns: 1fr 1fr; }
.ts-msg-image { width: 100%; border-radius: 10px; max-height: 220px; object-fit: cover; }
.ts-msg-trade-chip { font-size: 12px; font-weight: 700; padding: 4px 8px; border-radius: 8px; background: rgba(255,255,255,0.18); margin-bottom: 4px; display: inline-block; }
.ts-msg-bubble-in .ts-msg-trade-chip { background: var(--brand-grad-soft); color: var(--violet-deep); }
.ts-msg-seen { font-size: 11px; margin-top: 2px; }
.ts-msg-deleted { font-style: italic; }
.ts-msg-typing { display: inline-flex; gap: 4px; padding: 8px 12px; background: var(--surface-2); border: 1px solid var(--border-vio); border-radius: 16px; width: fit-content; }
.ts-msg-typing-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--violet); animation: ts-msg-blink 1.2s infinite ease-in-out; }
.ts-msg-typing-dot:nth-child(2) { animation-delay: 0.2s; }
.ts-msg-typing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes ts-msg-blink { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }
.ts-msg-composer { border-top: 1px solid var(--border-vio); padding: 10px 12px; }
.ts-msg-error { color: #c0392b; font-size: 12px; margin: 0 0 6px; }
.ts-msg-composer-atts { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.ts-msg-att-chip { font-size: 12px; background: var(--brand-grad-soft); border: 1px solid var(--border-vio); border-radius: 8px; padding: 3px 6px; color: var(--violet-deep); display: inline-flex; gap: 4px; align-items: center; }
.ts-msg-att-chip button { border: none; background: none; cursor: pointer; color: var(--violet-deep); }
.ts-msg-composer-row { display: flex; align-items: flex-end; gap: 6px; }
.ts-msg-attach-btn { flex: none; width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--border-vio); background: var(--surface-2); color: var(--violet-br); cursor: pointer; font-size: 16px; }
.ts-msg-attach-btn:disabled { opacity: 0.45; cursor: default; }
.ts-msg-input { flex: 1; resize: none; min-height: 38px; max-height: 120px; border: 1px solid var(--border-vio); border-radius: 12px; padding: 9px 12px; font: inherit; font-size: 14px; }
.ts-msg-input:focus { outline: none; border-color: var(--violet); }
.ts-msg-send { flex: none; width: 38px; height: 38px; border-radius: 50%; border: none; background: var(--brand-grad); color: #fff; font-size: 16px; cursor: pointer; }
.ts-msg-send:disabled { opacity: 0.5; cursor: default; }
@media (max-width: 720px) {
  .ts-msg-shell { grid-template-columns: 1fr; }
}
```

- [ ] **Step 9: Type-check + lint**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Manual smoke (dev server)**

Run: `cd app && npm run dev` (if not already running). Visit `http://localhost:3000/messages`.
Expected: page renders, left rail shows "No conversations yet" (or existing convos), no console errors.

- [ ] **Step 11: Commit**

```bash
git add app/src/app/messages app/src/app/actions/messaging-read.ts app/src/app/globals.css
git commit -m "feat(messaging): /messages two-pane UI, composer, thread, typing, styles"
```

---

## Task 8: Nav unread badge + profile "Message" button

**Files:**
- Create: `app/src/app/_components/MessagesBell.tsx`
- Modify: `app/src/app/_components/AppNav.tsx`
- Modify: `app/src/app/_components/NotificationBell.tsx`
- Modify: `app/src/app/[username]/page.tsx`

**Interfaces:**
- Consumes: `useUnreadMessages` (Task 6); `getUnreadTotal` (Task 3); `areMutualFollowers` (Task 3).
- Produces: `<MessagesBell initialCount={number} />`.

- [ ] **Step 1: `MessagesBell.tsx`**

Create `app/src/app/_components/MessagesBell.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useUnreadMessages } from '@/app/hooks/useUnreadMessages'

export function MessagesBell({ initialCount }: { initialCount: number }) {
  const { unreadCount } = useUnreadMessages(initialCount)
  return (
    <Link href="/messages" className="ts-nav-icon ts-notif-bell" title="Messages" aria-label="Messages" style={{ position: 'relative' }}>
      ✉
      {unreadCount > 0 && (
        <span className="ts-notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
      )}
    </Link>
  )
}
```

- [ ] **Step 2: Wire into `AppNav.tsx`**

In `app/src/app/_components/AppNav.tsx`:

Add import near the other component imports:
```ts
import { MessagesBell } from './MessagesBell'
import { getUnreadTotal } from '@/lib/server/messaging'
```

Add a state variable beside `initialNotifCount`:
```ts
let initialMsgUnread = 0
```

Inside `if (user) { ... }`, extend the `Promise.all` to also fetch the message unread total:
```ts
;[initialNotifCount, initialNotifItems, initialMsgUnread] = await Promise.all([
  getUnreadCount(service, user.id),
  getNotifications(service, user.id),
  getUnreadTotal(service, user.id),
])
```

Replace the placeholder button:
```tsx
<button type="button" className="ts-nav-icon" title="Messages — soon" aria-label="Messages">✉</button>
```
with:
```tsx
<MessagesBell initialCount={initialMsgUnread} />
```

- [ ] **Step 3: Handle `'message'` in `NotificationBell.tsx`**

In `app/src/app/_components/NotificationBell.tsx`:

Add a case to `notifText`:
```ts
case 'message':    return `@${n.actorUsername} sent you a message`
```

Add to `notifHref` (before the final `return '/'`):
```ts
if (n.type === 'message' && n.entityId) return `/messages?c=${n.entityId}`
```

- [ ] **Step 4: Profile "Message" button**

In `app/src/app/[username]/page.tsx`, locate where the viewer/owner relationship and the `FollowButton` are determined (the profile already computes the signed-in user and the profile being viewed). Add a mutual-follow check and render a Message link next to the follow button when not viewing your own profile and mutual-follow holds.

Add import:
```ts
import { areMutualFollowers } from '@/lib/server/messaging'
```

After the existing follow-state computation (where `user` = viewer, `profile.id` = the viewed profile id, and a not-own-profile branch renders `FollowButton`), compute:
```ts
const canMsg = user && user.id !== profile.id
  ? await areMutualFollowers(supabase, user.id, profile.id)
  : false
```

In the JSX, beside the `FollowButton`, add:
```tsx
{canMsg && (
  <Link href={`/messages?to=${profile.username}`} className="btn btn-sm ts-msg-profile-btn">Message</Link>
)}
```

> NOTE: The exact variable names in `[username]/page.tsx` may differ (e.g. `viewer`, `targetProfile`). Match the file's actual identifiers — the requirement is: a "Message" link to `/messages?to=<username>`, rendered only when a signed-in viewer and the profile owner mutually follow, and never on your own profile. Ensure `Link` from `next/link` is imported (it is used elsewhere on the page).

- [ ] **Step 5: Type-check**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/_components/MessagesBell.tsx app/src/app/_components/AppNav.tsx app/src/app/_components/NotificationBell.tsx app/src/app/[username]/page.tsx
git commit -m "feat(messaging): nav unread badge, message notifications, profile Message button"
```

---

## Task 9: End-to-end tests

**Files:**
- Create: `app/tests/e2e/messaging.spec.ts`

**Interfaces:**
- Consumes: existing e2e signup/onboarding/follow helpers and conventions from `app/tests/e2e/*.spec.ts` (e.g. `notifications.spec.ts`, `search.spec.ts`).

- [ ] **Step 1: Inspect existing e2e helpers**

Run: `cd app && ls tests/e2e && sed -n '1,60p' tests/e2e/notifications.spec.ts`
Expected: shows the signup helper, follow helper, dual-context pattern, and base URL usage. Reuse these exact helpers — do NOT invent new signup flows.

- [ ] **Step 2: Write `messaging.spec.ts`**

Create `app/tests/e2e/messaging.spec.ts`. Use the SAME signup/onboarding/follow helpers found in Step 1. Cover these cases (adapt helper names to what Step 1 reveals):

```ts
import { test, expect, type BrowserContext } from '@playwright/test'
// import { signUp, follow, ... } from helpers discovered in Step 1

// Helper sketch — replace bodies with the project's real helpers from notifications.spec.ts:
// async function signUpUser(context: BrowserContext, prefix: string): Promise<{ username: string }> { ... }
// async function followFrom(context, targetUsername) { ... }   // logged-in context follows target

test.describe('messaging', () => {
  test('mutual followers can DM; message delivers live; read receipt + unread badge', async ({ browser }) => {
    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const a = await signUpUser(ctxA, 'msga')   // ≤20-char usernames
    const b = await signUpUser(ctxB, 'msgb')

    // establish mutual follow
    await followFrom(ctxA, b.username)
    await followFrom(ctxB, a.username)

    // A opens B's profile -> Message button visible (mutual)
    const pageA = await ctxA.newPage()
    await pageA.goto(`/${b.username}`)
    await expect(pageA.getByRole('link', { name: 'Message' })).toBeVisible()
    await pageA.getByRole('link', { name: 'Message' }).click()
    await expect(pageA).toHaveURL(new RegExp(`/messages\\?to=${b.username}`))

    // B opens /messages and waits for live delivery
    const pageB = await ctxB.newPage()
    await pageB.goto('/messages')

    // A sends
    const body = `hello-${Date.now()}`
    await pageA.locator('.ts-msg-input').fill(body)
    await pageA.locator('.ts-msg-send').click()
    await expect(pageA.locator('.ts-msg-bubble-out', { hasText: body })).toBeVisible()

    // B sees it live (must open the conversation row first)
    await pageB.locator('.ts-msg-row').first().click()
    await expect(pageB.locator('.ts-msg-bubble-in', { hasText: body })).toBeVisible({ timeout: 10000 })

    // read receipt: A sees "Seen" after B opened
    await expect(pageA.locator('.ts-msg-seen')).toBeVisible({ timeout: 10000 })
  })

  test('privacy guard: non-mutual users cannot message', async ({ browser }) => {
    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const a = await signUpUser(ctxA, 'msgpa')
    const b = await signUpUser(ctxB, 'msgpb')
    // A follows B but B does NOT follow A (one-way)
    await followFrom(ctxA, b.username)

    const pageA = await ctxA.newPage()
    await pageA.goto(`/${b.username}`)
    // No Message button (not mutual)
    await expect(pageA.getByRole('link', { name: 'Message' })).toHaveCount(0)

    // Direct deep link does not yield a composer that can send (no row, no thread)
    await pageA.goto(`/messages?to=${b.username}`)
    await expect(pageA.locator('.ts-msg-input')).toHaveCount(0)
  })
})
```

- [ ] **Step 3: Warm the dev server, then run**

Run: `cd app && npm run dev` (leave running in one shell; warm it by loading `/` once). In another shell:
Run: `cd app && npx playwright test tests/e2e/messaging.spec.ts`
Expected: both tests PASS. (Cold-compile can blow the first timeout — warm the server first, per Global Constraints.)

- [ ] **Step 4: Commit**

```bash
git add app/tests/e2e/messaging.spec.ts
git commit -m "test(messaging): e2e — live DM delivery, read receipt, privacy guard"
```

---

## Task 10: Full verification + integrate

- [ ] **Step 1: Run the full unit suite**

Run: `cd app && npx vitest run`
Expected: all green (existing 142 + new messaging unit tests).

- [ ] **Step 2: Type-check the whole app**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Confirm no `npm run build` ran against a live dev server**

(Per Global Constraints — never `npm run build` while `npm run dev` is up; it corrupts `.next`.) If a production build check is desired, stop the dev server first.

- [ ] **Step 4: Merge to main**

```bash
git checkout main
git merge --no-ff phase10-messaging -m "feat(messaging): Phase 10 direct messages (DMs)"
```

- [ ] **Step 5: Push (requires explicit user authorization)**

Do NOT push automatically. Ask the user to authorize the push to `main`.

---

## Self-Review (completed during planning)

**Spec coverage:**
- DMs only, mutual-follow → Task 1 (RLS), Task 3 (`areMutualFollowers`), Task 4 (`sendMessage` gate), Task 8 (profile button gate). ✓
- Text + ≤4 images + 1 trade → Task 2 (`validateAttachments`), Task 5 (image upload), Task 6/7 (composer). ✓
- Realtime delivery → Task 6 (`useConversation`), Task 1 (publication). ✓
- Unread badge → Task 3 (`getUnreadTotal`), Task 6 (`useUnreadMessages`), Task 8 (`MessagesBell`). ✓
- Read receipts → Task 4 (`markThreadRead`), Task 6 (UPDATE subscription), Task 7 (`MessageBubble` "Seen"). ✓
- Typing indicators → Task 6 (`useTyping` broadcast), Task 7 (`TypingIndicator`). ✓
- `/messages` two-pane, brand palette → Task 7. ✓
- Postgres Realtime architecture → Task 1 + Task 6. ✓
- Free all tiers → no `FEATURE_MIN_TIER` change (explicit in Global Constraints). ✓
- Message notification → Task 2 (type), Task 4 (insert), Task 8 (bell text/href). ✓
- Privacy/security (RLS-enforced) → Task 1 (SELECT policies, service-role writes), Task 4 (fail-closed gate). ✓
- Tests: unit (Task 2) + e2e incl. privacy guard (Task 9). ✓

**Placeholder scan:** No "TBD"/"handle errors"/bare "write tests" — all steps carry concrete code or exact commands. The few `NOTE:` blocks flag where auto-generated Postgres names must be confirmed at build time (constraint/FK names, bucket constant) — these are verification instructions, not gaps.

**Type consistency:** `Attachment`/`Message`/`ConversationListItem` defined once in `lib/messaging.ts` (Task 2), consumed unchanged in Tasks 3/4/6/7. `areMutualFollowers`, `getOrCreateConversation`, `getConversations`, `getMessages`, `getUnreadTotal`, `getConversationPeer` signatures match between producer (Task 3) and consumers (Tasks 4/7/8). `sendMessage`/`markThreadRead`/`deleteMessage` signatures match between Task 4 and Task 6 hook usage. `NotificationType` extended once (Task 2), entityType extended once (Task 3), consumed in Task 8.
