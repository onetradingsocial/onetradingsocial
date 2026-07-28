# Admin comp-tier grants + user management — Design

**Date:** 2026-07-28
**Status:** Approved design, pending implementation plan

## Goal

Let an admin grant a user a "comped" **Trader** or **Pro** tier from the admin panel — Pro/Trader
feature access without paying, independent of Stripe. Add a **user-management** surface to the admin
side (search + browsable list + per-user detail) where these grants are made.

Requirements captured during brainstorming:

- **Simple override** (option A): admin sets a user's tier to `trader`/`pro` or clears it. Never
  expires until changed. No time limit, no fake Stripe subscription record.
- Comped users are **NOT** tagged as admin. They get gated *features* only — never admin-panel
  access. Admin access remains governed solely by `ADMIN_EMAILS`.
- User-management page scope = **option B**: comp control **plus** a light read-only "who is this
  user" profile view.
- Finding users = **option B**: a browsable, paginated list of all users (newest first) **plus** a
  search box.

## Background (current state)

- Effective tier funnels through one function: `getTier()` in
  `app/src/lib/server/entitlements.ts`. Today it: (1) returns `pro` if the user's email is in
  `ADMIN_EMAILS`; (2) otherwise reads the `subscriptions` Stripe mirror and computes the highest
  active/trialing tier via `tierFromSubscriptions()` (`app/src/lib/entitlements.ts`).
- `profiles` (migration `0001_profiles.sql`) has `username` (citext unique), `display_name`,
  `created_at` — but **no email**. Email lives in `auth.users`, which the PostgREST service client
  cannot query directly.
- Admin server actions live in `app/src/app/actions/admin.ts`, all following the pattern:
  `requireAdmin()` → validate → service-client write → `logAdminAction()` → `revalidatePath()`.
- Admin audit helper: `logAdminAction(admin, action, target, meta)` in
  `app/src/lib/server/admin-audit.ts`.
- Next migration number: **0039** (latest applied is `0038_exchange_symbols.sql`).

## Design

### 1. Data model — migration `0039_comp_tier.sql`

- `alter table public.profiles add column comp_tier text check (comp_tier in ('trader','pro'));`
  Nullable. `null` = no comp grant.
- Security-definer function `admin_search_users(term text, lim int, off int)`:
  - Joins `auth.users` (`email`, `created_at`) with `public.profiles`
    (`id`, `username`, `display_name`, `comp_tier`).
  - Also resolves the effective **subscription** tier/status for each row (highest active/trialing
    row from `subscriptions`), so the list can show tier + source without N extra round-trips.
  - `term` empty → newest-first list (paginated by `lim`/`off`) for browsing.
  - `term` set → case-insensitive substring match on email / username / display_name.
  - `security definer`, `set search_path = public`. `revoke execute ... from public, authenticated;`
    Only the service role (used by admin pages) invokes it.
  - Returns: `id, username, display_name, email, created_at, comp_tier, sub_tier, sub_status`.
- Optionally a companion count function or a `count(*)` variant for pagination totals (or fetch
  `lim+1` to detect "has next page" and skip an exact count — decide in the plan; leaning toward
  `lim+1` to keep it cheap).

### 2. Tier resolution — `getTier()` change

Insert one step after the existing admin-email check, before returning:

1. Admin email → `pro` (unchanged).
2. **New:** read the target user's `comp_tier` (service client) alongside the existing
   subscription read.
3. Effective tier = **higher rank** of `comp_tier` and `tierFromSubscriptions(subs)`.
   - Comp never demotes a paying user.
   - A comped user who separately pays for a higher tier keeps the higher one.
4. Fails closed to `free` on any error (unchanged).

Factor the max-rank combination into a small **pure helper** (e.g. `effectiveTier(compTier, subs)`
or reuse rank comparison) so it is unit-testable without a database.

Comp does not affect admin status. `emailIsAdmin` / `ADMIN_EMAILS` remain the only path to
admin-panel access.

### 3. Server action — `setCompTier`

In `app/src/app/actions/admin.ts` (or a focused `admin-users.ts`):

```
setCompTier(userId: string, tier: 'trader' | 'pro' | null): Promise<{ error?: string }>
```

- `requireAdmin()`.
- Validate `tier` is `null` or in `{'trader','pro'}`.
- `update profiles set comp_tier = tier where id = userId`.
- `logAdminAction(admin, tier ? 'user.comp_tier.set' : 'user.comp_tier.clear',
  { type: 'user', id: userId }, { tier })`.
- `revalidatePath('/admin/users')` and the detail path.

**Caveat (documented, not engineered around):** a comp change takes effect on the target user's
**next server render**, not instantly in their already-loaded session. There is no per-user tier
cache tag today and we will not add one. Acceptable for comps.

### 4. Admin UI

**`/admin/users` — list + search** (styled with `app/src/app/admin/_components/ui.tsx` primitives):

- Search box bound to `?q=`; pagination via `?page=`. Both feed `admin_search_users`.
- Table columns: username, display name, email, **effective tier** (badge), **source**
  (Free / Paid / Comp / Admin), signup date. Rows link to the detail page.

**`/admin/users/[id]` — detail (option B "who is this user")**:

- Read-only summary: username, display name, email, signup date, **trade count**,
  **subscription status** (Stripe mirror), **referral count**, effective tier + its source.
- Client component `CompTierControl`: a segmented **None / Trader / Pro** control that calls
  `setCompTier` and refreshes; reflects current comp state.

**Nav:** add a "Users" entry to `app/src/app/admin/_components/AdminNav.tsx`, following existing
items.

**Source-of-tier display logic** (list column + detail field):
admin email → `Admin`; else `comp_tier` set → `Comp`; else active/trialing Stripe sub → `Paid`;
else → `Free`.

### 5. Testing

- **Unit:** cover the new tier-combination helper — comp raises free→pro; comp does not demote a
  higher paid tier; admin still wins; `null` comp = passthrough. Extend the existing
  `app/tests/unit/entitlements.test.ts` suite.
- **Manual/local:** apply `0039` to the dev DB; grant a seeded demo user comp Pro; confirm gated
  features unlock and that the user has **no** admin-panel access.

## Out of scope (future work)

- Time-limited / expiring comps (brainstorm option B for behaviour).
- Full user moderation (ban / suspend / force-verify / delete) — brainstorm option C; deserves its
  own design.
- Reflecting comp grants in the user's own billing/settings UI.

## Files touched

- `app/supabase/migrations/0039_comp_tier.sql` (new)
- `app/src/lib/server/entitlements.ts` (getTier + helper)
- `app/src/lib/entitlements.ts` (pure helper, if placed here for testability)
- `app/src/app/actions/admin.ts` (or new `admin-users.ts`) — `setCompTier`
- `app/src/app/admin/users/page.tsx` (new)
- `app/src/app/admin/users/[id]/page.tsx` (new)
- `app/src/app/admin/users/_components/CompTierControl.tsx` (new)
- `app/src/app/admin/_components/AdminNav.tsx` (nav entry)
- `app/tests/unit/entitlements.test.ts` (extend)
