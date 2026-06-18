# Post Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3b — let a post carry one attachment (a trade, up to 4 images, or a poll), rendered in the feed so it matches the Logged-In UI template.

**Architecture:** Pure helpers (`lib/post.ts`) are unit-tested. `0004_post_attachments.sql` extends `posts` + adds `post_images`/`poll_options`/`poll_votes` with RLS. Server actions create posts with attachments, upload images via Supabase signed URLs, and record poll votes. The composer gains a trade picker, image picker, and poll builder; `PostCard` renders the attachment with three sub-components.

**Tech Stack:** Next.js 15 (App Router, TS), Tailwind + brand `globals.css`, `@supabase/ssr`, Supabase Storage, Vitest, Playwright.

---

## Conventions

- In-app paths omit `/app` basePath in code. Supabase cookies: getAll/setAll only.
- Pure helpers take primitives; actions do I/O. Run npm from `app/`. Commit after each task.

---

## File Structure

```
app/src/lib/post.ts                              # pollResults + rrBar (pure)
app/supabase/migrations/0004_post_attachments.sql
app/src/lib/storage.ts                           # + signPostImageUpload (modify)
app/src/app/actions/social.ts                    # createPost(object) + attach/vote (modify)
app/src/app/feed/_components/attachments/
    TradeAttachment.tsx
    ImageGallery.tsx
    PollAttachment.tsx
app/src/app/feed/_components/PostCard.tsx        # render switch (modify)
app/src/app/feed/_components/PostComposer.tsx    # attach bar + flows (modify)
app/src/app/feed/_components/TradePickerModal.tsx
app/src/app/api/post-image-url/route.ts          # signed upload URL for post images
app/src/app/page.tsx                             # feed query returns attachments (modify)
app/src/app/globals.css                          # attachment styles (modify)
app/tests/unit/post.test.ts
app/tests/e2e/attachments.spec.ts
```

---

## Task 1: Pure helpers — pollResults + rrBar (TDD)

**Files:** Create `app/src/lib/post.ts`; Test `app/tests/unit/post.test.ts`.

- [ ] **Step 1: Write the failing test**

`app/tests/unit/post.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pollResults, rrBar } from '@/lib/post'

describe('pollResults', () => {
  it('tallies counts, percentages, and the viewer vote', () => {
    const { results, total } = pollResults(
      [{ id: 'a', label: 'Long' }, { id: 'b', label: 'Short' }],
      [{ option_id: 'a' }, { option_id: 'a' }, { option_id: 'b' }],
      'a',
    )
    expect(total).toBe(3)
    expect(results[0]).toEqual({ id: 'a', label: 'Long', count: 2, pct: 67, votedFor: true })
    expect(results[1]).toEqual({ id: 'b', label: 'Short', count: 1, pct: 33, votedFor: false })
  })
  it('handles no votes', () => {
    const { results, total } = pollResults([{ id: 'a', label: 'Yes' }], [], null)
    expect(total).toBe(0)
    expect(results[0]).toEqual({ id: 'a', label: 'Yes', count: 0, pct: 0, votedFor: false })
  })
})

describe('rrBar', () => {
  it('orients a long so target is at the top, stop at the bottom', () => {
    const r = rrBar(1.0856, 1.0806, 1.0936, 'long')
    expect(r.stopPos).toBeCloseTo(0, 5)
    expect(r.targetPos).toBeCloseTo(1, 5)
    expect(r.entryPos).toBeCloseTo(0.3846, 3)
  })
  it('orients a short so target is at the top, stop at the bottom', () => {
    const r = rrBar(1.1, 1.105, 1.09, 'short')
    expect(r.stopPos).toBeCloseTo(0, 5)
    expect(r.targetPos).toBeCloseTo(1, 5)
  })
  it('returns null targetPos when target missing', () => {
    expect(rrBar(10, 9, null, 'long').targetPos).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- post`
Expected: FAIL — `@/lib/post` not found.

- [ ] **Step 3: Implement `app/src/lib/post.ts`**

```ts
export type PollResult = { id: string; label: string; count: number; pct: number; votedFor: boolean }

export function pollResults(
  options: { id: string; label: string }[],
  votes: { option_id: string }[],
  myVote: string | null,
): { results: PollResult[]; total: number } {
  const total = votes.length
  const counts: Record<string, number> = {}
  for (const v of votes) counts[v.option_id] = (counts[v.option_id] ?? 0) + 1
  const results = options.map((o) => {
    const count = counts[o.id] ?? 0
    return { id: o.id, label: o.label, count, pct: total ? Math.round((count / total) * 100) : 0, votedFor: myVote === o.id }
  })
  return { results, total }
}

export function rrBar(entry: number, stop: number, target: number | null, direction: 'long' | 'short') {
  const prices = target != null ? [entry, stop, target] : [entry, stop]
  const min = Math.min(...prices), max = Math.max(...prices)
  const span = max - min || 1
  const norm = (p: number) => (p - min) / span
  const orient = (n: number) => (direction === 'long' ? n : 1 - n)
  return {
    entryPos: orient(norm(entry)),
    stopPos: orient(norm(stop)),
    targetPos: target != null ? orient(norm(target)) : null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- post`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/post.ts app/tests/unit/post.test.ts
