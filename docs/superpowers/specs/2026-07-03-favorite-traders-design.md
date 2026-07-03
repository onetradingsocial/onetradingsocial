# Favourite Traders — Star Toggle + Feed Boost + Hover Card

**Date:** 2026-07-03
**Status:** Approved design

## Goal

Let a user favourite ("star") traders. Favourites are a stronger, private tier
on top of the existing follow system. Favourited traders' recent public posts
surface first in the home feed. The star is reachable from the profile page and
from a new Twitter-style hover card that appears when hovering any author
identity block (avatar / name / username, the `.who` pattern) across the app.

## Decisions (from brainstorm)

- **Relationship:** star sits on top of follow. Favouriting auto-follows;
  unfavouriting keeps the follow.
- **Feed order:** boost within recency — favourites' posts from the last 48h
  form the top band (newest first), everything else follows by time. Boosted
  posts get a small ★ badge.
- **Privacy:** fully private. No notification to the starred trader, no public
  counts. RLS restricts all reads/writes to the owner.
- **Surfaces:** profile page (★ next to Follow) + hover card on `.who`
  identity blocks (feed post cards, leaderboard tables, home rail).

## Non-goals

- Notifications or "starred by N" social signals.
- Saved/bookmarked *posts* (this is about traders/users).
- Algorithmic ranking beyond the two-band sort.
- A dedicated favourites management page (list lives implicitly via the star
  toggles; can be added later).

## Data model — migration `0016_favorites.sql`

```sql
create table if not exists public.favorites (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  favorite_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, favorite_id),
  constraint favorites_no_self check (user_id <> favorite_id)
);
create index if not exists favorites_user_idx on public.favorites(user_id);
```

RLS enabled. All three policies (`select`, `insert`, `delete`) require
`user_id = auth.uid()` — unlike `follows` (public select), favourites are
viewer-private. No update policy (rows are toggle-only).

## Server actions — `app/src/app/actions/social.ts`

Follow the existing `follow`/`unfollow` pattern (auth via `getUser`-backed
helper, return `SocialState`):

- `favorite(targetId)` — reject self-target; upsert into `favorites`
  (`ignoreDuplicates`), then upsert into `follows` (star implies follow, reuse
  existing upsert shape). No notification insert.
- `unfavorite(targetId)` — delete the `favorites` row only.

## Feed boost — `app/src/app/page.tsx`

- Stage A parallel batch adds
  `supabase.from('favorites').select('favorite_id').eq('user_id', user.id)`.
- Stage B queries unchanged (favourites are a subset of follows, so the
  primary query already includes their posts).
- After `assembleFeed`, sort `merged` in two bands:
  1. posts whose `author_id` is favourited **and** `created_at` within the
     last 48 hours — newest first;
  2. everything else — newest first (current order preserved).
- `FeedItem` gains `fromFavorite: boolean`; `ArenaPostCard` renders a small
  ★ badge next to the author name when set.
- `HomeData` gains `favoriteIds: string[]` so client components (hover card
  seeding, star states in the rail) know current state without extra fetches
  on first paint.

## Hover card — `app/src/app/_components/TraderHoverCard.tsx`

New client component wrapping author identity elements:

- **Trigger:** wraps children (avatar + `.who` text). Desktop: opens after
  ~300ms hover intent, closes on mouse-out with a short grace period so the
  pointer can travel into the card. Mobile/touch: tap on the avatar opens the
  card; tap elsewhere closes it (name/username taps keep their existing link
  behaviour).
- **Content:** avatar, display name, @username (links to profile), mini stats
  (win rate, trades, level), Follow button + ★ toggle. When the card is the
  viewer's own identity, buttons are hidden.
- **Data:** on first open, calls one new server action
  `getTraderCardData(userId)` returning `{ profile: { username, displayName,
  avatarUrl }, stats: { winRate, trades, level }, viewerFollows,
  viewerFavorited }`. Cached per-userId in a module-level map for the session
  so repeat hovers don't refetch. Trade-off: one extra round trip per first
  open, in exchange for zero prop-drilling through five list components.
- **Applied to:** `ArenaPostCard` (`.who` in feed), `XpTable` and
  `LeaderboardTable` rows, home rail trader entries. Positioning:
  fixed-position portal anchored to the trigger rect, flipping above/below to
  stay in the viewport.

## Profile page — `app/src/app/[username]/page.tsx`

★ toggle button next to the existing `FollowButton`, styled to match. Server
component already knows viewer state; pass `initiallyFavorited` down.

## Error handling

- Actions return `SocialState` errors like the existing follow actions;
  optimistic star flip in the client reverts on error (same pattern as
  FollowButton).
- Hover card fetch failure: card shows profile basics from the trigger's own
  props (name/username/avatar already rendered) and hides stats/buttons.

## Testing

- Migration applied via existing Supabase flow; verify RLS: user A cannot
  select user B's favourites.
- Unit: two-band feed sort (favourited-recent first, 48h cutoff, ties by
  time).
- Manual/preview: star from profile, star from hover card, feed reorders,
  ★ badge shows, unfavourite keeps follow, own card hides buttons.
