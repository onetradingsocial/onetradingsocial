# Clickable + Hover Profile Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every live profile occurrence (avatar, name, `@handle`) show the existing `TraderHoverCard` on hover/tap and navigate to the profile, matching the leaderboard.

**Architecture:** Reuse the existing `TraderHoverCard` component unchanged in behavior; add one prop so its wrapper element can adapt to different layout contexts. Surface the user `id` on the two data paths that lack it (search results, comments), then wrap each remaining live surface's trigger markup in `TraderHoverCard`.

**Tech Stack:** Next.js (App Router) + React 19, TypeScript, Supabase (server actions), CSS in `globals.css`, Vitest (unit), Playwright (e2e).

## Global Constraints

- Test runner: `npm test` = `vitest run`; e2e: `npm run test:e2e` = `playwright test`. Run these **from the `app/` directory**.
- No new dependencies. No RTL — component behavior is verified via Playwright, pure logic via Vitest.
- Do **not** touch dead components: `WelcomeHero`, `RightRail`, `PostCard`, `FeedTabs`, `feed/_components/SuggestedTraders.tsx`. Do not delete them either.
- `TraderHoverCard` lives at `app/src/app/_components/TraderHoverCard.tsx` and takes `{ userId, username, displayName, avatarUrl, children }`. It fetches stats on hover and self-hides Follow/Favorite when the target is the viewer.
- Backwards compatibility: existing `TraderHoverCard` call sites (leaderboard table, `home/ArenaPostCard.tsx`, `home/rail.tsx` list) must keep the default `thc-wrap` wrapper — do not pass `wrapClassName` at those sites.
- Skip the card for the viewer's own entry where a surface special-cases "self" (Podium, rail Trader-of-week).

---

### Task 1: Failing e2e — hovering a follow notification shows the card

This is the behavioral gate. A follow generates a notification whose actor has a non-null `actorId`; hovering that row must open `.thc-card`. It fails today because notification rows aren't wrapped.

**Files:**
- Create: `app/tests/e2e/profile-hover.spec.ts`

**Interfaces:**
- Consumes: the existing `signUpAndOnboard` flow (copied below — the e2e helpers are not exported from `leaderboard.spec.ts`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing e2e**

Create `app/tests/e2e/profile-hover.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'

async function signUpAndOnboard(page: Page, prefix: string) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const username = `${prefix}_${stamp}`
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@tradingsocial.io`)
  await page.fill('input[name="password"]', 'password123')
  await page.locator('label.fl-terms .fl-check').click()
  await expect(page.locator('input[name="terms"]')).toBeChecked()
  await page.click('button:has-text("Join the Beta")')
  await expect(page).toHaveURL(/\/select-plan/, { timeout: 15000 })
  await page.click('button:has-text("Continue with Free")')
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 })
  await page.click('button:has-text("Build my identity")')
  await page.click('button:has-text("Forex")')
  await page.click('button:has-text("Continue")')
  await page.click('button:has-text("Beginner")')
  await page.click('button:has-text("Continue")')
  await page.click('button:has-text("Build consistency")')
  await page.click('button:has-text("Continue")')
  await page.click('button:has-text("Public")')
  await page.click('button:has-text("Continue")')
  await page.click('button:has-text("Log trades manually")')
  await page.click('button:has-text("Create my profile")')
  await page.click('button:has-text("Enter TradingSocial")')
  await expect(page).toHaveURL('/', { timeout: 15000 })
  return username
}

async function logout(page: Page) {
  await page.goto('/settings')
  await page.click('button:has-text("Log out")')
  await expect(page).toHaveURL(/\/login/)
}