git commit -m "feat(app): poll results + R:R bar helpers"
```

---

## Task 2: Database migration

**Files:** Create `app/supabase/migrations/0004_post_attachments.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- Attachment type on posts
do $$ begin
  create type post_attachment as enum ('none','trade','images','poll');
exception when duplicate_object then null; end $$;

alter table public.posts
  add column if not exists attachment_type post_attachment not null default 'none',
  add column if not exists trade_id uuid references public.trades(id) on delete set null;

-- Post images
create table if not exists public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  url text not null,
  ord int not null default 0
);
create index if not exists post_images_post_idx on public.post_images(post_id, ord);
alter table public.post_images enable row level security;
drop policy if exists post_images_select on public.post_images;
create policy post_images_select on public.post_images for select using (true);
drop policy if exists post_images_insert on public.post_images;
create policy post_images_insert on public.post_images for insert
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));
drop policy if exists post_images_delete on public.post_images;
create policy post_images_delete on public.post_images for delete
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

-- Poll options
create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  label text not null,
  ord int not null default 0
);
create index if not exists poll_options_post_idx on public.poll_options(post_id, ord);
alter table public.poll_options enable row level security;
drop policy if exists poll_options_select on public.poll_options;
create policy poll_options_select on public.poll_options for select using (true);
drop policy if exists poll_options_insert on public.poll_options;
create policy poll_options_insert on public.poll_options for insert
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

