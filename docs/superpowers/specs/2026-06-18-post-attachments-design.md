# TradingSocial App — Phase 3b: Post Attachments

**Date:** 2026-06-18
**Status:** Approved (design)
**Depends on:** Phase 3a (posts, feed, likes, comments), Phase 2 (trades — referenced by trade attachments), Supabase Storage.

Completes Phase 3 (Social). 3a delivered text posts + feed + engagement. 3b adds rich attachments so the feed matches the Logged-In UI template.

---

## 1. Goals

Let a post carry one attachment: a **trade**, **images** (up to 4), or a **poll**. Trade posts render as a stats card (instrument, direction, entry/exit, R, P/L, pips, tags + uploaded screenshot + a schematic R:R level bar). Polls are votable. This turns the feed into the trade-share + discussion stream the template shows.

**Confirmed decisions:**
- Trade card = trade stats + uploaded screenshot (if any) + **schematic R:R level bar** (no live market data).
- Images: **up to 4**, grid gallery.
- Poll: 2–4 options, **one vote per user**, results (%) after voting.
- **One attachment type per post.**
- Attach trade = **log new** (opens the global trade modal) **or share existing** (picker).

**Out of scope / deferred:** video/GIF, multi-attachment posts, editing an existing post's attachment, reactions beyond like, real market-data price charts.

---

## 2. Data model — `0004_post_attachments.sql`

### posts (alter)
- `attachment_type` enum `post_attachment` (`none|trade|images|poll`), not null default `none`.
- `trade_id` uuid, FK→`trades(id)` **on delete set null** (deleting the journal trade leaves the post, drops the card).

### post_images
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `post_id` | uuid | FK→posts, cascade |
| `url` | text | Supabase Storage public URL |
| `ord` | int | 0–3 |

RLS: SELECT all; INSERT/DELETE only when the parent post is the caller's (`exists (select 1 from posts p where p.id = post_id and p.author_id = auth.uid())`). Index `(post_id, ord)`.

### poll_options
`id` uuid PK, `post_id` (FK→posts cascade), `label` text, `ord` int. RLS: SELECT all; INSERT only on own post. Index `(post_id, ord)`.

### poll_votes
`post_id` (FK→posts cascade), `option_id` (FK→poll_options cascade), `user_id` (FK→profiles cascade), `created_at`. **PK `(post_id, user_id)`** → one vote per user per poll. RLS: SELECT all; INSERT/DELETE own (`user_id = auth.uid()`). Index `(option_id)`.

---

## 3. Pure helpers (unit-tested) — `lib/post.ts`

- `pollResults(options: {id,label}[], votes: {option_id}[], myVote: string | null)` → `{ id, label, count, pct, votedFor, total }[]` + total. pct rounded; 0 votes → 0%.
- `rrBar(entry, stop, target, direction)` → `{ entryPos, stopPos, targetPos }` normalized 0–1 across the min..max price span, oriented so profit is "up". Used by the level diagram. Handles missing target (returns null targetPos).

These contain no I/O; the DB queries live in the page/actions.

---

## 4. Composer (extend `PostComposer`)

The 3a stubbed attach buttons (`Trade`, `Image`, `Poll`) become functional. State holds the chosen `attachment` (one at a time; choosing one hides the others; a "remove attachment" clears back to text).

- **Trade** → opens `TradePickerModal`:
  - Lists the user's recent trades (instrument, direction, R, P/L, date) — selectable.
  - A "Log a new trade" button opens the existing global trade modal (`useTradeModal`); after the user saves and the picker reloads, the new trade appears for selection.
  - Selecting sets `attachment = { type: 'trade', tradeId }` and shows a compact preview chip.
- **Image** → file input (`accept image/png,image/jpeg`, up to 4); shows thumbnails; `attachment = { type: 'images', files }`.
- **Poll** → inline builder with 2–4 option inputs; `attachment = { type: 'poll', options }`. The post `body` is the poll question.

