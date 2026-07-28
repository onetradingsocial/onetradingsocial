# Admin Comp-Tier Grants + User Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin grant any user a comped Trader/Pro tier (feature access without paying, no admin rights), managed from a new admin user-directory + per-user detail page.

**Architecture:** A nullable `comp_tier` column on `profiles` is the source of truth. `getTier()` combines it with the Stripe-derived tier by taking the higher rank (comp never demotes a payer, never grants admin access). A security-definer SQL function `admin_search_users` powers a paginated, searchable admin directory (email lives in `auth.users`, unreachable via PostgREST). A `setCompTier` server action writes the column and audits the change.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase (Postgres + service-role client), Vitest.

## Global Constraints

- Supabase migrations are plain SQL files in `app/supabase/migrations/NNNN_name.sql`, applied in order. Next number is **0039**.
- Admin pages/actions MUST gate with `requireAdmin()` from `@/lib/server/admin` and use `createServiceClient()` from `@/lib/supabase/service` for privileged reads/writes.
- Every privileged mutation MUST call `logAdminAction(admin, action, { type, id }, detail)` from `@/lib/server/admin-audit`.
- Valid tiers are exactly `'free' | 'trader' | 'pro'` (`Tier` in `@/lib/entitlements`). Comp values are only `'trader' | 'pro'` (or `null` = no comp).
- Admin status is governed ONLY by `ADMIN_EMAILS` (`emailIsAdmin` / `parseAdminEmails` in `@/lib/admin`). Comp tier MUST NOT affect admin access.
- Tests run with Vitest: `cd app && npx vitest run <path>`.

---

## File Structure

- `app/supabase/migrations/0039_comp_tier.sql` (new) — `comp_tier` column + `admin_search_users` function.
- `app/src/lib/entitlements.ts` (modify) — pure helpers `higherTier`, `normalizeCompTier`.
- `app/src/lib/server/entitlements.ts` (modify) — `getTier` reads `comp_tier` and combines.
- `app/src/lib/admin-users.ts` (new) — pure `userTierSummary` helper (effective tier + source label).
- `app/src/app/actions/admin.ts` (modify) — `setCompTier` server action.
- `app/src/app/admin/audit/page.tsx` (modify) — audit labels for the new actions.
- `app/src/app/admin/layout.tsx` (modify) — nav entry for the directory.
- `app/src/app/admin/users/page.tsx` (new) — searchable, paginated directory.
- `app/src/app/admin/users/[id]/page.tsx` (new) — per-user detail + comp control.
- `app/src/app/admin/users/_components/CompTierControl.tsx` (new) — client control.
- `app/tests/unit/entitlements.test.ts` (modify) — helper tests.
- `app/tests/unit/admin-users.test.ts` (new) — `userTierSummary` tests.

---

## Task 1: Migration — `comp_tier` column + `admin_search_users` function

**Files:**
- Create: `app/supabase/migrations/0039_comp_tier.sql`

**Interfaces:**
- Produces: `profiles.comp_tier text` (nullable, `check in ('trader','pro')`); SQL function `admin_search_users(term text, lim int, off int)` returning rows `(id uuid, username text, display_name text, email text, created_at timestamptz, comp_tier text, sub_tier text, sub_status text)`, newest-first, filtered by substring when `term` is non-empty.

- [ ] **Step 1: Write the migration file**

Create `app/supabase/migrations/0039_comp_tier.sql`:

```sql
-- Comp-tier grants: admins can grant a user Trader/Pro features without payment.
-- Independent of Stripe; never grants admin access (that's ADMIN_EMAILS only).
alter table public.profiles
  add column if not exists comp_tier text
  check (comp_tier in ('trader', 'pro'));

comment on column public.profiles.comp_tier is
  'Admin-granted comp tier (trader|pro). NULL = none. Combined with Stripe tier by higher rank in getTier().';

-- Admin user directory. Email lives in auth.users (unreachable via PostgREST),
-- so this security-definer function joins it in. Returns the highest
-- active/trialing subscription tier alongside the comp grant.
-- Service-role only: execute is revoked from all client roles.
create or replace function public.admin_search_users(term text, lim int, off int)
returns table (
  id uuid,
  username text,
  display_name text,
  email text,
  created_at timestamptz,
  comp_tier text,
  sub_tier text,
  sub_status text
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.username::text,
    p.display_name,
    u.email::text,
    p.created_at,
    p.comp_tier,
    s.tier as sub_tier,
    s.status as sub_status
  from public.profiles p
  join auth.users u on u.id = p.id
  left join lateral (
    select tier, status
    from public.subscriptions
    where user_id = p.id and status in ('active', 'trialing')
    order by case tier when 'pro' then 2 when 'trader' then 1 else 0 end desc
    limit 1
  ) s on true
  where coalesce(term, '') = ''
     or u.email ilike '%' || term || '%'
     or p.username ilike '%' || term || '%'
     or coalesce(p.display_name, '') ilike '%' || term || '%'
  order by p.created_at desc
  limit lim offset off
$$;

revoke all on function public.admin_search_users(text, int, int) from public, anon, authenticated;
```