test('hovering a follow notification opens the trader card', async ({ page }) => {
  // User A exists and will receive the notification.
  const userA = await signUpAndOnboard(page, 'hov_a')
  await logout(page)

  // User B follows A from A's profile page.
  await signUpAndOnboard(page, 'hov_b')
  await page.goto(`/${userA}`)
  await page.click('button:has-text("Follow")')
  await logout(page)

  // A logs in and opens the notification bell.
  await page.goto('/login')
  await page.fill('input[name="email"]', `${userA}@tradingsocial.io`)
  await page.fill('input[name="password"]', 'password123')
  await page.click('button:has-text("Log in")')
  await expect(page).toHaveURL('/', { timeout: 15000 })

  await page.click('.ts-notif-bell')
  const row = page.locator('.ts-notif-row-link').first()
  await expect(row).toBeVisible()

  // Hover opens the card (300ms open delay in TraderHoverCard).
  await row.hover()
  await expect(page.locator('.thc-card')).toBeVisible({ timeout: 4000 })
  // Card header is a profile link.
  await expect(page.locator('.thc-card a.thc-id')).toBeVisible()
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run (from `app/`): `npm run test:e2e -- profile-hover`
Expected: FAIL — `.thc-card` never appears (notification rows are not wrapped yet).

- [ ] **Step 3: Commit the failing test**

```bash
git add app/tests/e2e/profile-hover.spec.ts
git commit -m "test(e2e): failing spec — notification hover should open trader card"
```

---

### Task 2: `TraderHoverCard` — configurable wrapper class + CSS helpers

**Files:**
- Modify: `app/src/app/_components/TraderHoverCard.tsx`
- Modify: `app/src/app/globals.css` (after line 1911, `.thc-wrap`)

**Interfaces:**
- Produces: `TraderHoverCard` now accepts optional `wrapClassName?: string` (default `'thc-wrap'`). Later tasks pass `"thc-inline"`, `"thc-block"`, or `"thc-stack"`.

- [ ] **Step 1: Add the prop**

In `TraderHoverCard.tsx`, change the component signature and the wrapper `div`'s className.

Signature (currently ends `avatarUrl, children }`):

```tsx
export function TraderHoverCard({ userId, username, displayName, avatarUrl, wrapClassName = 'thc-wrap', children }:
  { userId: string; username: string; displayName: string | null; avatarUrl: string | null; wrapClassName?: string; children: ReactNode }) {
```

Wrapper div (currently `<div ref={wrapRef} className="thc-wrap"`):

```tsx
    <div ref={wrapRef} className={wrapClassName}
```

Leave everything else in the file unchanged.

- [ ] **Step 2: Add CSS helpers**

In `globals.css`, immediately after the `.thc-wrap { ... }` line (1911), add:

```css
.thc-inline { display: inline-flex; align-items: center; min-width: 0; }
.thc-block { display: block; }
.thc-stack { display: flex; flex-direction: column; align-items: center; }
```

- [ ] **Step 3: Verify the build + existing e2e still pass**

Run (from `app/`):
```bash
npm run build
npm run test:e2e -- leaderboard
```
Expected: build succeeds; leaderboard spec passes (default `thc-wrap` unchanged).

- [ ] **Step 4: Commit**

```bash
git add app/src/app/_components/TraderHoverCard.tsx app/src/app/globals.css
git commit -m "feat(hovercard): configurable wrapper class + inline/block/stack helpers"
```

---

### Task 3: Wrap notification rows — turns Task 1 green

**Files:**
- Modify: `app/src/app/_components/NotificationBell.tsx`

**Interfaces:**
- Consumes: `TraderHoverCard` with `wrapClassName` (Task 2). `Notification` already carries `actorId: string | null`, `actorUsername: string`, `actorAvatarUrl: string | null`.

- [ ] **Step 1: Import `TraderHoverCard`**

At the top of `NotificationBell.tsx`, add after the existing `Link` import:

```tsx
import { TraderHoverCard } from '@/app/_components/TraderHoverCard'
```

- [ ] **Step 2: Wrap the row link when there is an actor**

Replace the `<li>` body (the `<Link ...> ... </Link>` currently inside `notifications.map`) so the link is conditionally wrapped. The `<Link>` markup itself is unchanged; only the wrapper is added:

```tsx
              {notifications.map((n) => {
                const link = (
                  <Link
                    href={notifHref(n)}
                    onClick={() => { if (!n.read) markRead(n.id); setOpen(false) }}
                    className="ts-notif-row-link"
                  >
                    <span className="ts-notif-avatar">
                      {isSystem(n)
                        ? <span className="ts-notif-avatar-initial" aria-hidden>{SYSTEM_ICON[n.type]}</span>
                        : n.actorAvatarUrl
                          ? <img src={n.actorAvatarUrl} alt="" width={28} height={28} style={{ borderRadius: '50%' }} />
                          : <span className="ts-notif-avatar-initial">{(n.actorUsername[0] ?? '?').toUpperCase()}</span>
                      }
                    </span>
                    <span className="ts-notif-body">
                      <span className="ts-notif-text">{notifText(n)}</span>
                      <span className="ts-notif-time">{relativeTime(n.createdAt)}</span>
                    </span>
                  </Link>
                )
                return (
                  <li key={n.id} className={`ts-notif-row${n.read ? '' : ' ts-notif-unread'}`}>
                    {n.actorId && !isSystem(n)
                      ? <TraderHoverCard userId={n.actorId} username={n.actorUsername} displayName={null} avatarUrl={n.actorAvatarUrl} wrapClassName="thc-block">{link}</TraderHoverCard>
                      : link}
                  </li>
                )
              })}
```

- [ ] **Step 3: Run the Task 1 e2e — now passes**

Run (from `app/`): `npm run test:e2e -- profile-hover`
Expected: PASS — `.thc-card` appears on hover.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/_components/NotificationBell.tsx
git commit -m "feat(notifications): hover trader card on actor rows"
```

---

### Task 4: `UserLink` — optional `userId` wraps in the card

**Files:**
- Modify: `app/src/app/_components/UserLink.tsx`

**Interfaces:**
- Produces: `UserLink` accepts optional `userId?: string`. When present, its `<Link>` is wrapped in `<TraderHoverCard wrapClassName="thc-inline">`. When absent, output is byte-for-byte the current behavior.

- [ ] **Step 1: Rewrite `UserLink`**

Replace the whole file:

```tsx
import Link from 'next/link'
import { TraderHoverCard } from '@/app/_components/TraderHoverCard'

export function UserLink({ userId, username, displayName, avatarUrl, sub }: {
  userId?: string; username: string; displayName?: string | null; avatarUrl?: string | null; sub?: string
}) {
  const name = displayName || username
  const link = (
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
  if (!userId) return link
  return (
    <TraderHoverCard userId={userId} username={username} displayName={displayName ?? null} avatarUrl={avatarUrl ?? null} wrapClassName="thc-inline">
      {link}
    </TraderHoverCard>
  )
}
```

- [ ] **Step 2: Build check**

Run (from `app/`): `npm run build`
Expected: succeeds (no caller passes `userId` yet; signature is additive).

- [ ] **Step 3: Commit**

```bash
git add app/src/app/_components/UserLink.tsx
git commit -m "feat(userlink): optional userId enables hover trader card"
```

---

### Task 5: Surface comment author `id` and wire `CommentThread`

**Files:**
- Modify: `app/src/app/actions/social.ts` (`CommentItem` type ~line 16, `getComments` map ~line 176)
- Modify: `app/src/app/feed/_components/CommentThread.tsx:37`

**Interfaces:**
- Consumes: `UserLink` `userId` prop (Task 4).
- Produces: `CommentItem.author` gains `id: string`.

- [ ] **Step 1: Add `id` to the `CommentItem` type**

In `social.ts`, change the `CommentItem` author shape:

```tsx
export type CommentItem = {
  id: string; body: string; created_at: string; isOwn: boolean
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null }
}
```

- [ ] **Step 2: Map `author.id` from the already-selected `author_id`**

In `getComments`, the select already includes `author_id`. Update the map body:

```tsx
  return (data ?? []).map((c) => {
    const author = (Array.isArray(c.author) ? c.author[0] : c.author) as { username: string; display_name: string | null; avatar_url: string | null }
    return { id: c.id, body: c.body, created_at: c.created_at, isOwn: c.author_id === user?.id, author: { id: c.author_id, ...author } }
  })
```

- [ ] **Step 3: Pass `userId` in `CommentThread`**

In `CommentThread.tsx` line 37, add the `userId` prop:

```tsx
          <UserLink userId={c.author.id} username={c.author.username} displayName={c.author.display_name} avatarUrl={c.author.avatar_url} />
```

- [ ] **Step 4: Build check**

Run (from `app/`): `npm run build`
Expected: succeeds; `c.author.id` is typed.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/actions/social.ts app/src/app/feed/_components/CommentThread.tsx
git commit -m "feat(comments): hover trader card on comment authors"
```

---

### Task 6: Wrap the sidebar Suggested Traders

**Files:**
- Modify: `app/src/app/_components/SuggestedTraders.tsx`

**Interfaces:**
- Consumes: `TraderHoverCard` with `wrapClassName` (Task 2). `Recommendation` carries `userId`, `username`, `displayName`, `avatarUrl`.

- [ ] **Step 1: Import `TraderHoverCard`**

Add to the imports at the top of `_components/SuggestedTraders.tsx`:

```tsx
import { TraderHoverCard } from '@/app/_components/TraderHoverCard'
```

- [ ] **Step 2: Wrap the avatar + name block**

Replace the two adjacent profile `<Link>`s (avatar link + name link) with a single `TraderHoverCard` containing them:

```tsx
          <div key={r.userId} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <TraderHoverCard userId={r.userId} username={r.username} displayName={r.displayName} avatarUrl={r.avatarUrl} wrapClassName="thc-inline">
              <Link href={`/${r.username}`} style={{ flexShrink: 0 }}>
                <span className="h-av" style={{
                  width: 36, height: 36, display: 'block',
                  ...(r.avatarUrl ? { backgroundImage: `url(${r.avatarUrl})`, backgroundSize: 'cover' } : {}),
                }} />
              </Link>
              <div style={{ minWidth: 0 }}>
                <Link href={`/${r.username}`} style={{ fontWeight: 600, fontSize: 13.5, textDecoration: 'none' }}>
                  {r.displayName || r.username}
                </Link>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <VerificationBadge level={r.verification} short linked={false} />
                </div>
                <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>{r.reasons.join(' · ')}</div>
              </div>
            </TraderHoverCard>
            <FollowButton targetId={r.userId} initialFollowing={false} />
          </div>
```

Note the original outer `<div style={{ minWidth: 0, flex: 1 }}>` loses `flex: 1` because the `TraderHoverCard` (`thc-inline`) is now the flex child; that is intentional — the card wrapper holds the avatar+name and the row still lays out avatar/name/reasons on the left and the follow button on the right.

- [ ] **Step 3: Verify in preview (layout is the risk)**

Start the dev server and open the home feed; confirm the "Suggested for you" rows are unchanged visually and hovering a row opens `.thc-card`. Then:

Run (from `app/`): `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/_components/SuggestedTraders.tsx
git commit -m "feat(suggested): hover trader card on sidebar recommendations"
```

---

### Task 7: Wrap the leaderboard Podium (skip self)

**Files:**
- Modify: `app/src/app/leaderboard/_components/Podium.tsx`

**Interfaces:**
- Consumes: `TraderHoverCard` with `wrapClassName="thc-stack"` (Task 2). `BoardRow` carries `userId`, `username`, `displayName`, `avatarUrl`.

- [ ] **Step 1: Import `TraderHoverCard`**

Add to the imports at the top of `Podium.tsx`:

```tsx
import { TraderHoverCard } from '@/app/_components/TraderHoverCard'
```

- [ ] **Step 2: Wrap avatar + name + handle in a column stack**

Inside the `SLOTS.map` return, wrap the existing `av-wrap` div, `name` div, and `handle` div in a `TraderHoverCard` when the row is not the viewer. Extract the trio into a local variable to avoid duplicating markup:

```tsx
        const idBlock = (
          <>
            <div className="av-wrap">
              {tier === 1 && (
                <span className="crown" aria-label="1st place">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden>
                    <path d="M2 7l4.5 3.8L12 4l5.5 6.8L22 7l-1.8 11.2H3.8L2 7zm3 13.5h14v1.5H5v-1.5z" />
                  </svg>
                </span>
              )}
              <Avatar src={t.avatarUrl} name={t.displayName || t.username} size={tier === 1 ? 80 : 64} ring />
            </div>
            <div className="name">{t.displayName || t.username}{self && <span className="lb-you">You</span>}</div>
            <div className="handle">@{t.username}</div>
          </>
        )
        return (
          <div key={t.userId} className={`lb-pod t${tier}`}>
            <span className="cap" />
            {tier !== 1 && <span className={`lb-rk g${tier} rankbadge`}>{t.rank}</span>}
            {self
              ? idBlock
              : <TraderHoverCard userId={t.userId} username={t.username} displayName={t.displayName} avatarUrl={t.avatarUrl} wrapClassName="thc-stack">{idBlock}</TraderHoverCard>}
            {kind === 'xp'
```

Leave the rest of the return (the `pl`, `pod-stats`, `pod-btn` blocks) exactly as-is.

- [ ] **Step 3: Verify in preview + build**

Open `/leaderboard`; confirm the podium looks identical and hovering a non-self podium avatar opens `.thc-card`.

Run (from `app/`): `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/leaderboard/_components/Podium.tsx
git commit -m "feat(podium): hover trader card on top-3 (skip self)"
```

---

### Task 8: Wrap the rail "Trader of the week" (skip self)

**Files:**
- Modify: `app/src/app/feed/_components/home/rail.tsx` (`TraderOfWeek`, ~lines 24-54)

**Interfaces:**
- Consumes: `TraderHoverCard` (already imported in this file). `HomeLeader` carries `userId`, `username`, `displayName`, `avatarUrl`.

- [ ] **Step 1: Wrap the `who` block**

In `TraderOfWeek`, extract the existing `<div className="who"> ... </div>` (avatar medal + text) into a local variable, then wrap it in `TraderHoverCard` unless `isSelf` (mirrors the Podium extraction pattern in Task 7):

```tsx
  const whoBlock = (
    <div className="who">
      <span className="av-medal">
        <Avatar seed={leader.username} src={leader.avatarUrl} name={leader.displayName || leader.username} size={62} ring />
        <span className="badge"><Icon name="crown" size={12} /></span>
      </span>
      <div className="txt">
        <b>@{leader.username}</b>
        <span>{(leader.displayName || leader.username)} · #1 this week</span>
      </div>
    </div>
  )
```

Then in the returned JSX, replace the original `<div className="who">…</div>` with:

```tsx
        {isSelf
          ? whoBlock
          : <TraderHoverCard userId={leader.userId} username={leader.username} displayName={leader.displayName} avatarUrl={leader.avatarUrl} wrapClassName="thc-inline">{whoBlock}</TraderHoverCard>}
```

- [ ] **Step 2: Verify in preview + build**

Open the home feed; confirm the Trader-of-week block is visually unchanged and hovering it (when the featured trader is not you) opens `.thc-card`.

Run (from `app/`): `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/feed/_components/home/rail.tsx
git commit -m "feat(rail): hover trader card on trader-of-the-week (skip self)"
```

---

### Task 9: Surface search result `id` and wrap nav-search trader rows

**Files:**
- Modify: `app/src/lib/search.ts` (`UserResult` type)
- Modify: `app/src/app/actions/search.ts` (profiles select + map)
- Modify: `app/src/app/_components/NavSearch.tsx` (Traders rows)

**Interfaces:**
- Consumes: `TraderHoverCard` with `wrapClassName="thc-block"` (Task 2).
- Produces: `UserResult` gains `id: string`.

- [ ] **Step 1: Add `id` to `UserResult`**

In `lib/search.ts`:

```ts
export type UserResult = {
  id: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  bio: string | null
}
```

- [ ] **Step 2: Select + map `id` in the search action**

In `actions/search.ts`, add `id` to the profiles select and the map:

```ts
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio')
      .eq('is_public', true)
      .or(`username.ilike.${like},display_name.ilike.${like}`)
      .limit(5),
```

```ts
  const users: UserResult[] = (usersRes.data ?? []).map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name ?? null,
    avatarUrl: u.avatar_url ?? null,
    bio: u.bio ?? null,
  }))
```

- [ ] **Step 3: Wrap the trader rows in `NavSearch`**

Import `TraderHoverCard` at the top of `NavSearch.tsx`:

```tsx
import { TraderHoverCard } from '@/app/_components/TraderHoverCard'
```

Wrap each Traders-section row `<Link>` (the `results.users.map` body). The `<Link>` markup is unchanged; only the wrapper is added:

```tsx
                    {results.users.map((u) => (
                      <li key={u.username}>
                        <TraderHoverCard userId={u.id} username={u.username} displayName={u.displayName} avatarUrl={u.avatarUrl} wrapClassName="thc-block">
                          <Link href={`/${u.username}`} className="ts-search-row" onClick={() => setOpen(false)}>
                            <span className="ts-search-avatar">
                              {u.avatarUrl
                                ? <img src={u.avatarUrl} alt="" width={28} height={28} style={{ borderRadius: '50%' }} />
                                : <span className="ts-search-avatar-initial">{(u.username[0] ?? '?').toUpperCase()}</span>}
                            </span>
                            <span className="ts-search-body">
                              <span className="ts-search-name">{u.displayName ?? u.username}</span>
                              <span className="ts-search-sub">@{u.username}</span>
                            </span>
                          </Link>
                        </TraderHoverCard>
                      </li>
                    ))}
```

Leave the Posts section unchanged (out of scope).

- [ ] **Step 4: Build check + preview**

Run (from `app/`): `npm run build`
Expected: succeeds. In preview, type ≥2 chars in nav search; confirm trader rows still render and hovering one opens `.thc-card`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/search.ts app/src/app/actions/search.ts app/src/app/_components/NavSearch.tsx
git commit -m "feat(search): hover trader card on nav-search trader results"
```

---

### Task 10: Full regression pass

**Files:** none (verification only).

- [ ] **Step 1: Run unit + e2e suites**

Run (from `app/`):
```bash
npm test
npm run test:e2e
```
Expected: all pass, including `profile-hover` and `leaderboard`.

- [ ] **Step 2: Manual preview sweep**

Confirm the card opens and layout is intact on each live surface: comment authors, sidebar Suggested, Podium (non-self), Trader-of-week (non-self), notification actor rows, nav-search trader rows. Confirm system notifications (e.g. weekly review) show **no** card.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "test: verify hover cards across all live profile surfaces"
```

---

## Self-Review

**Spec coverage:**
- TraderHoverCard prop + CSS helpers → Task 2. ✓
- UserLink userId → Task 4. ✓
- CommentThread → Task 5. ✓
- Sidebar SuggestedTraders → Task 6. ✓
- Podium → Task 7. ✓
- rail Trader-of-week → Task 8. ✓
- NotificationBell (actorId gate) → Task 3. ✓
- NavSearch + search data (`id`) → Task 9. ✓
- Comment data (`id`) → Task 5. ✓
- Self-skip (Podium, rail) → Tasks 7, 8. ✓
- Dead code untouched → Global Constraints. ✓
- Testing (e2e + leaderboard regression) → Tasks 1, 3, 10. ✓

**Type consistency:** `wrapClassName` name is identical across Tasks 2/3/4/6/7/8/9. `CommentItem.author.id` (Task 5) matches `c.author.id` usage. `UserResult.id` (Task 9) matches `u.id` usage. `HomeLeader.userId` / `BoardRow.userId` / `Recommendation.userId` used verbatim.

**Placeholder scan:** none — every code step shows full content; the one dynamic-href note in Task 1 resolves to the committed simpler assertion.