Submit flow:
1. `createPost({ body, attachmentType, tradeId?, pollOptions? })` → returns `postId`.
2. If images: request `signPostImageUpload(postId, n, contentType)` per file, upload to Storage, then `attachPostImages(postId, urls)`.
3. `router.refresh()`.

---

## 5. Server actions (extend `actions/social.ts`)

- `createPost(input)` — `input = { body, attachmentType, tradeId?, pollOptions? }`. Validates: body (poll allows shorter; still ≤2000), attachmentType ∈ enum, trade owned by caller when type=trade, 2–4 non-empty options when type=poll. Inserts post (+ poll_options if poll). Returns `{ postId }` or `{ error }`.
- `attachPostImages(postId, urls)` — verifies post ownership; validates each url has the Storage public prefix; inserts `post_images` (ord by index, max 4).
- `votePoll(postId, optionId)` — verifies the option belongs to the post; upserts the caller's vote (changing vote replaces it via PK conflict on `(post_id,user_id)`); returns updated tallies.
- `removeVote(postId)` — deletes the caller's vote.

Storage: `signPostImageUpload(userId, postId, idx, contentType)` in `lib/storage.ts` (mirrors avatar/trade-chart signed-upload), key `posts/{userId}/{postId}/{idx}.{ext}`.

---

## 6. Render (extend `PostCard`)

Feed query (home + later profile) returns per post: `attachment_type`, the joined `trade` (when trade_id set: instrument, market, direction, entry/stop/target/exit, r_multiple, pnl_amount, realized_pips, planned_rr, screenshot_url, setup_type, strategy_tags), `post_images`, `poll_options`, the poll vote tallies, and the viewer's vote.

`PostCard` switches on `attachment_type`:
- **TradeAttachment** — header: instrument + direction pill (Long/Short) + result pill (`Win · 2.0R` / `Loss · -1.0R` / `Open`). **R:R level bar** from `rrBar(...)` (entry/stop/target ticks). Box: Entry, Exit, Net P/L (colored) + pips. Tags (setup + strategy). Screenshot below if `screenshot_url`.
- **ImageGallery** — 1–4 grid (1→full, 2→2-col, 3→2+1, 4→2×2); click opens a lightbox.
- **PollAttachment** — body as the question; options as buttons; on vote (or if already voted) show horizontal % bars + counts, the viewer's choice highlighted; total votes.

Privacy: a trade attached to a post is shown via the post (public); we surface only the fields above. (A private journal trade the author chooses to attach becomes visible through the post — that is the author's explicit share action.)

---

## 7. Error handling

- Wrong option count (poll) / empty options → inline error.
- Image upload failure → keep the post (text), surface a retry on the failed image; ≤4 enforced.
- Voting twice → replaces the vote (no error). Voting on a poll you don't own is fine (anyone votes).
- Attaching a trade not owned by you → rejected.
- Deleting a post cascades images, poll options, votes.

---

## 8. Testing

- **Vitest:** `pollResults` (tallies, pct rounding, no votes, my-vote flag); `rrBar` (long vs short orientation, missing target).
- **Playwright:**
  1. Create a **poll** post → vote an option → results + counts appear, choice highlighted.
  2. Log a trade, create a post **sharing that trade** → trade card shows instrument + R.
  3. Create a post with an **image** → image renders in the card (requires the `OneTradingSocial` bucket).

---

## 9. Deliverables checklist

- [ ] `0004_post_attachments.sql` (posts alter, post_images, poll_options, poll_votes + RLS).
- [ ] `lib/post.ts` (`pollResults`, `rrBar`) + unit tests.
- [ ] `signPostImageUpload` in `lib/storage.ts`.
- [ ] `actions/social.ts` extensions (createPost attachments, attachPostImages, votePoll, removeVote).
- [ ] Composer: AttachBar wiring, `TradePickerModal`, `PollBuilder`, image picker.
- [ ] `PostCard` render: `TradeAttachment`, `ImageGallery`, `PollAttachment`.
- [ ] Feed query returns attachment data.
- [ ] Vitest + Playwright suites.
