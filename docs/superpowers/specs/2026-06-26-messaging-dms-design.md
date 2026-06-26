# Phase 10 — Messaging (Direct Messages) — Design Spec

Date: 2026-06-26
Status: Approved design, pending implementation plan
Branch (planned): `phase10-messaging`

## Summary

Add private 1-on-1 direct messaging to the TradingSocial app. Mutual-follow
required. Messages carry text + image attachments + trade-share cards (full
parity with the post composer). Realtime delivery, unread badge, read receipts,
and typing indicators. Dedicated `/messages` two-pane inbox, styled with the
existing home/dashboard palette (purple brand gradient, glass surfaces).

This is a network-effect / retention feature; **free for all tiers** in v1
(not gated by entitlements).

## Decisions (locked during brainstorm)

1. **Scope:** 1-on-1 DMs only. Group chat is a clean later phase.
2. **Permission:** Mutual-follow required (both users follow each other).
   Enforced server-side, fail closed — not just UI.
3. **Content:** Text + images (≤4) + one trade-share card. Reuses Phase 3b
   post-attachment shapes, image upload to Supabase Storage, `TradePickerModal`.
4. **Realtime:** Full chat — live delivery, unread badge, read receipts
   (`read_at`), typing indicators (ephemeral Realtime broadcast, no DB writes).
5. **UI:** Dedicated `/messages` page (two-pane inbox). Nav ✉ icon w/ unread
   badge. "Message" button on profiles (mutual-follow only).
6. **Realtime architecture:** Postgres Realtime on `messages` table
   (`postgres_changes`), same pattern as Phase 9a notifications. Typing rides a
   separate ephemeral broadcast channel.
7. **Entitlements:** Free for all tiers in v1 (not in `FEATURE_MIN_TIER`).

## Architecture

Follows the established 4-layer per-feature pattern:
pure `lib/` → server-only `lib/server/` → `actions/` → client hooks/components.

### Schema — migration `0012_messaging`

```sql
-- conversations: one row per unordered user pair
create table conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references profiles(id) on delete cascade,  -- least(id1,id2)
  user_b          uuid not null references profiles(id) on delete cascade,  -- greatest(id1,id2)
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)            -- enforce ordered-pair canonical form
);
create index on conversations (user_a, last_message_at desc);
create index on conversations (user_b, last_message_at desc);

-- messages
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid not null references profiles(id) on delete cascade,
  body            text,                          -- nullable (attachment-only allowed)
  attachments     jsonb not null default '[]',   -- [{type:'image',url}] | [{type:'trade',tradeId}]
  read_at         timestamptz,                   -- null = unread; set when recipient opens thread
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,                   -- soft delete-for-everyone (own msg only)
  check (body is not null or jsonb_array_length(attachments) > 0)
);
create index on messages (conversation_id, created_at desc);
```

**Ordered-pair trick:** always store `user_a = least(id1,id2)`,
`user_b = greatest(id1,id2)`. `unique(user_a,user_b)` + `check(user_a<user_b)`
dedupes a pair regardless of who initiates — no double conversations.

### Security (the core risk surface)

Unlike Phase 9b posts (`posts_select using(true)`, visibility at query layer),
DMs are genuinely private and **RLS enforces it directly**:

- **conversations** RLS SELECT: `auth.uid() in (user_a, user_b)`.
- **messages** RLS SELECT: viewer is a participant of the parent conversation
  (subquery against `conversations`).
- **All writes service-role-only** (no insert/update/delete policy), performed
  in `actions/messaging.ts`. Users cannot forge `sender_id`, mark others'
  messages read, soft-delete others' messages, or DM a non-mutual-follower.
- **Mutual-follow re-checked server-side on every send** (both follow rows),
  fail closed. Not trusted from the client.
- Typing/presence = ephemeral Realtime **broadcast** — never touches DB, no RLS
  surface.
- `alter publication supabase_realtime add table messages;` (like notifications).

Migration applied to Supabase Cloud via MCP `apply_migration`.

### Layer 1 — pure `lib/messaging.ts` (unit-tested, no I/O)

- `orderPair(id1, id2) -> { userA, userB }` — least/greatest canonical sort.
- `canMessage(follows) -> boolean` — mutual-follow (both directions present).
- `Attachment` types + `validateAttachments(atts)` — ≤4 images, ≤1 trade,
  reuses Phase 3b shapes; rejects over-limit / empty-message-no-attachment.
- `summarizePreview(message) -> string` — inbox last-line: "📷 Photo" /
  "📈 Shared a trade" / body snippet / "" for deleted.
- Types: `Conversation`, `Message`, `ConversationListItem`.