- [ ] **Step 2: Apply to the dev database and verify**

Apply the migration to the dev Supabase project (same workflow used for prior migrations — via the Supabase SQL editor or CLI against the dev project, NOT prod). Then verify with:

```sql
-- Column exists and is constrained:
select column_name, data_type from information_schema.columns
  where table_name = 'profiles' and column_name = 'comp_tier';
-- Function runs and returns newest-first:
select id, username, email, comp_tier, sub_tier from public.admin_search_users('', 5, 0);
-- Substring search works:
select username, email from public.admin_search_users('user', 10, 0);
```

Expected: `comp_tier` row returned (`text`); both selects return rows without error; the search filters.

> **Human step (per repo practice, like migration 0037):** applying `0039` to the dev DB — and later prod — is done by a human with DB access. Note this in the handoff.

- [ ] **Step 3: Commit**

```bash
git add app/supabase/migrations/0039_comp_tier.sql
git commit -m "feat(admin): add comp_tier column + admin_search_users function"
```

---

## Task 2: Pure tier-combination helpers

**Files:**
- Modify: `app/src/lib/entitlements.ts`
- Test: `app/tests/unit/entitlements.test.ts`

**Interfaces:**
- Consumes: `Tier`, `TIER_RANK` (already exported from this file).
- Produces: `higherTier(a: Tier, b: Tier): Tier` — returns whichever tier has the higher rank. `normalizeCompTier(v: string | null | undefined): Tier` — `'trader'`/`'pro'` pass through, everything else → `'free'`.

- [ ] **Step 1: Write the failing tests**

Append to `app/tests/unit/entitlements.test.ts` (add `higherTier, normalizeCompTier` to the existing import from `@/lib/entitlements`):

```ts
describe('higherTier', () => {
  it('returns the higher-ranked tier regardless of order', () => {
    expect(higherTier('free', 'pro')).toBe('pro')
    expect(higherTier('pro', 'free')).toBe('pro')
    expect(higherTier('trader', 'pro')).toBe('pro')
    expect(higherTier('trader', 'free')).toBe('trader')
    expect(higherTier('free', 'free')).toBe('free')
  })
})

describe('normalizeCompTier', () => {
  it('passes through valid comp tiers', () => {
    expect(normalizeCompTier('trader')).toBe('trader')
    expect(normalizeCompTier('pro')).toBe('pro')
  })
  it('maps null/empty/invalid to free', () => {
    expect(normalizeCompTier(null)).toBe('free')
    expect(normalizeCompTier(undefined)).toBe('free')
    expect(normalizeCompTier('free')).toBe('free')
    expect(normalizeCompTier('gold')).toBe('free')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/entitlements.test.ts`
Expected: FAIL — `higherTier`/`normalizeCompTier` is not exported.

- [ ] **Step 3: Add the helpers**

Append to `app/src/lib/entitlements.ts` (after `tierFromSubscriptions`):

```ts
/** The higher-ranked of two tiers (used to combine comp grants with Stripe subs). */
export function higherTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}

/** A stored comp_tier value → Tier. Anything but 'trader'/'pro' means no comp. */
export function normalizeCompTier(v: string | null | undefined): Tier {
  return v === 'trader' || v === 'pro' ? v : 'free'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/entitlements.test.ts`
