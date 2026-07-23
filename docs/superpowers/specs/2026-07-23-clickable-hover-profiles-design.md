# Clickable + Hover Profile Cards Everywhere

**Date:** 2026-07-23
**Status:** Approved design

## Goal

Every profile occurrence in the main app (avatar, display name, `@username`) should:

1. **Be clickable** → navigate to `/{username}`.
2. **On hover (desktop) / tap (touch)** → show a data card with the trader's stats
   (win rate, trades, level) plus Follow / Favorite actions.

The leaderboard already does this via `TraderHoverCard`. This work extends the
same pattern to the remaining live surfaces the user picked: **social surfaces +
discovery** (notifications and nav search). Out of scope: DMs, admin tables, the
viewer's own nav avatar.

## What already exists (reused, not rebuilt)

- **`TraderHoverCard`** (`app/src/app/_components/TraderHoverCard.tsx`) — the hover
  card itself. Fetches `getTraderCardData(userId)` on hover (session-cached),
  renders stats + Follow/Favorite, positions via a portal to `document.body`,
  flips above/below the trigger, handles touch tap-to-open. **No new card
  component is needed.**
- **`UserLink`** (`app/src/app/_components/UserLink.tsx`) — central avatar+name+handle
  link. Already clickable; lacks the hover card.

## Already covered (no change)

- Leaderboard table (`LeaderboardTable`, `XpTable`)
- Live feed post header (`home/ArenaPostCard.tsx`)
- Rail mini-leaderboard list (`home/rail.tsx`, the `t.userId` list)

## Dead code — explicitly skipped

Confirmed unused (only self-references or type-only imports): `WelcomeHero`,
`RightRail`, `PostCard`, `FeedTabs`, `feed/_components/SuggestedTraders.tsx`.
No work on these. (Not deleting them here — out of scope for this change.)

## Design

### 1. `TraderHoverCard` — make the wrapper class configurable

`TraderHoverCard` wraps its trigger children in a `<div className="thc-wrap">`.
`.thc-wrap` is `display:flex; flex:1` — correct for a leaderboard row, wrong for
inline names or full-width list rows, where it would shift layout.

**Change:** add an optional prop `wrapClassName?: string` (default `'thc-wrap'`).
The positioning logic is unchanged — it still measures `wrapRef`'s bounding rect,
so any wrapper that generates a real box works.

New CSS helpers in `globals.css`:

- `.thc-inline { display: inline-flex; align-items: center; }` — hugs an inline
  name+avatar trigger (UserLink, Podium, sidebar SuggestedTraders, rail leader).
- `.thc-block { display: block; }` — full-width row triggers (notification row,
  nav-search row) so the whole row is the hover target and the inner `<Link>`
  keeps handling clicks.

### 2. `UserLink` — optional `userId` enables the card

Add optional `userId?: string`. When present, wrap the returned `<Link>` in
`<TraderHoverCard userId username displayName avatarUrl wrapClassName="thc-inline">`.
When absent, render exactly as today — fully backwards-compatible. This keeps the
hover behavior in one place for every current and future `UserLink` caller.

### 3. Per-surface changes (live only)

| Surface | File | userId source | Work |
|---|---|---|---|
| Comments | `feed/_components/CommentThread.tsx` | add `id` to `CommentItem.author` (query already selects `author_id`) | pass `userId` to `UserLink` |
| Suggested (sidebar) | `_components/SuggestedTraders.tsx` | `r.userId` ✓ | wrap avatar+name block in `TraderHoverCard` (`thc-inline`) |
| Podium | `leaderboard/_components/Podium.tsx` | `t.userId` ✓ | wrap avatar+name+handle; skip when `self` |
| Notifications | `_components/NotificationBell.tsx` | `n.actorId` (null for system) | wrap the row `<Link>` (`thc-block`) only when `actorId` is non-null |
| Nav search | `_components/NavSearch.tsx` + `actions/search.ts` + `lib/search.ts` | add `id` to profiles select + `UserResult` | wrap each trader row `<Link>` (`thc-block`) |
| Rail featured leader | `feed/_components/home/rail.tsx` | leader `userId` (verify on type) | wrap the featured leader avatar+name (`thc-inline`) |

### Data-layer changes

- **`lib/search.ts`**: add `id: string` to `UserResult`.
- **`actions/search.ts`**: `select('id, username, display_name, avatar_url, bio')`
  and map `id` through.
- **`actions/social.ts`**: `CommentItem.author` gains `id: string`; map from the
  already-selected `author_id`.

## Click vs. hover semantics

The inner `<Link href="/{username}">` always owns navigation; the card is purely
additive. Notification rows keep navigating to their existing target (e.g. the
post) — the hover card shows the *actor* (Twitter-style). System notifications
(no actor) get no card.

## Edge cases

- **Self**: Podium/rail skip the card for the viewer's own entry (consistent with
  existing "You" / "Your profile" treatment). `TraderHoverCard` already hides
  Follow/Favorite when `data.isSelf`, so other surfaces degrade gracefully even
  if not special-cased.
- **Private / missing profile**: `getTraderCardData` returns null → card shows its
  existing "failed"/empty state. No crash.
- **Touch**: inherited from `TraderHoverCard` — tap the link navigates, tap
  elsewhere in the trigger opens the card, tap-outside closes.

## Testing

- Existing `tests/e2e/leaderboard.spec.ts` already exercises the card.
- Add one light e2e: open a post's comments, hover a commenter, assert `.thc-card`
  appears and its header links to `/{username}`.
- Manual: verify no layout shift on comment rows, notification rows, and search
  rows (the `.thc-inline` / `.thc-block` split is the risk area).

## Non-goals

- No redesign of the card's contents.
- No new stats or backend fields beyond surfacing existing `id`/`author_id`.
- No changes to DMs, admin, or the own-avatar nav control.
- No deletion of the dead components listed above.
