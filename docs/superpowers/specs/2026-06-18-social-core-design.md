# TradingSocial App — Phase 3a: Social Core (Follow + Feed)

**Date:** 2026-06-18
**Status:** Approved (design)
**Depends on:** Phase 0+1 (auth, profiles, RLS), Phase 2 (journal — referenced later in 3b).

Phase 3 (Social) is split into two build cycles:
- **3a (this spec):** follows, text posts, likes, comments, the feed (home page), clickable user links, profile follow.
- **3b (next spec):** rich post attachments — trade embeds (log-new + share-existing), images, polls.

---

## 1. Goals

Turn the placeholder home page into a working social feed: traders follow each other, post updates, like, and comment. This is the logged-in landing experience and the backbone the 3b attachments hang off.

**Confirmed decisions:**
- Feed = posts from followed traders **+ yourself**, with a **fallback** to platform-wide recent posts when sparse.
- Engagement: **likes + comments**.
- Every user reference (avatar, @username) is **clickable → that trader's profile**.
- Posts are public (social by nature); profile-level privacy does not hide posts.

**Out of scope (→ 3b):** trade/image/poll attachments. **Deferred:** notifications, reposts, hashtags/mentions parsing, follower/following list pages, edit-post.

---

## 2. Data model — `0003_social.sql`

### follows
| Column | Type | Notes |
|---|---|---|
| `follower_id` | uuid | FK→profiles, cascade |
| `following_id` | uuid | FK→profiles, cascade |
| `created_at` | timestamptz default now() | |

PK = (`follower_id`, `following_id`). CHECK `follower_id <> following_id`. Index on `following_id`.
RLS: SELECT all (authenticated); INSERT/DELETE where `follower_id = auth.uid()`.

### posts
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `author_id` | uuid | FK→profiles, cascade |
| `body` | text not null | non-empty, ≤ 2000 chars (app-enforced) |
| `created_at` / `updated_at` | timestamptz | trigger-maintained updated_at |

Index `(created_at desc)`, `(author_id, created_at desc)`.
RLS: SELECT all; INSERT/UPDATE/DELETE where `author_id = auth.uid()`.

### likes
`post_id` (FK→posts, cascade), `user_id` (FK→profiles, cascade), `created_at`. PK (`post_id`,`user_id`).
RLS: SELECT all; INSERT/DELETE where `user_id = auth.uid()`. Index `(post_id)`.

### comments
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `post_id` | uuid | FK→posts, cascade |
| `author_id` | uuid | FK→profiles, cascade |
| `body` | text not null | ≤ 1000 chars |
| `created_at` | timestamptz | |

Index `(post_id, created_at)`. RLS: SELECT all; INSERT/DELETE where `author_id = auth.uid()`.

Counts (followers/following/likes/comments) are derived via `count()` queries or `head: true` count — no denormalized counters in 3a (YAGNI; revisit if slow).

---

## 3. Feed assembly (home `/app`)

Server component. Steps:
1. Resolve the viewer's `following_id` set (`select following_id from follows where follower_id = me`).
2. **Primary feed:** posts where `author_id in (following ∪ me)`, order `created_at desc`, limit 30.
3. **Fallback:** if primary < 5 posts, append recent platform-wide posts (any author), de-duplicated, to reach up to 30. New users (follow nobody) thus see real content + a "suggested traders to follow" strip.
4. For each post, attach: author profile (id, username, display_name, avatar_url), like count, comment count, and `viewerLiked` (boolean).

Suggested traders strip (shown when viewer follows few/none): up to 5 public, onboarded profiles the viewer doesn't already follow, by most recent activity (fallback: newest profiles), excluding self.

A small pure helper `assembleFeed(primary, fallback, limit)` (dedupe + cap) is unit-tested; the DB queries themselves live in the page/action.

---

## 4. Components

```
app/src/app/page.tsx                       # feed: composer + suggested strip + post list
app/src/app/_components/UserLink.tsx       # avatar + @username -> /app/[username] (shared)
app/src/app/feed/_components/
    PostComposer.tsx                       # client: textarea + Post (attach buttons stubbed for 3b)
    PostCard.tsx                           # author (UserLink), body, LikeButton, comment toggle
    LikeButton.tsx                         # client, optimistic toggle
    CommentThread.tsx                      # client: list + add/delete comment
    SuggestedTraders.tsx                   # follow suggestions strip
app/src/app/_components/FollowButton.tsx   # client, optimistic follow/unfollow (used on profile)
```

- **UserLink**: renders avatar (or initial) + name/@username as a `next/link` to `/app/[username]`. Used in post cards, comments, suggested strip.
- **PostComposer**: `body` textarea, char counter, Post button → `createPost`. Disabled when empty. Attach-trade/image/poll buttons rendered but disabled with a "soon" hint (wired in 3b).
- **PostCard**: header = UserLink + relative time; body; footer = LikeButton (count) + comment button (count) toggling CommentThread; delete (own posts).
- **LikeButton**: shows liked state + count; optimistic update, calls `toggleLike`.
- **CommentThread**: lists comments (UserLink + body + relative time + delete own), inline add-comment input → `addComment`.
- **FollowButton**: Follow/Following toggle, optimistic, calls `follow`/`unfollow`. Hidden on own profile.

---

## 5. Server actions — `actions/social.ts`

All call `supabase.auth.getUser()` and enforce ownership; return `{ error }` or `{ ok }` (+ data where needed). `revalidatePath('/')` after feed-mutating actions.

- `createPost(formData)` — validate body non-empty ≤2000; insert; return new post id.
- `deletePost(postId)` — delete where author = me.
- `toggleLike(postId)` — insert if absent else delete (own `user_id`); return new liked state + count.
- `addComment(postId, body)` — validate ≤1000; insert.
- `deleteComment(commentId)` — delete where author = me.
- `follow(targetId)` / `unfollow(targetId)` — insert/delete where follower = me; `follow` rejects self.

RLS is the security backstop; the actions add validation + clean error messages (no raw DB errors leaked).

---

## 6. Profile integration

`/app/[username]` (Phase-1 page): replace placeholder follower/following `0 · 0` with **real counts** (`count(follows where following_id = profile.id)` and `where follower_id = profile.id`), and render `FollowButton` (when viewing someone else, and logged in). Counts link targets (follower/following list pages) are deferred — counts are display-only in 3a.

---

## 7. Error handling

- Empty/oversized post or comment → inline validation error, no submit.
- Double-like / double-follow → idempotent (PK conflict treated as success / no-op).
- Self-follow → blocked (CHECK + action guard).
- Unauthed action → redirect to `/login` (server) / disabled control (client).
- Deleting a post cascades its likes/comments (FK cascade).

---

## 8. Testing

- **Vitest:** `assembleFeed` (dedupe primary+fallback, cap to limit, primary precedence).
- **Playwright:** sign up two users; user A posts → A sees it in feed; A likes own post → count 1; A comments → comment shows; user B follows A → A's post appears in B's feed; B unfollows → gone (fallback may still surface it platform-wide, so assert via the followed-only signal: B's follower action changes A's follower count).

---

## 9. Deliverables checklist

- [ ] `0003_social.sql` (follows, posts, likes, comments + RLS + indexes).
- [ ] `assembleFeed` helper (+ unit test).
- [ ] `actions/social.ts` (post/like/comment/follow).
- [ ] `UserLink`, `FollowButton`, `PostComposer`, `PostCard`, `LikeButton`, `CommentThread`, `SuggestedTraders`.
- [ ] Home `/app` feed page.
- [ ] Profile real follower/following counts + FollowButton.
- [ ] Vitest + Playwright suites.