-- Poll votes (one per user per poll)
create table if not exists public.poll_votes (
  post_id uuid not null references public.posts(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists poll_votes_option_idx on public.poll_votes(option_id);
alter table public.poll_votes enable row level security;
drop policy if exists poll_votes_select on public.poll_votes;
create policy poll_votes_select on public.poll_votes for select using (true);
drop policy if exists poll_votes_insert on public.poll_votes;
create policy poll_votes_insert on public.poll_votes for insert with check (user_id = auth.uid());
drop policy if exists poll_votes_update on public.poll_votes;
create policy poll_votes_update on public.poll_votes for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists poll_votes_delete on public.poll_votes;
create policy poll_votes_delete on public.poll_votes for delete using (user_id = auth.uid());
```

- [ ] **Step 2: Apply the migration**

In Supabase dashboard → SQL Editor, run `0004_post_attachments.sql`.
Expected: `posts` has `attachment_type` + `trade_id`; 3 new tables present.

- [ ] **Step 3: Verify**

```sql
select column_name from information_schema.columns where table_name='posts' and column_name in ('attachment_type','trade_id');
select tablename from pg_tables where tablename in ('post_images','poll_options','poll_votes');
```
Expected: both columns; three tables.

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0004_post_attachments.sql
git commit -m "feat(app): post attachment schema (images, polls, trade ref) + RLS"
```

---

## Task 3: Storage — post image signed upload

**Files:** Modify `app/src/lib/storage.ts`.

- [ ] **Step 1: Append to `app/src/lib/storage.ts`**

```ts
function postImageKey(userId: string, postId: string, idx: number, contentType: string) {
  const ext = contentType === 'image/png' ? 'png' : 'jpg'
  return `posts/${userId}/${postId}/${idx}.${ext}`
}

export function postImagePublicUrl(userId: string, postId: string, idx: number, contentType: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${postImageKey(userId, postId, idx, contentType)}`
}

export async function signPostImageUpload(userId: string, postId: string, idx: number, contentType: string) {
  const path = postImageKey(userId, postId, idx, contentType)
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return { error: 'Could not create upload URL.' as const }
  return { path: data.path, token: data.token }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/storage.ts
git commit -m "feat(app): signed upload for post images"
```

---

## Task 4: Social actions — attachments

**Files:** Modify `app/src/app/actions/social.ts`.

- [ ] **Step 1: Replace `createPost` and add attachment actions**

In `app/src/app/actions/social.ts`, replace the existing `createPost` function with the object-input version below, and append the new actions + types. Keep all other existing exports unchanged.

```ts
export type AttachmentType = 'none' | 'trade' | 'images' | 'poll'

export type CreatePostInput = {
  body: string
  attachmentType: AttachmentType
  tradeId?: string | null
  pollOptions?: string[]
}

export async function createPost(input: CreatePostInput): Promise<{ postId?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const body = (input.body ?? '').trim()
  const type = input.attachmentType
  if (!body && type !== 'images' && type !== 'trade') return { error: 'Write something first.' }
  if (body.length > 2000) return { error: 'Post is too long (2000 max).' }

  if (type === 'trade') {
    if (!input.tradeId) return { error: 'No trade selected.' }
    const { data: t } = await supabase.from('trades').select('user_id').eq('id', input.tradeId).single()
    if (!t || t.user_id !== user.id) return { error: 'Trade not found.' }
  }

  let optionLabels: string[] = []
  if (type === 'poll') {
    optionLabels = (input.pollOptions ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 4)
    if (optionLabels.length < 2) return { error: 'A poll needs at least 2 options.' }
    if (!body) return { error: 'Add a poll question.' }
  }

  const { data: post, error } = await supabase.from('posts').insert({
    author_id: user.id, body: body || ' ', attachment_type: type,
    trade_id: type === 'trade' ? input.tradeId : null,
  }).select('id').single()
  if (error || !post) return { error: error?.message ?? 'Could not create post.' }

  if (type === 'poll') {
    await supabase.from('poll_options').insert(optionLabels.map((label, ord) => ({ post_id: post.id, label, ord })))
  }

  revalidatePath('/')
  return { postId: post.id }
}

export async function attachPostImages(postId: string, urls: string[]): Promise<SocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const prefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`
  const rows = urls.filter((u) => u.startsWith(prefix)).slice(0, 4).map((url, ord) => ({ post_id: postId, url, ord }))
  if (rows.length === 0) return { error: 'No valid images.' }
  // ownership enforced by RLS (post_images_insert checks post author)
  const { error } = await supabase.from('post_images').insert(rows)
  if (error) return { error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function votePoll(postId: string, optionId: string): Promise<{ error?: string; ok?: boolean }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const { data: opt } = await supabase.from('poll_options').select('id').eq('id', optionId).eq('post_id', postId).maybeSingle()
  if (!opt) return { error: 'Invalid option.' }
  await supabase.from('poll_votes').upsert(
    { post_id: postId, user_id: user.id, option_id: optionId },
    { onConflict: 'post_id,user_id' },
  )
  revalidatePath('/')
  return { ok: true }
}

export async function getPickableTrades(): Promise<{ id: string; instrument: string; direction: string; r_multiple: number | null; pnl_amount: number | null; status: string; traded_at: string }[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase.from('trades')
    .select('id, instrument, direction, r_multiple, pnl_amount, status, traded_at')
    .eq('user_id', user.id).order('traded_at', { ascending: false }).limit(20)
  return data ?? []
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `PostComposer.tsx` (it still calls the old `createPost(formData)`). That's expected — Task 7 updates it. If any OTHER file errors, report it.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/actions/social.ts
git commit -m "feat(app): post attachment actions (createPost object, images, poll vote)"
```

---

## Task 5: Attachment CSS

**Files:** Modify `app/src/app/globals.css`.

- [ ] **Step 1: Append to `app/src/app/globals.css`**

```css
/* ---------- Post attachments ---------- */
.ts-trade-att { border: 1px solid var(--border); border-radius: 16px; padding: 14px; margin-top: 12px; background: var(--surface-2); }
.ts-trade-att-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ts-trade-att-head .sym { font-family: var(--display); font-weight: 700; font-size: 17px; }
.ts-trade-att-grid { display: grid; grid-template-columns: 90px 1fr; gap: 14px; margin-top: 12px; align-items: stretch; }
@media (max-width: 540px) { .ts-trade-att-grid { grid-template-columns: 1fr; } }
.ts-rrbar { position: relative; background: linear-gradient(to top, var(--down-soft), var(--up-soft)); border-radius: 10px; border: 1px solid var(--border); min-height: 96px; }
.ts-rrbar-tick { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 6px; transform: translateY(50%); }
.ts-rrbar-line { flex: 1; height: 0; border-top: 1.5px dashed currentColor; }
.ts-rrbar-tag { font-size: 9.5px; font-weight: 700; padding: 1px 5px; border-radius: 5px; background: #fff; border: 1px solid currentColor; }
.ts-rrbar-tick--entry { color: var(--violet-deep); }
.ts-rrbar-tick--stop { color: var(--down); }
.ts-rrbar-tick--target { color: var(--up); }
.ts-trade-att-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ts-trade-att-stat dt { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--faint); font-weight: 600; }
.ts-trade-att-stat dd { font-family: var(--mono); font-weight: 600; font-size: 14px; margin-top: 2px; }
.ts-trade-att-shot { margin-top: 12px; border-radius: 12px; width: 100%; border: 1px solid var(--border); }

.ts-gallery { display: grid; gap: 6px; margin-top: 12px; border-radius: 14px; overflow: hidden; }
.ts-gallery[data-n="1"] { grid-template-columns: 1fr; }
.ts-gallery[data-n="2"] { grid-template-columns: 1fr 1fr; }
.ts-gallery[data-n="3"] { grid-template-columns: 1fr 1fr; }
.ts-gallery[data-n="4"] { grid-template-columns: 1fr 1fr; }
.ts-gallery img { width: 100%; height: 100%; max-height: 280px; object-fit: cover; display: block; cursor: zoom-in; }
.ts-gallery[data-n="3"] img:first-child { grid-column: span 2; }

.ts-poll { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.ts-poll-opt { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 14px; border-radius: 12px; border: 1px solid var(--border-2); background: var(--surface); font-weight: 600; font-size: 14px; overflow: hidden; cursor: pointer; }
.ts-poll-opt:hover { border-color: var(--border-vio); }
.ts-poll-fill { position: absolute; inset: 0 auto 0 0; background: var(--brand-grad-soft); z-index: 0; }
.ts-poll-opt[data-mine="true"] { border-color: var(--violet); }
.ts-poll-opt span { position: relative; z-index: 1; }
.ts-poll-total { font-size: 12px; color: var(--faint); }

.ts-attbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ts-attbar .ts-attach { cursor: pointer; }
.ts-attbar .ts-attach[data-active="true"] { background: var(--brand-grad-soft); border-color: var(--violet); color: var(--violet-deep); }
.ts-att-preview { margin-top: 10px; padding: 10px 12px; border: 1px dashed var(--border-vio); border-radius: 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; }
.ts-pollbuild { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.ts-thumbs { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.ts-thumbs img { width: 64px; height: 64px; border-radius: 10px; object-fit: cover; border: 1px solid var(--border); }
.ts-picker-list { display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto; margin-top: 12px; }
.ts-picker-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer; }
.ts-picker-row:hover { border-color: var(--violet); background: var(--surface-2); }
```

- [ ] **Step 2: Commit**

```bash
git add app/src/app/globals.css
git commit -m "feat(app): post attachment styles"
```

---

## Task 6: Attachment render components

**Files:** Create `app/src/app/feed/_components/attachments/TradeAttachment.tsx`, `ImageGallery.tsx`, `PollAttachment.tsx`.

- [ ] **Step 1: `TradeAttachment.tsx`**

```tsx
import { rrBar } from '@/lib/post'

export type TradeCard = {
  instrument: string; direction: string
  entry_price: number; stop_price: number; target_price: number | null; exit_price: number | null
  r_multiple: number | null; pnl_amount: number | null; realized_pips: number | null
  status: string; screenshot_url: string | null; setup_type: string | null; strategy_tags: string[]
}

export function TradeAttachment({ t }: { t: TradeCard }) {
  const long = t.direction === 'long'
  const bar = rrBar(t.entry_price, t.stop_price, t.target_price, long ? 'long' : 'short')
  const result = t.status === 'open' ? 'Open'
    : t.r_multiple == null ? '—'
    : `${t.r_multiple >= 0 ? 'Win' : 'Loss'} · ${t.r_multiple >= 0 ? '+' : ''}${t.r_multiple.toFixed(1)}R`
  const tags = [t.setup_type, ...(t.strategy_tags ?? [])].filter(Boolean) as string[]
  const tick = (pos: number, kind: string, label: string) => (
    <div className={`ts-rrbar-tick ts-rrbar-tick--${kind}`} style={{ bottom: `${pos * 100}%` }}>
      <span className="ts-rrbar-tag">{label}</span><span className="ts-rrbar-line" />
    </div>
  )
  return (
    <div className="ts-trade-att">
      <div className="ts-trade-att-head">
        <span className="sym">{t.instrument}</span>
        <span className={`ts-side ${long ? 'ts-side--long' : 'ts-side--short'}`}>{long ? '↗ Long' : '↘ Short'}</span>
        <span className={`ts-badge ${t.status === 'open' ? 'ts-badge--open' : (t.r_multiple ?? 0) >= 0 ? 'ts-badge--win' : 'ts-badge--loss'}`} style={{ marginLeft: 'auto' }}>{result}</span>
      </div>
      <div className="ts-trade-att-grid">
        <div className="ts-rrbar">
          {tick(bar.stopPos, 'stop', 'SL')}
          {tick(bar.entryPos, 'entry', 'In')}
          {bar.targetPos != null && tick(bar.targetPos, 'target', 'TP')}
        </div>
        <div className="ts-trade-att-stats">
          <div className="ts-trade-att-stat"><dt>Entry</dt><dd>{t.entry_price}</dd></div>
          <div className="ts-trade-att-stat"><dt>Exit</dt><dd>{t.exit_price ?? '—'}</dd></div>
          <div className="ts-trade-att-stat"><dt>Net P/L</dt><dd className={t.pnl_amount == null ? '' : t.pnl_amount >= 0 ? 'ts-pos' : 'ts-neg'}>{t.pnl_amount == null ? '—' : `${t.pnl_amount >= 0 ? '+' : '−'}$${Math.abs(t.pnl_amount).toFixed(0)}`}</dd></div>
          <div className="ts-trade-att-stat"><dt>Pips</dt><dd>{t.realized_pips != null ? `${t.realized_pips >= 0 ? '+' : ''}${t.realized_pips.toFixed(1)}` : '—'}</dd></div>
        </div>
      </div>
      {tags.length > 0 && <div style={{ marginTop: 12 }}>{tags.slice(0, 3).map((x) => <span key={x} className="ts-tag">{x}</span>)}</div>}
      {t.screenshot_url && <img src={t.screenshot_url} alt="chart" className="ts-trade-att-shot" />}
    </div>
  )
}
```

- [ ] **Step 2: `ImageGallery.tsx`**

```tsx
'use client'

import { useState } from 'react'

export function ImageGallery({ urls }: { urls: string[] }) {
  const [zoom, setZoom] = useState<string | null>(null)
  const n = Math.min(urls.length, 4)
  return (
    <>
      <div className="ts-gallery" data-n={n}>
        {urls.slice(0, 4).map((u) => <img key={u} src={u} alt="" onClick={() => setZoom(u)} />)}
      </div>
      {zoom && (
        <div className="ts-modal-backdrop" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" style={{ maxWidth: '92vw', maxHeight: '90vh', borderRadius: 14 }} />
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 3: `PollAttachment.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { votePoll } from '@/app/actions/social'
import { pollResults } from '@/lib/post'

type Opt = { id: string; label: string }
export function PollAttachment({ postId, options, votes, myVote }: {
  postId: string; options: Opt[]; votes: { option_id: string }[]; myVote: string | null
}) {
  const router = useRouter()
  const [mine, setMine] = useState<string | null>(myVote)
  const [localVotes, setLocalVotes] = useState(votes)
  const [, start] = useTransition()
  const { results, total } = pollResults(options, localVotes, mine)
  const revealed = mine != null

  function vote(optionId: string) {
    if (mine === optionId) return
    const without = localVotes.filter((v) => true) // keep others; PK ensures one per user server-side
    const next = mine ? without : [...without, { option_id: optionId }]
    setMine(optionId)
    setLocalVotes(mine ? localVotes : next)
    start(async () => { await votePoll(postId, optionId); router.refresh() })
  }

  return (
    <div className="ts-poll">
      {results.map((r) => (
        <button key={r.id} type="button" className="ts-poll-opt" data-mine={r.votedFor} onClick={() => vote(r.id)}>
          {revealed && <span className="ts-poll-fill" style={{ width: `${r.pct}%` }} />}
          <span>{r.label}</span>
          {revealed && <span>{r.pct}%</span>}
        </button>
      ))}
      <span className="ts-poll-total">{total} vote{total === 1 ? '' : 's'}{revealed ? '' : ' · tap to vote'}</span>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in PostComposer (old createPost) — still expected until Task 7.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/feed/_components/attachments
git commit -m "feat(app): trade/image/poll attachment render components"
```

---

## Task 7: Composer with attachments + trade picker

**Files:** Modify `app/src/app/feed/_components/PostComposer.tsx`; Create `app/src/app/feed/_components/TradePickerModal.tsx`, `app/src/app/api/post-image-url/route.ts`.

- [ ] **Step 1: `api/post-image-url/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signPostImageUpload, postImagePublicUrl } from '@/lib/storage'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const postId = searchParams.get('postId'); const idx = Number(searchParams.get('idx')); const ct = searchParams.get('ct')
  if (!postId || !Number.isInteger(idx) || (ct !== 'image/png' && ct !== 'image/jpeg')) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: post } = await supabase.from('posts').select('author_id').eq('id', postId).single()
  if (!post || post.author_id !== user.id) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const signed = await signPostImageUpload(user.id, postId, idx, ct)
  if ('error' in signed) return NextResponse.json({ error: signed.error }, { status: 500 })
  return NextResponse.json({ ...signed, publicUrl: postImagePublicUrl(user.id, postId, idx, ct) })
}
```

- [ ] **Step 2: `TradePickerModal.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useTradeModal } from '@/app/_components/TradeModalProvider'
import { getPickableTrades } from '@/app/actions/social'

