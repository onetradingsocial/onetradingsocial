# Phase 9a: In-App Notifications — Design Spec

**Date:** 2026-06-26  
**Status:** Approved  
**Scope:** In-app notification system (bell icon + realtime dropdown). Email and browser push deferred.

---

## Overview

Users receive real-time in-app notifications when others interact with their content or follow them. A bell icon in the nav shows unread count, with a dropdown listing recent notifications. No new page — dropdown only.

---

## Notification Events

| Type | Trigger | Recipient |
|------|---------|-----------|
| `like` | User likes a post | Post author |
| `comment` | User comments on a post | Post author |
| `reply` | User replies to a comment | Comment author |
| `follow` | User follows another user | Followed user |
| `post_share` | User creates a post (trade share) | All followers of actor |
| `mention` | `@username` in post body or comment | Mentioned user |

Self-notifications suppressed (actorId === userId → no insert).  
`post_share` fanout: one notification per follower — only fires for posts with trade attachments (type `trade_share`), not plain text posts, to avoid spam.

---

## Data Layer

### Migration `0010_notifications`

```sql
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete cascade not null,
  actor_id    uuid references profiles(id) on delete cascade not null,
  type        text not null check (type in ('like','comment','reply','follow','post_share','mention')),
  entity_id   uuid,
  entity_type text check (entity_type in ('post','comment','trade')),
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index notifications_user_id_created_at on notifications (user_id, created_at desc);

alter table notifications enable row level security;

-- recipients read their own
create policy "owner select" on notifications
  for select using (auth.uid() = user_id);

-- no direct insert/update/delete for authenticated users
-- all writes via service-role client in Server Actions
```

Supabase Realtime enabled on `notifications` table.  
Filter per connection: `notifications:user_id=eq.<uid>`.

---

## App Layer

### `lib/notifications.ts` — pure helpers, no DB

```ts
export type NotificationType = 'like' | 'comment' | 'reply' | 'follow' | 'post_share' | 'mention'

export interface InsertNotificationArgs {
  supabase: SupabaseClient   // must be service-role client
  userId: string             // recipient
  actorId: string            // who triggered it
  type: NotificationType
  entityId?: string
  entityType?: 'post' | 'comment' | 'trade'
}

// Guards: actorId !== userId, deduplicates follow notifs (no double-insert if already follows)
export async function insertNotification(args: InsertNotificationArgs): Promise<void>

// Parse @username mentions from post/comment body → array of usernames
export function extractMentions(text: string): string[]
```

### `lib/server/notifications.ts` — service-role reads

```ts
export async function getNotifications(
  supabase: SupabaseClient,
  userId: string,
  opts?: { limit?: number; offset?: number }
): Promise<Notification[]>

export async function getUnreadCount(supabase: SupabaseClient, userId: string): Promise<number>
export async function markAllRead(supabase: SupabaseClient, userId: string): Promise<void>
export async function markRead(supabase: SupabaseClient, userId: string, notificationId: string): Promise<void>
```

### Actions touched

Add `insertNotification` call in each — service-role client used for the insert:

| File | Action | Notification type |
|------|--------|-------------------|
| `actions/social.ts` | `likePost` | `like` |
| `actions/social.ts` | `addComment` | `comment` + mention scan |
| `actions/social.ts` | `replyComment` | `reply` + mention scan |
| `actions/social.ts` | `followUser` | `follow` |
| `actions/posts.ts` | `createPost` | `post_share` (trade posts only, fan to followers) + mention scan |

Mention scan: `extractMentions(body)` → resolve usernames to IDs via DB lookup → insert one `mention` notif per mentioned user (excluding actor).

### API Route

`POST /api/notifications/read` — marks single notification read. Called from client bell dropdown on row click. Body: `{ id: string }`. Validates ownership via session before update.

---

## UI

### `hooks/useNotifications.ts`

Client hook, mounted once in root layout:

```ts
export function useNotifications(initialCount: number): {
  unreadCount: number
  notifications: Notification[]
  markRead: (id: string) => void
  markAllRead: () => void
}
```

- Subscribes to Supabase Realtime channel `notifications:user_id=eq.<uid>` on mount
- On `INSERT` event: prepend to list, increment `unreadCount`
- Initial `unreadCount` seeded from RSC (server fetch) — no flash on load
- Cleanup channel on unmount

### Nav bell (`_components/Nav.tsx`)

- Bell icon (Heroicons `BellIcon`)
- Red badge with count when `unreadCount > 0`; hidden when 0
- Click → opens dropdown (absolute positioned, z-50)

### Dropdown

- Max 20 most recent notifications, scrollable
- "Mark all read" button at top right (only shown when unreadCount > 0)
- Empty state: "No notifications yet"
- Each row:
  - Actor avatar (16px) + username
  - Action text (see examples below)
  - Relative timestamp (e.g. "2m ago")
  - Unread rows highlighted (subtle bg tint)
  - Click → navigate to entity + mark read
- Close on outside click or Escape

**Row text examples:**
- `@jane liked your post`
- `@bob commented: "great trade R setup..."`  (truncated ~40 chars)
- `@alice replied to your comment`
- `@dan followed you`
- `@sam shared a trade`
- `@mia mentioned you in a post`

---

## Testing

### Unit — `notifications.test.ts` (vitest)

- `insertNotification` skips when actorId === userId
- `insertNotification` deduplicates follow notifications
- `extractMentions` parses single, multiple, mid-sentence @mentions
- `extractMentions` returns empty array when no mentions
- `getUnreadCount` returns correct count
- `markAllRead` sets read=true for correct user only

### E2E — `notifications.spec.ts` (Playwright)

- User A follows User B → User B bell shows follow notification
- User A likes User B's post → User B sees like notification
- User A comments on User B's post → User B sees comment notification with preview
- User A mentions @userB in post → User B sees mention notification
- Mark all read → unread badge clears
- Click notification row → navigates to correct entity
- **Realtime test:** two browser contexts; User A likes → User B bell updates without page refresh

---

## Deferred

- Email digest (Phase 9c or later)
- Browser push notifications (future phase — `insertNotification` is the extension point)
- `/settings/notifications` preference page (mute types, unfollow actor)
- Pagination beyond 20 (load more button)
- `post_share` for plain text posts (only trade-share posts for now to avoid spam)