Expected: PASS (all suites in the file).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/entitlements.ts app/tests/unit/entitlements.test.ts
git commit -m "feat(entitlements): add higherTier + normalizeCompTier helpers"
```

---

## Task 3: Wire `getTier` to honor comp_tier

**Files:**
- Modify: `app/src/lib/server/entitlements.ts`

**Interfaces:**
- Consumes: `higherTier`, `normalizeCompTier`, `tierFromSubscriptions` (from `@/lib/entitlements`); `createServiceClient`.
- Produces: unchanged `getTier(supabase, userId): Promise<Tier>` signature; behavior now folds in `comp_tier`.

- [ ] **Step 1: Update the import**

In `app/src/lib/server/entitlements.ts`, change the entitlements import to include the new helpers:

```ts
import {
  tierFromSubscriptions, higherTier, normalizeCompTier, TIER_RANK, type Tier,
} from '@/lib/entitlements'
```

- [ ] **Step 2: Rewrite the body of `getTier`**

Replace the current `getTier` function body (lines ~13-23) with:

```ts
export async function getTier(supabase: SupabaseClient, userId: string): Promise<Tier> {
  const svc = createServiceClient()
  const { data: { user } } = await svc.auth.admin.getUserById(userId)
  if (user && emailIsAdmin(user.email, parseAdminEmails(process.env.ADMIN_EMAILS))) {
    return 'pro'
  }

  const [{ data: prof }, { data: subs, error }] = await Promise.all([
    svc.from('profiles').select('comp_tier').eq('id', userId).maybeSingle(),
    supabase.from('subscriptions').select('tier, status').eq('user_id', userId),
  ])

  const stripeTier: Tier = error || !subs ? 'free' : tierFromSubscriptions(subs)
  return higherTier(normalizeCompTier(prof?.comp_tier), stripeTier)
}
```

(The doc comment above `getTier` stays; the admin bypass and fail-closed-to-free behavior are preserved — a comp grant can only raise the tier.)

- [ ] **Step 3: Verify the unit suite and typecheck still pass**

Run: `cd app && npx vitest run tests/unit/entitlements.test.ts && npx tsc --noEmit`
Expected: PASS / no type errors. (`getTier` has no direct unit test — it needs Supabase — so this guards the pure deps and types.)

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/server/entitlements.ts
git commit -m "feat(entitlements): getTier honors admin-granted comp_tier"
```

---

## Task 4: `setCompTier` server action + audit labels

**Files:**
- Modify: `app/src/app/actions/admin.ts`
- Modify: `app/src/app/admin/audit/page.tsx`

**Interfaces:**
- Consumes: `requireAdmin`, `createServiceClient`, `logAdminAction`, `revalidatePath`.
- Produces: `setCompTier(userId: string, tier: 'trader' | 'pro' | null): Promise<{ error?: string }>`.

- [ ] **Step 1: Add the action**

Append to `app/src/app/actions/admin.ts`:

```ts
const COMP_TIERS = new Set(['trader', 'pro'])

export async function setCompTier(
  userId: string,
  tier: 'trader' | 'pro' | null,
): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  if (tier !== null && !COMP_TIERS.has(tier)) return { error: 'Invalid tier.' }
  const svc = createServiceClient()
  const { error } = await svc.from('profiles').update({ comp_tier: tier }).eq('id', userId)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(
    admin,
    tier ? 'user.comp_tier.set' : 'user.comp_tier.clear',
    { type: 'user', id: userId },
    { tier },
  )
  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  return {}
}
```

- [ ] **Step 2: Add audit labels**

In `app/src/app/admin/audit/page.tsx`, add to the `LABEL` map:

```ts
  'user.comp_tier.set': 'Comp tier granted',
  'user.comp_tier.clear': 'Comp tier removed',
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/actions/admin.ts app/src/app/admin/audit/page.tsx
git commit -m "feat(admin): setCompTier action + audit labels"
```

---

## Task 5: `userTierSummary` helper + directory page + nav

**Files:**
- Create: `app/src/lib/admin-users.ts`
- Create: `app/src/app/admin/users/page.tsx`
- Modify: `app/src/app/admin/layout.tsx`
- Test: `app/tests/unit/admin-users.test.ts`

**Interfaces:**
- Consumes: `Tier`, `higherTier`, `normalizeCompTier` (`@/lib/entitlements`); `tierFromSubscriptions` is NOT used here (the RPC already resolved a single sub tier/status). `emailIsAdmin`, `parseAdminEmails` (`@/lib/admin`). Row shape from `admin_search_users`.
- Produces: `type TierSource = 'Admin' | 'Comp' | 'Paid' | 'Free'`; `userTierSummary(input): { tier: Tier; source: TierSource }`.

- [ ] **Step 1: Write the failing tests**