### Layer 2 — server-only `lib/server/messaging.ts`

- `getConversations(supabase, userId)` — inbox list: convos + other-participant
  profile + last message preview + per-convo unread count. Uses `.range()`
  NOT `.offset()` (Phase 9a PostgREST gotcha).
- `getMessages(supabase, conversationId, userId, { before? })` — thread page,
  cursor pagination on `created_at`; asserts viewer is participant.
- `getOrCreateConversation(serviceClient, a, b)` — ordered-pair upsert
  `onConflict:(user_a,user_b)`.
- `getUnreadTotal(supabase, userId)` — nav badge count, **fails to 0**.

### Layer 3 — `actions/messaging.ts` (getUser auth, then service-role write)

- `sendMessage(recipientId, body, attachments)` — validate; **re-check
  mutual-follow (fail closed)**; get-or-create conversation; insert message;
  bump `conversations.last_message_at`; fire a `message` notification (extend
  Phase 9a `insertNotification` with new `message` type).
- `markThreadRead(conversationId)` — set `read_at = now()` on inbound unread
  rows, scoped by participant.
- `deleteMessage(messageId)` — soft delete (`deleted_at`), **own message only**.

### Layer 4 — client hooks + components

- `useConversation(conversationId)` — `postgres_changes` subscription: INSERT
  (new message) + UPDATE (`read_at` receipt). Optimistic send, dedupe by id.
  Channel captured in outer effect scope, cleaned on unmount (Phase 9a pattern).
- `useTyping(conversationId)` — separate **broadcast** channel, throttled
  `typing` events, ephemeral, auto-expire ~3s idle.
- `useUnreadMessages()` — nav badge, INSERT subscription (mirrors
  `useNotifications`).

## UI / Styling

**Route `/messages`** — two-pane: server-rendered shell + client thread island.

- Left rail = `ConversationList` (rows: avatar, name, last-message preview,
  timestamp, unread count). Active row highlighted with `--brand-grad-soft`
  (same as active nav pills).
- Right pane = `MessageThread`: header (avatar + name), scrollable bubbles,
  "Seen HH:MM" under last read message, animated typing dots, composer.

**Styling — reuse existing tokens, no new color system:**

- Page bg = existing soft radial-violet body wash. Cards = glass `ts-card`.
- **My bubbles** = `--brand-grad` (cyan→violet→magenta→orange), white text,
  right-aligned. **Their bubbles** = `--surface-2` + `--border-vio`, left.
- Unread badge = reuse `NotificationBell` badge CSS.
- Avatars via existing `UserLink` / avatar components.
- Typing dots + "Seen" = `--faint` small text.
- New CSS in `globals.css` as `.ts-msg-*` classes, matching `ts-*` convention.

**Components** (`app/messages/_components/`): `ConversationList`,
`ConversationRow`, `MessageThread`, `MessageBubble`, `MessageComposer` (reuses
post composer attach bar + `TradePickerModal` + image upload), `TypingIndicator`.

**Entry points:**
- Nav ✉ icon + live unread badge beside 🔔 (in `AppNav`).
- "Message" button on profile (`[username]/page.tsx`), visible only on
  mutual-follow, deep-links `/messages?to=<username>`.

## Testing

- **Unit (vitest)** `messaging.test.ts`: `orderPair` (commutative dedupe),
  `canMessage` (mutual / one-way / none), `validateAttachments` (≤4 img / ≤1
  trade / reject over-limit / reject empty), `summarizePreview` (image / trade /
  text / empty / deleted).
- **e2e (playwright)** `messaging.spec.ts`, dual-context (two users):
  1. mutual-follow → A sends → B receives **live**.
  2. **Privacy regression guard**: non-mutual user has no "Message" button AND
     `sendMessage` fails closed (security assertion).
  3. read receipt: B opens thread → A sees "Seen".
  4. unread badge increments then clears.
  - Root paths `/messages` (post-basePath, NOT `/app/*`); warm server before
    run; signup usernames ≤20 chars.

## Rollout

1. Write migration `0012_messaging`; apply to Supabase Cloud via MCP
   `apply_migration`; add `messages` to realtime publication.
2. Build on `phase10-messaging`, layer order lib → server → actions → hooks → UI.
3. Subagent-driven build; tsc clean; vitest green; e2e warm-server green.
4. Merge no-ff to main; push requires explicit user auth.

## Deferred (YAGNI for v1)

- Group chats / multi-participant threads.
- Message requests inbox (non-mutual senders).
- Message edit.
- Tier gating (one-line `FEATURE_MIN_TIER` add if ever wanted).
- Nav dropdown thread preview (full page only for v1).