type T = { id: string; instrument: string; direction: string; r_multiple: number | null; pnl_amount: number | null; status: string; traded_at: string }

export function TradePickerModal({ onPick, onClose }: { onPick: (t: T) => void; onClose: () => void }) {
  const { open } = useTradeModal()
  const [trades, setTrades] = useState<T[]>([])
  async function load() { setTrades(await getPickableTrades()) }
  useEffect(() => { load() }, [])
  return (
    <div className="ts-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ts-modal" style={{ maxWidth: 460 }}>
        <div className="ts-modal-head">
          <h2 className="ts-h2">Attach a trade</h2>
          <button type="button" className="ts-modal-close" onClick={onClose}>✕</button>
        </div>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => open()}>+ Log a new trade</button>
        <p className="faint" style={{ fontSize: 12, margin: '8px 0' }}>After logging, reopen this picker to attach it.</p>
        <div className="ts-picker-list">
          {trades.length === 0 ? <p className="faint" style={{ textAlign: 'center', padding: 20 }}>No trades yet.</p> : trades.map((t) => (
            <button key={t.id} type="button" className="ts-picker-row" onClick={() => onPick(t)}>
              <span style={{ fontWeight: 600 }}>{t.instrument} <span className="faint" style={{ textTransform: 'capitalize', fontWeight: 400 }}>{t.direction}</span></span>
              <span className={t.r_multiple == null ? 'faint' : t.r_multiple >= 0 ? 'ts-pos' : 'ts-neg'} style={{ fontWeight: 700 }}>
                {t.status === 'open' ? 'open' : t.r_multiple != null ? `${t.r_multiple >= 0 ? '+' : ''}${t.r_multiple.toFixed(1)}R` : '—'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `PostComposer.tsx`**

```tsx
'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createPost, attachPostImages, type AttachmentType } from '@/app/actions/social'
import { TradePickerModal } from './TradePickerModal'

const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'OneTradingSocial'

type Picked = { id: string; instrument: string; direction: string }

export function PostComposer() {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [type, setType] = useState<AttachmentType>('none')
  const [trade, setTrade] = useState<Picked | null>(null)
  const [images, setImages] = useState<File[]>([])
  const [options, setOptions] = useState<string[]>(['', ''])
  const [picker, setPicker] = useState(false)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() { setBody(''); setType('none'); setTrade(null); setImages([]); setOptions(['', '']) }
  function clearAttachment() { setType('none'); setTrade(null); setImages([]); setOptions(['', '']) }

  function onImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 4)
    if (files.length) { setImages(files); setType('images') }
  }

  function submit() {
    setError('')
    start(async () => {
      const res = await createPost({ body, attachmentType: type, tradeId: trade?.id ?? null, pollOptions: type === 'poll' ? options : undefined })
      if (res.error || !res.postId) { setError(res.error ?? 'Failed.'); return }
      if (type === 'images' && images.length) {
        const supabase = createClient()
        const urls: string[] = []
        for (let i = 0; i < images.length; i++) {
          const f = images[i]; const ct = f.type === 'image/png' ? 'image/png' : 'image/jpeg'
          const signed = await fetch(`/app/api/post-image-url?postId=${res.postId}&idx=${i}&ct=${encodeURIComponent(ct)}`).then((r) => r.json())
          if (signed?.path && signed?.token) {
            await supabase.storage.from(BUCKET).uploadToSignedUrl(signed.path, signed.token, f, { upsert: true })
            urls.push(signed.publicUrl)
          }
        }
        if (urls.length) await attachPostImages(res.postId, urls)
      }
      reset(); router.refresh()
    })
  }

  return (
    <div className="ts-card ts-composer">
      <textarea className="ts-textarea" rows={3} maxLength={2000} value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={type === 'poll' ? 'Ask a question…' : 'Share an idea, a setup, or a win…'} />

      {type === 'trade' && trade && (
        <div className="ts-att-preview"><span>📈 {trade.instrument} <span className="faint" style={{ textTransform: 'capitalize' }}>{trade.direction}</span></span>
          <button type="button" className="ts-mini" onClick={clearAttachment}>Remove</button></div>
      )}
      {type === 'images' && images.length > 0 && (
        <>
          <div className="ts-thumbs">{images.map((f, i) => <img key={i} src={URL.createObjectURL(f)} alt="" />)}</div>
          <div className="ts-att-preview"><span>{images.length} image{images.length === 1 ? '' : 's'} attached</span>
            <button type="button" className="ts-mini" onClick={clearAttachment}>Remove</button></div>
        </>
      )}
      {type === 'poll' && (
        <div className="ts-pollbuild">
          {options.map((o, i) => (
            <input key={i} className="ts-input" placeholder={`Option ${i + 1}`} value={o}
              onChange={(e) => setOptions((arr) => arr.map((x, j) => j === i ? e.target.value : x))} />
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            {options.length < 4 && <button type="button" className="ts-mini" onClick={() => setOptions((a) => [...a, ''])}>+ Add option</button>}
            <button type="button" className="ts-mini" onClick={clearAttachment} style={{ marginLeft: 'auto' }}>Remove poll</button>
          </div>
        </div>
      )}

      <div className="ts-composer-foot">
        <div className="ts-attbar">
          <button type="button" className="ts-attach" data-active={type === 'trade'} onClick={() => setPicker(true)}>📈 Trade</button>
          <button type="button" className="ts-attach" data-active={type === 'images'} onClick={() => fileRef.current?.click()}>🖼 Image</button>
          <button type="button" className="ts-attach" data-active={type === 'poll'} onClick={() => setType('poll')}>📊 Poll</button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" multiple className="hidden" onChange={onImages} />
        </div>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{pending ? 'Posting…' : 'Post'}</button>
      </div>
      {error && <p className="ts-error" style={{ marginTop: 10 }}>{error}</p>}

      {picker && <TradePickerModal onClose={() => setPicker(false)} onPick={(t) => { setTrade(t); setType('trade'); setPicker(false) }} />}
    </div>
  )
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/feed/_components/PostComposer.tsx app/src/app/feed/_components/TradePickerModal.tsx app/src/app/api/post-image-url/route.ts
git commit -m "feat(app): composer with trade/image/poll attachments"
```

---

## Task 8: Feed query returns attachments + PostCard render

**Files:** Modify `app/src/app/page.tsx`, `app/src/app/feed/_components/PostCard.tsx`.

- [ ] **Step 1: Extend `FeedItem` + render in `PostCard.tsx`**

Add the attachment import + type, and render block. Update the top of `PostCard.tsx`:

```tsx
import { TradeAttachment, type TradeCard } from './attachments/TradeAttachment'
import { ImageGallery } from './attachments/ImageGallery'
import { PollAttachment } from './attachments/PollAttachment'

export type Attachment =
  | { type: 'none' }
  | { type: 'trade'; trade: TradeCard }
  | { type: 'images'; images: string[] }
  | { type: 'poll'; options: { id: string; label: string }[]; votes: { option_id: string }[]; myVote: string | null }

export type FeedItem = {
  id: string; body: string; created_at: string
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null }
  likeCount: number; commentCount: number; viewerLiked: boolean; isOwn: boolean
  attachment: Attachment
}
```

In the JSX, immediately after `<p className="ts-post-body">{post.body}</p>`, insert:

```tsx
      {post.attachment.type === 'trade' && <TradeAttachment t={post.attachment.trade} />}
      {post.attachment.type === 'images' && <ImageGallery urls={post.attachment.images} />}
      {post.attachment.type === 'poll' && <PollAttachment postId={post.id} options={post.attachment.options} votes={post.attachment.votes} myVote={post.attachment.myVote} />}
```

(For poll posts the `body` is the question — render it as the body as usual.)

- [ ] **Step 2: Build attachments in `app/src/app/page.tsx`**

Update the `SELECT` constant to include attachment columns:

```tsx
const SELECT = 'id, body, created_at, author_id, attachment_type, trade_id, author:profiles!posts_author_id_fkey(id, username, display_name, avatar_url)'
```

After computing `merged` and the like/comment tallies, fetch attachment data. Add before building `items`:

```tsx
  const tradeIds = merged.filter((p) => p.attachment_type === 'trade' && p.trade_id).map((p) => p.trade_id as string)
  const imagePostIds = merged.filter((p) => p.attachment_type === 'images').map((p) => p.id)
  const pollPostIds = merged.filter((p) => p.attachment_type === 'poll').map((p) => p.id)
  const F = (a: string[]) => (a.length ? a : EMPTY)

  const [{ data: tradeRowsAtt }, { data: imgRows }, { data: optRows }, { data: voteRows }, { data: myVoteRows }] = await Promise.all([
    supabase.from('trades').select('id, instrument, direction, entry_price, stop_price, target_price, exit_price, r_multiple, pnl_amount, realized_pips, status, screenshot_url, setup_type, strategy_tags').in('id', F(tradeIds)),
    supabase.from('post_images').select('post_id, url, ord').in('post_id', F(imagePostIds)).order('ord', { ascending: true }),
    supabase.from('poll_options').select('id, post_id, label, ord').in('post_id', F(pollPostIds)).order('ord', { ascending: true }),
    supabase.from('poll_votes').select('post_id, option_id').in('post_id', F(pollPostIds)),
    supabase.from('poll_votes').select('post_id, option_id').eq('user_id', user.id).in('post_id', F(pollPostIds)),
  ])
  const tradeById = new Map((tradeRowsAtt ?? []).map((t) => [t.id, t as unknown as TradeCard]))
  const imagesByPost = new Map<string, string[]>()
  for (const r of imgRows ?? []) imagesByPost.set(r.post_id, [...(imagesByPost.get(r.post_id) ?? []), r.url])
  const optionsByPost = new Map<string, { id: string; label: string }[]>()
  for (const r of optRows ?? []) optionsByPost.set(r.post_id, [...(optionsByPost.get(r.post_id) ?? []), { id: r.id, label: r.label }])
  const votesByPost = new Map<string, { option_id: string }[]>()
  for (const r of voteRows ?? []) votesByPost.set(r.post_id, [...(votesByPost.get(r.post_id) ?? []), { option_id: r.option_id }])
  const myVoteByPost = new Map((myVoteRows ?? []).map((r) => [r.post_id, r.option_id]))
```

Add an `import type { Attachment } from './feed/_components/PostCard'` at the top, and a helper to build the attachment, then include it in each item. Replace the `items` mapping's returned object to add `attachment`:

```tsx
  function attachmentFor(p: { id: string; attachment_type: AttachmentType; trade_id: string | null }): Attachment {
    if (p.attachment_type === 'trade' && p.trade_id) {
      const t = tradeById.get(p.trade_id)
      if (t) return { type: 'trade', trade: t }
    }
    if (p.attachment_type === 'images') return { type: 'images', images: imagesByPost.get(p.id) ?? [] }
    if (p.attachment_type === 'poll') return { type: 'poll', options: optionsByPost.get(p.id) ?? [], votes: votesByPost.get(p.id) ?? [], myVote: myVoteByPost.get(p.id) ?? null }
    return { type: 'none' }
  }
```

Add imports at the top of `page.tsx`: `import type { Attachment, FeedItem } from './feed/_components/PostCard'`, `import type { TradeCard } from './feed/_components/attachments/TradeAttachment'`, and `import type { AttachmentType } from './app/actions/social'` (adjust to the correct relative path `@/app/actions/social`).

In the `items` map, add `attachment: attachmentFor(p)` to the returned `base` object. Extend the `RawPost` type to include `attachment_type: AttachmentType` and `trade_id: string | null`, and add those two fields to the `SELECT` (done above).

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: pass. If the `attachmentFor` cast is awkward, simplify by typing `tradeById` as `Map<string, TradeCard>` via `import type { TradeCard }` and casting the query rows once: `new Map((tradeRowsAtt ?? []).map((t) => [t.id, t as unknown as TradeCard]))`, then `attachmentFor` returns `{ type:'trade', trade: tradeById.get(p.trade_id)! }`.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/page.tsx app/src/app/feed/_components/PostCard.tsx
git commit -m "feat(app): render post attachments in the feed"
```

---

## Task 9: Playwright e2e

**Files:** Create `app/tests/e2e/attachments.spec.ts`.

- [ ] **Step 1: Write the e2e spec**

```ts
import { test, expect } from '@playwright/test'

async function signUp(page: import('@playwright/test').Page) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const username = `a_${stamp}`
  await page.goto('/app/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `a_${stamp}@tradingsocial.io`)
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

test('create a poll and vote on it', async ({ page }) => {
  await signUp(page)
  await page.fill('.ts-composer textarea', 'Long or short EUR/USD today?')
  await page.click('.ts-attbar button:has-text("Poll")')
  const opts = page.locator('.ts-pollbuild input')
  await opts.nth(0).fill('Long')
  await opts.nth(1).fill('Short')
  await page.click('.ts-composer button:has-text("Post")')

  await expect(page.locator('.ts-poll')).toBeVisible()
  await page.locator('.ts-poll-opt', { hasText: 'Long' }).click()
  await expect(page.locator('.ts-poll-opt', { hasText: 'Long' })).toContainText('100%')
})

test('share a trade in a post', async ({ page }) => {
  await signUp(page)
  // log a trade first
  await page.goto('/app/journal')
  await page.locator('button:has-text("Log trade")').first().click()
  await page.waitForSelector('.ts-modal--wide')
  await page.fill('input[name="entry_price"]', '1.0856')
  await page.fill('input[name="stop_price"]', '1.0806')
  await page.fill('input[name="target_price"]', '1.0936')
  await page.fill('input[name="exit_price"]', '1.0936')
  await page.click('.ts-modal--wide button:has-text("Save Trade")')
  await page.waitForSelector('.ts-modal--wide', { state: 'detached' })

  await page.goto('/app')
  await page.fill('.ts-composer textarea', 'Textbook London breakout')
  await page.click('.ts-attbar button:has-text("Trade")')
  await page.locator('.ts-picker-row', { hasText: 'EUR/USD' }).first().click()
  await page.click('.ts-composer button:has-text("Post")')

  await expect(page.locator('.ts-trade-att')).toContainText('EUR/USD')
  await expect(page.locator('.ts-trade-att')).toContainText('1.6R')
})
```

- [ ] **Step 2: Run the suite**

Run: `npm run test:e2e -- attachments`
Expected: 2 passed. (Dev server with `.env.local`; migration `0004` applied; image test omitted — needs bucket.)

- [ ] **Step 3: Commit**

```bash
git add app/tests/e2e/attachments.spec.ts
git commit -m "test(app): e2e poll + trade-share attachments"
```

---

## Final Verification

- [ ] `cd app && npm test` → unit pass (post + earlier).
- [ ] `cd app && npm run build` → production build succeeds.
- [ ] `cd app && npm run test:e2e -- attachments` → passes.
- [ ] Apply `0004_post_attachments.sql` to Supabase before running live.
- [ ] Manual: post a poll + vote; share a trade (log-new and existing); post images (needs `OneTradingSocial` bucket); confirm cards render in the feed.
```