Create `app/tests/unit/admin-users.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { userTierSummary } from '@/lib/admin-users'

const ADMINS = ['boss@x.com']

describe('userTierSummary', () => {
  it('admin email always resolves to pro/Admin', () => {
    expect(userTierSummary({ email: 'boss@x.com', compTier: null, subTier: null, subStatus: null, adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Admin' })
  })
  it('comp tier shows as Comp when no higher paid tier', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: 'pro', subTier: null, subStatus: null, adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Comp' })
  })
  it('active paid sub shows as Paid', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: null, subTier: 'trader', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'trader', source: 'Paid' })
  })
  it('higher paid tier wins over lower comp, source is Paid', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: 'trader', subTier: 'pro', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Paid' })
  })
  it('comp wins over lower paid tier, source is Comp', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: 'pro', subTier: 'trader', subStatus: 'active', adminEmails: ADMINS }))
      .toEqual({ tier: 'pro', source: 'Comp' })
  })
  it('no comp, no sub → free/Free', () => {
    expect(userTierSummary({ email: 'a@x.com', compTier: null, subTier: null, subStatus: null, adminEmails: ADMINS }))
      .toEqual({ tier: 'free', source: 'Free' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/admin-users.test.ts`
Expected: FAIL — module `@/lib/admin-users` not found.

- [ ] **Step 3: Write the helper**

Create `app/src/lib/admin-users.ts`:

```ts
import { higherTier, normalizeCompTier, type Tier } from '@/lib/entitlements'
import { emailIsAdmin } from '@/lib/admin'

export type TierSource = 'Admin' | 'Comp' | 'Paid' | 'Free'

const ACTIVE = new Set(['active', 'trialing'])

export function userTierSummary(input: {
  email: string | null
  compTier: string | null
  subTier: string | null
  subStatus: string | null
  adminEmails: string[]
}): { tier: Tier; source: TierSource } {
  if (emailIsAdmin(input.email, input.adminEmails)) return { tier: 'pro', source: 'Admin' }

  const comp = normalizeCompTier(input.compTier)
  const paid: Tier =
    input.subStatus && ACTIVE.has(input.subStatus) && (input.subTier === 'trader' || input.subTier === 'pro')
      ? input.subTier
      : 'free'

  const tier = higherTier(comp, paid)
  if (tier === 'free') return { tier, source: 'Free' }
  // Whichever grant actually reaches the effective tier names the source; comp wins ties.
  const source: TierSource = comp === tier ? 'Comp' : 'Paid'
  return { tier, source }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/admin-users.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the directory page**

Create `app/src/app/admin/users/page.tsx`:

```tsx
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { parseAdminEmails } from '@/lib/admin'
import { userTierSummary } from '@/lib/admin-users'
import { Empty, PageHead, Panel, When } from '../_components/ui'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

type Row = {
  id: string
  username: string
  display_name: string | null
  email: string | null
  created_at: string
  comp_tier: string | null
  sub_tier: string | null
  sub_status: string | null
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const { q = '', page = '1' } = await searchParams
  const term = q.trim()
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1)
  const offset = (pageNum - 1) * PAGE_SIZE

  const svc = createServiceClient()
  // Fetch one extra row to detect whether a next page exists.
  const { data, error } = await svc.rpc('admin_search_users', {
    term,
    lim: PAGE_SIZE + 1,
    off: offset,
  })
  const rows = ((data ?? []) as Row[]).slice(0, PAGE_SIZE)
  const hasNext = (data ?? []).length > PAGE_SIZE
  const admins = parseAdminEmails(process.env.ADMIN_EMAILS)

  const qs = (p: number) => {
    const s = new URLSearchParams()
    if (term) s.set('q', term)
    if (p > 1) s.set('page', String(p))
    const str = s.toString()
    return str ? `/admin/users?${str}` : '/admin/users'
  }

  return (
    <>
      <PageHead
        title="Users"
        sub="Search the directory and grant comped Trader/Pro access. Comp grants unlock features only — never admin access."
      />

      <form method="get" style={{ margin: '0 0 16px' }}>
        <input
          type="search"
          name="q"
          defaultValue={term}
          placeholder="Search email, username, or display name…"
          className="ts-input"
          style={{ width: '100%', maxWidth: 420 }}
          aria-label="Search users"
        />
      </form>

      <Panel title={term ? `Results for “${term}”` : 'All users'} flush scroll>
        {error ? (
          <Empty>Search failed. Confirm migration 0039 is applied.</Empty>
        ) : rows.length === 0 ? (
          <Empty>No users match.</Empty>
        ) : (
          <table className="ts-table">
            <thead><tr><th>User</th><th>Email</th><th>Tier</th><th>Source</th><th>Joined</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const { tier, source } = userTierSummary({
                  email: r.email,
                  compTier: r.comp_tier,
                  subTier: r.sub_tier,
                  subStatus: r.sub_status,
                  adminEmails: admins,
                })
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/admin/users/${r.id}`} className="ad-kv">{r.username}</Link>
                      {r.display_name && <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>{r.display_name}</span>}
                    </td>
                    <td style={{ fontSize: 13 }}>{r.email ?? '—'}</td>
                    <td><span className="v-badge">{tier}</span></td>
                    <td className="faint" style={{ fontSize: 12 }}>{source}</td>
                    <td><When iso={r.created_at} short /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
        {pageNum > 1
          ? <Link className="ad-kv" href={qs(pageNum - 1)}>← Prev</Link>
          : <span className="faint" style={{ fontSize: 13 }}>← Prev</span>}
        <span className="faint" style={{ fontSize: 13 }}>Page {pageNum}</span>
        {hasNext
          ? <Link className="ad-kv" href={qs(pageNum + 1)}>Next →</Link>
          : <span className="faint" style={{ fontSize: 13 }}>Next →</span>}
      </div>
    </>
  )
}
```

> If `.ts-input` is not an existing class, fall back to `className="ad-input"` or an inline-styled input — check `app/src/app/globals.css` (or the admin stylesheet) for the input class already used by admin forms and match it. Verify during the browser check in Task 6.

- [ ] **Step 6: Add the nav entry**

In `app/src/app/admin/layout.tsx`, add to the top of the `'Users'` group's `items` array (before `Feedback`):

```ts
      { href: '/admin/users', label: 'Directory' },
```

- [ ] **Step 7: Typecheck + tests**

Run: `cd app && npx tsc --noEmit && npx vitest run tests/unit/admin-users.test.ts`
Expected: no type errors; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/admin-users.ts app/src/app/admin/users/page.tsx app/src/app/admin/layout.tsx app/tests/unit/admin-users.test.ts
git commit -m "feat(admin): user directory page + tier-source helper"
```

---

## Task 6: User detail page + `CompTierControl`

**Files:**
- Create: `app/src/app/admin/users/[id]/page.tsx`
- Create: `app/src/app/admin/users/_components/CompTierControl.tsx`

**Interfaces:**
- Consumes: `setCompTier` (`@/app/actions/admin`); `getSubscription` (`@/lib/server/entitlements`); `createServiceClient`; `parseAdminEmails`; `userTierSummary`.
- Produces: detail route rendering profile summary + comp control.

- [ ] **Step 1: Write the client control**

Create `app/src/app/admin/users/_components/CompTierControl.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setCompTier } from '@/app/actions/admin'

type Comp = 'trader' | 'pro' | null
const OPTIONS: { value: Comp; label: string }[] = [
  { value: null, label: 'None' },
  { value: 'trader', label: 'Trader' },
  { value: 'pro', label: 'Pro' },
]

export function CompTierControl({ userId, current }: { userId: string; current: Comp }) {
  const [value, setValue] = useState<Comp>(current)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  function choose(next: Comp) {
    if (next === value || pending) return
    setErr(null)
    const prev = value
    setValue(next)
    start(async () => {
      const res = await setCompTier(userId, next)
      if (res.error) {
        setValue(prev)
        setErr(res.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div>
      <div role="group" aria-label="Comp tier" style={{ display: 'inline-flex', gap: 6 }}>
        {OPTIONS.map((o) => (
          <button
            key={o.label}
            type="button"
            className="v-badge"
            aria-pressed={value === o.value}
            disabled={pending}
            onClick={() => choose(o.value)}
            style={{
              cursor: pending ? 'wait' : 'pointer',
              opacity: value === o.value ? 1 : 0.55,
              fontWeight: value === o.value ? 700 : 400,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {err && <p className="faint" style={{ color: 'var(--danger, #c0392b)', fontSize: 12, marginTop: 6 }}>{err}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Write the detail page**

Create `app/src/app/admin/users/[id]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { parseAdminEmails } from '@/lib/admin'
import { userTierSummary } from '@/lib/admin-users'
import { PageHead, Section, Stat, Stats } from '../../_components/ui'
import { CompTierControl } from '../_components/CompTierControl'

export const dynamic = 'force-dynamic'

export default async function AdminUserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const svc = createServiceClient()

  const [{ data: prof }, { data: authRes }] = await Promise.all([
    svc.from('profiles').select('username, display_name, comp_tier, created_at').eq('id', id).maybeSingle(),
    svc.auth.admin.getUserById(id),
  ])
  if (!prof) notFound()

  const [{ count: trades }, { count: referrals }, { data: subs }] = await Promise.all([
    svc.from('trades').select('id', { count: 'exact', head: true }).eq('user_id', id),
    svc.from('referrals').select('referrer_id', { count: 'exact', head: true }).eq('referrer_id', id),
    svc.from('subscriptions').select('tier, status').eq('user_id', id),
  ])

  const email = authRes.user?.email ?? null
  // Highest active/trialing sub, mirroring admin_search_users ordering.
  const active = (subs ?? []).filter((s) => s.status === 'active' || s.status === 'trialing')
  const best = active.sort((a, b) => (b.tier === 'pro' ? 1 : 0) - (a.tier === 'pro' ? 1 : 0))[0] ?? null

  const { tier, source } = userTierSummary({
    email,
    compTier: prof.comp_tier,
    subTier: best?.tier ?? null,
    subStatus: best?.status ?? null,
    adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS),
  })

  const comp = prof.comp_tier === 'trader' || prof.comp_tier === 'pro' ? prof.comp_tier : null

  return (
    <>
      <PageHead
        title={prof.username}
        sub={email ?? undefined}
        right={<Link className="ad-kv" href="/admin/users">← Directory</Link>}
      />

      <Stats>
        <Stat label="Effective tier" value={tier} sub={`via ${source}`} tone="accent" />
        <Stat label="Trades logged" value={trades ?? 0} />
        <Stat label="Referrals" value={referrals ?? 0} />
        <Stat label="Subscription" value={best ? best.status : 'none'} />
      </Stats>

      <Section title="Comp tier" sub="Grants Trader/Pro features without payment. Takes effect on the user's next page load. Does not grant admin access.">
        <CompTierControl userId={id} current={comp} />
      </Section>

      <Section title="Profile">
        <div className="ad-kv" style={{ fontSize: 13, lineHeight: 1.9 }}>
          <div>Display name: {prof.display_name ?? '—'}</div>
          <div>Joined: {new Date(prof.created_at).toLocaleString()}</div>
          <div>User ID: {id}</div>
        </div>
      </Section>
    </>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Browser verification**

Start the dev server (via `preview_start` with the project's launch config) and, signed in as an admin:
1. Navigate to `/admin/users` — confirm the directory renders, search filters, pagination works, and the input styling matches other admin inputs (fix the input class per the Task 5 note if it looks unstyled).
2. Click a user → `/admin/users/[id]` — confirm the summary stats, subscription status, and comp control render.
3. Set the user to **Pro**, confirm no error and the "Effective tier" stat updates to `pro / via Comp` after refresh. Check `/admin/audit` shows "Comp tier granted".
4. Set back to **None** and confirm it clears.

Capture a screenshot of the detail page for the handoff.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/admin/users/
git commit -m "feat(admin): per-user detail page with comp-tier control"
```

---

## Self-Review Notes

- **Spec coverage:** §1 data model → Task 1. §2 getTier → Tasks 2–3. §3 setCompTier + caveat → Task 4 (caveat surfaced in the detail page copy, Task 6). §4 UI (list, detail option-B fields, nav, source logic) → Tasks 5–6. §5 testing → Tasks 2 & 5 unit tests + Task 6 browser check. All covered.
- **Source logic** lives in the pure `userTierSummary` (Task 5) and is reused by both the list and detail pages — DRY, and the only place tier+source is computed for display.
- **Type consistency:** `admin_search_users` return columns (Task 1) match the `Row` type and RPC call in Task 5; `setCompTier` signature (Task 4) matches its consumers in the `CompTierControl` (Task 6). `higherTier`/`normalizeCompTier` (Task 2) are consumed by Task 3 and Task 5 with the signatures defined.
- **Open verification item:** the admin input class name (`.ts-input`) is assumed from the search box; Task 5 flags confirming it against the actual admin stylesheet during Task 6's browser check.
```
