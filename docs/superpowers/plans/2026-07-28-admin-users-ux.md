# Admin /admin/users UX Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add filters (account type / subscription / comp grant) and fuzzy search to `/admin/users`, and polish the directory + per-user detail pages, within the existing admin design system.

**Architecture:** A new migration extends the `admin_search_users` RPC with filter params, a computed `is_internal`, and pg_trgm fuzzy matching. Pure TS normalizers keep the page from trusting raw query strings. The directory gains a GET-form filter bar and color-coded badges; the detail page gains a test chip + color; `CompTierControl` becomes a real segmented control. New badge CSS lives in `globals.css`.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase Postgres (pg_trgm), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-28-admin-users-ux-design.md`

## Global Constraints

- Migrations are plain SQL at `app/supabase/migrations/NNNN_name.sql`, applied in order. Next number is **0040**.
- The RPC MUST stay `security definer`, `set search_path = public`, execute revoked from `public, anon, authenticated` and granted to `service_role`.
- Admin pages use `createServiceClient()` for privileged reads; the `/admin` route group is already gated by `requireAdmin()` in `layout.tsx`.
- `pg_trgm` is already enabled (migration 0011) with GIN trigram indexes on `profiles.username` and `profiles.display_name`. Do NOT re-create the extension or add an email index.
- Internal predicate is exactly `profiles.is_internal OR email ilike '%@tradingsocial.io'`.
- Reuse existing tokens/classes in `app/src/app/globals.css`: `--violet`/`--violet-br`/`--violet-deep`, `.ts-input`, `.ts-select`, `.ts-seg`, `.faint`, `--dim`, `--surface-2`, `--surface-3`. Do not restyle unrelated admin components.
- Tests: `cd app && npx vitest run <path>`; typecheck `cd app && npx tsc --noEmit`.
- Fuzzy threshold: `word_similarity(...) > 0.3`. Filter defaults: account `real`, sub `any`, comp `any`.

---

## File Structure

- `app/supabase/migrations/0040_admin_users_filters.sql` (new) — drop old RPC, recreate with filters + fuzzy + `is_internal`.
- `app/src/lib/admin-users.ts` (modify) — add `normalizeAccountFilter`, `normalizeSubFilter`, `normalizeCompFilter`, `isInternalRow`.
- `app/tests/unit/admin-users.test.ts` (modify) — test the new helpers.
- `app/src/app/globals.css` (modify) — badge/chip classes.
- `app/src/app/admin/users/page.tsx` (modify) — filter bar, params, badges, test chip.
- `app/src/app/admin/users/[id]/page.tsx` (modify) — test chip, color badges, hierarchy.
- `app/src/app/admin/users/_components/CompTierControl.tsx` (modify) — segmented restyle + saving state.

---

## Task 1: Migration 0040 — filters + fuzzy on `admin_search_users`

**Files:**
- Create: `app/supabase/migrations/0040_admin_users_filters.sql`

**Interfaces:**
- Produces: `admin_search_users(term text, p_account text, p_sub text, p_comp text, lim int, off int)` returning `(id uuid, username text, display_name text, email text, created_at timestamptz, comp_tier text, sub_tier text, sub_status text, is_internal boolean)`.

- [ ] **Step 1: Write the migration file**

Create `app/supabase/migrations/0040_admin_users_filters.sql`:

```sql
-- Admin user directory v2: account/subscription/comp filters + fuzzy search.
-- Signature changes (adds filter params + is_internal column), so drop the old
-- 0039 function first. pg_trgm + trigram indexes on username/display_name
-- already exist (migration 0011).
drop function if exists public.admin_search_users(text, int, int);

create or replace function public.admin_search_users(
  term text,
  p_account text,   -- 'all' | 'real' | 'test'
  p_sub text,       -- 'any' | 'free' | 'trader' | 'pro'
  p_comp text,      -- 'any' | 'comped' | 'not'
  lim int,
  off int
)
returns table (
  id uuid,
  username text,
  display_name text,
  email text,
  created_at timestamptz,
  comp_tier text,
  sub_tier text,
  sub_status text,
  is_internal boolean
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
    s.status as sub_status,
    (p.is_internal or u.email ilike '%@tradingsocial.io') as is_internal
  from public.profiles p
  join auth.users u on u.id = p.id
  left join lateral (
    select tier, status
    from public.subscriptions
    where user_id = p.id and status in ('active', 'trialing')
    order by case tier when 'pro' then 2 when 'trader' then 1 else 0 end desc
    limit 1
  ) s on true
  where
    (
      coalesce(term, '') = ''
      or u.email ilike '%' || term || '%'
      or p.username ilike '%' || term || '%'
      or coalesce(p.display_name, '') ilike '%' || term || '%'
      or word_similarity(term, p.username::text) > 0.3
      or word_similarity(term, coalesce(p.display_name, '')) > 0.3
    )
    and (
      p_account not in ('real', 'test')
      or (p_account = 'test' and (p.is_internal or u.email ilike '%@tradingsocial.io'))
      or (p_account = 'real' and not (p.is_internal or u.email ilike '%@tradingsocial.io'))
    )
    and (
      p_sub not in ('free', 'trader', 'pro')
      or (p_sub = 'free' and s.tier is null)
      or (p_sub = 'trader' and s.tier = 'trader')
      or (p_sub = 'pro' and s.tier = 'pro')
    )
    and (
      p_comp not in ('comped', 'not')
      or (p_comp = 'comped' and p.comp_tier is not null)
      or (p_comp = 'not' and p.comp_tier is null)
    )
  order by
    case when coalesce(term, '') = '' then 0
         else greatest(
           word_similarity(term, p.username::text),
           word_similarity(term, coalesce(p.display_name, ''))
         ) end desc,
    p.created_at desc
  limit lim offset off
$$;

revoke all on function public.admin_search_users(text, text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.admin_search_users(text, text, text, text, int, int) to service_role;
```

- [ ] **Step 2: Sanity-check the SQL shape**

This task cannot apply the migration (no DB access in this environment — applying 0040 to dev/prod is a human step, like 0039). Verify by inspection that: the old 3-arg function is dropped; the new signature has 6 params; the return table adds `is_internal boolean` as the 9th column; each filter's `not in (...)` branch makes unknown/`all`/`any` values a no-op; and the revoke/grant reference the **new** 6-arg signature.

- [ ] **Step 3: Commit**

```bash
git add app/supabase/migrations/0040_admin_users_filters.sql
git commit -m "feat(admin): filters + fuzzy search on admin_search_users (0040)"
```

---

## Task 2: Filter normalizers + `isInternalRow` helper (TDD)

**Files:**
- Modify: `app/src/lib/admin-users.ts`
- Test: `app/tests/unit/admin-users.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `type AccountFilter = 'all' | 'real' | 'test'`; `normalizeAccountFilter(v: string | undefined): AccountFilter` (default `'real'`).
  - `type SubFilter = 'any' | 'free' | 'trader' | 'pro'`; `normalizeSubFilter(v: string | undefined): SubFilter` (default `'any'`).
  - `type CompFilter = 'any' | 'comped' | 'not'`; `normalizeCompFilter(v: string | undefined): CompFilter` (default `'any'`).
  - `isInternalRow(input: { is_internal: boolean | null; email: string | null }): boolean` — `true` when `is_internal` is truthy OR email ends with `@tradingsocial.io` (case-insensitive).

- [ ] **Step 1: Write the failing tests**

Append to `app/tests/unit/admin-users.test.ts` (add the four new symbols to the existing `@/lib/admin-users` import):

```ts
import {
  normalizeAccountFilter, normalizeSubFilter, normalizeCompFilter, isInternalRow,
} from '@/lib/admin-users'

describe('filter normalizers', () => {
  it('normalizeAccountFilter defaults to real, passes valid, rejects junk', () => {
    expect(normalizeAccountFilter(undefined)).toBe('real')
    expect(normalizeAccountFilter('all')).toBe('all')
    expect(normalizeAccountFilter('test')).toBe('test')
    expect(normalizeAccountFilter('real')).toBe('real')
    expect(normalizeAccountFilter('bogus')).toBe('real')
  })
  it('normalizeSubFilter defaults to any', () => {
    expect(normalizeSubFilter(undefined)).toBe('any')
    expect(normalizeSubFilter('pro')).toBe('pro')
    expect(normalizeSubFilter('trader')).toBe('trader')
    expect(normalizeSubFilter('free')).toBe('free')
    expect(normalizeSubFilter('x')).toBe('any')
  })
  it('normalizeCompFilter defaults to any', () => {
    expect(normalizeCompFilter(undefined)).toBe('any')
    expect(normalizeCompFilter('comped')).toBe('comped')
    expect(normalizeCompFilter('not')).toBe('not')
    expect(normalizeCompFilter('x')).toBe('any')
  })
})

describe('isInternalRow', () => {
  it('true when flag set', () => {
    expect(isInternalRow({ is_internal: true, email: 'a@gmail.com' })).toBe(true)
  })
  it('true for @tradingsocial.io regardless of flag', () => {
    expect(isInternalRow({ is_internal: false, email: 'lb_hi_1@tradingsocial.io' })).toBe(true)
    expect(isInternalRow({ is_internal: false, email: 'X@TradingSocial.IO' })).toBe(true)
  })
  it('false for a real external user', () => {
    expect(isInternalRow({ is_internal: false, email: 'real@gmail.com' })).toBe(false)
    expect(isInternalRow({ is_internal: null, email: null })).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/admin-users.test.ts`
Expected: FAIL — the four new symbols are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `app/src/lib/admin-users.ts`:

```ts
export type AccountFilter = 'all' | 'real' | 'test'
export type SubFilter = 'any' | 'free' | 'trader' | 'pro'
export type CompFilter = 'any' | 'comped' | 'not'

export function normalizeAccountFilter(v: string | undefined): AccountFilter {
  return v === 'all' || v === 'test' || v === 'real' ? v : 'real'
}
export function normalizeSubFilter(v: string | undefined): SubFilter {
  return v === 'free' || v === 'trader' || v === 'pro' ? v : 'any'
}
export function normalizeCompFilter(v: string | undefined): CompFilter {
  return v === 'comped' || v === 'not' ? v : 'any'
}

/** Mirrors the RPC's internal predicate for defensive client-side checks. */
export function isInternalRow(input: { is_internal: boolean | null; email: string | null }): boolean {
  if (input.is_internal) return true
  return (input.email ?? '').toLowerCase().endsWith('@tradingsocial.io')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/admin-users.test.ts`
Expected: PASS (all suites in the file).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/admin-users.ts app/tests/unit/admin-users.test.ts
git commit -m "feat(admin): filter normalizers + isInternalRow helper"
```

---

## Task 3: Directory page — filter bar, badges, test chip (+ shared CSS)

**Files:**
- Modify: `app/src/app/globals.css`
- Modify: `app/src/app/admin/users/page.tsx`

**Interfaces:**
- Consumes: `normalizeAccountFilter`, `normalizeSubFilter`, `normalizeCompFilter`, `userTierSummary` (`@/lib/admin-users`); RPC `admin_search_users` (6-arg, Task 1).
- Produces: CSS classes `.ad-tier`/`.ad-tier--{pro,trader,free}`, `.ad-src`/`.ad-src--{admin,comp,paid,free}`, `.ad-chip--test` (reused by Task 4).

- [ ] **Step 1: Add the badge/chip CSS**

Append to `app/src/app/globals.css` (one grouped block):

```css
/* ── Admin user directory: tier / source / test badges ─────────────── */
.ad-tier, .ad-src {
  display: inline-flex; align-items: center; height: 20px; padding: 0 8px;
  border-radius: 6px; font-family: var(--mono); font-size: 11px; font-weight: 700;
  letter-spacing: .03em; text-transform: uppercase; white-space: nowrap;
}
.ad-tier--pro    { background: rgba(124,92,230,.14); color: var(--violet-deep); }
.ad-tier--trader { background: rgba(37,99,235,.12);  color: #1d4ed8; }
.ad-tier--free   { background: var(--surface-3);      color: var(--dim); }
.ad-src--admin   { background: rgba(201,145,20,.16); color: #8a5a00; }
.ad-src--comp    { background: rgba(124,92,230,.12); color: var(--violet-br); }
.ad-src--paid    { background: rgba(16,150,90,.14);  color: #0f7a45; }
.ad-src--free    { background: var(--surface-3);      color: var(--dim); }
.ad-chip--test {
  display: inline-flex; align-items: center; height: 16px; padding: 0 6px;
  border-radius: 5px; background: var(--surface-3); color: var(--dim);
  font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; margin-left: 6px;
}
.ad-filterbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 0 0 16px; }
.ad-filterbar .ts-select { height: 38px; }
```

> If `--surface-3` or `--dim` are absent, substitute the nearest existing muted-surface / muted-text tokens found in `globals.css` and note the substitution in your report.

- [ ] **Step 2: Rewrite the directory page**

Replace `app/src/app/admin/users/page.tsx` with:

```tsx
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { parseAdminEmails } from '@/lib/admin'
import {
  userTierSummary, normalizeAccountFilter, normalizeSubFilter, normalizeCompFilter,
} from '@/lib/admin-users'
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
  is_internal: boolean
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; account?: string; sub?: string; comp?: string }>
}) {
  const sp = await searchParams
  const term = (sp.q ?? '').trim()
  const account = normalizeAccountFilter(sp.account)
  const sub = normalizeSubFilter(sp.sub)
  const comp = normalizeCompFilter(sp.comp)
  const pageNum = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)
  const offset = (pageNum - 1) * PAGE_SIZE

  const svc = createServiceClient()
  const { data, error } = await svc.rpc('admin_search_users', {
    term, p_account: account, p_sub: sub, p_comp: comp, lim: PAGE_SIZE + 1, off: offset,
  })
  const rows = ((data ?? []) as Row[]).slice(0, PAGE_SIZE)
  const hasNext = (data ?? []).length > PAGE_SIZE
  const admins = parseAdminEmails(process.env.ADMIN_EMAILS)

  const qs = (p: number) => {
    const s = new URLSearchParams()
    if (term) s.set('q', term)
    if (account !== 'real') s.set('account', account)
    if (sub !== 'any') s.set('sub', sub)
    if (comp !== 'any') s.set('comp', comp)
    if (p > 1) s.set('page', String(p))
    const str = s.toString()
    return str ? `/admin/users?${str}` : '/admin/users'
  }
  const filtered = term || account !== 'real' || sub !== 'any' || comp !== 'any'

  return (
    <>
      <PageHead
        title="Users"
        sub="Search the directory and grant comped Trader/Pro access. Comp grants unlock features only — never admin access."
      />

      <form method="get" className="ad-filterbar">
        <input
          type="search" name="q" defaultValue={term}
          placeholder="Search email, username, or name…" className="ts-input"
          style={{ flex: '1 1 240px', minWidth: 0 }} aria-label="Search users"
        />
        <select name="account" defaultValue={account} className="ts-select" aria-label="Account type">
          <option value="real">Real users</option>
          <option value="test">Test / internal</option>
          <option value="all">All accounts</option>
        </select>
        <select name="sub" defaultValue={sub} className="ts-select" aria-label="Subscription">
          <option value="any">Any sub</option>
          <option value="free">No sub</option>
          <option value="trader">Trader sub</option>
          <option value="pro">Pro sub</option>
        </select>
        <select name="comp" defaultValue={comp} className="ts-select" aria-label="Comp grant">
          <option value="any">Any comp</option>
          <option value="comped">Comped</option>
          <option value="not">Not comped</option>
        </select>
        <button type="submit" className="btn btn-ghost">Apply</button>
        {filtered && <Link href="/admin/users" className="ad-kv">Reset</Link>}
      </form>

      <Panel title={term ? `Results for “${term}”` : 'Users'} flush scroll>
        {error ? (
          <Empty>Search failed. Confirm migration 0040 is applied.</Empty>
        ) : rows.length === 0 ? (
          <Empty>No users match these filters.</Empty>
        ) : (
          <table className="ts-table">
            <thead><tr><th>User</th><th>Email</th><th>Tier</th><th>Source</th><th>Joined</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const { tier, source } = userTierSummary({
                  email: r.email, compTier: r.comp_tier,
                  subTier: r.sub_tier, subStatus: r.sub_status, adminEmails: admins,
                })
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/admin/users/${r.id}`} className="ad-kv">{r.username}</Link>
                      {r.display_name && <span className="faint" style={{ fontSize: 12, marginLeft: 6 }}>{r.display_name}</span>}
                      {r.is_internal && <span className="ad-chip--test">test</span>}
                    </td>
                    <td style={{ fontSize: 13 }}>{r.email ?? '—'}</td>
                    <td><span className={`ad-tier ad-tier--${tier}`}>{tier}</span></td>
                    <td><span className={`ad-src ad-src--${source.toLowerCase()}`}>{source}</span></td>
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

> Verify `.btn.btn-ghost` exists in `globals.css` (used elsewhere in the app). If the admin surface uses a different button class, match the one already used by admin forms and note it.

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/globals.css "app/src/app/admin/users/page.tsx"
git commit -m "feat(admin): directory filter bar + color-coded tier/source badges"
```

---

## Task 4: Detail page — test chip, color badges, hierarchy

**Files:**
- Modify: `app/src/app/admin/users/[id]/page.tsx`

**Interfaces:**
- Consumes: `userTierSummary`, `isInternalRow` (`@/lib/admin-users`); the `.ad-tier`/`.ad-src`/`.ad-chip--test` classes from Task 3.

- [ ] **Step 1: Update the profile read to include `is_internal`**

In `app/src/app/admin/users/[id]/page.tsx`, change the profiles select to add `is_internal`:

```ts
    svc.from('profiles').select('username, display_name, comp_tier, created_at, is_internal').eq('id', id).maybeSingle(),
```

- [ ] **Step 2: Compute the internal flag and colorize the header + tier**

After `const email = authRes.user?.email ?? null` and the `userTierSummary` call, add:

```ts
  const internal = isInternalRow({ is_internal: prof.is_internal, email })
```

Import `isInternalRow` alongside `userTierSummary`:

```ts
import { userTierSummary, isInternalRow } from '@/lib/admin-users'
```

Update the `PageHead` `right` prop to include a test chip when internal:

```tsx
      <PageHead
        title={prof.username}
        sub={email ?? undefined}
        right={
          <>
            {internal && <span className="ad-chip--test" style={{ marginLeft: 0 }}>test</span>}
            <Link className="ad-kv" href="/admin/users">← Directory</Link>
          </>
        }
      />
```

And color the effective-tier + source in the Stats row — replace the Effective tier `Stat` with a colored badge value:

```tsx
        <Stat
          label="Effective tier"
          value={<span className={`ad-tier ad-tier--${tier}`}>{tier}</span>}
          sub={`via ${source}`}
          tone="accent"
        />
```

(Leave the other three `Stat`s — Trades / Referrals / Subscription — as they are.)

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no type errors. (`Stat`'s `value` prop is `ReactNode`, so a `<span>` is valid — confirm against `_components/ui.tsx` if the compiler complains.)

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/admin/users/[id]/page.tsx"
git commit -m "feat(admin): user detail test chip + colored effective-tier badge"
```

---

## Task 5: `CompTierControl` — segmented control + saving state

**Files:**
- Modify: `app/src/app/admin/users/_components/CompTierControl.tsx`

**Interfaces:**
- Consumes: `setCompTier` (`@/app/actions/admin`) — unchanged. Uses the `.ts-seg` pattern in `globals.css`.

- [ ] **Step 1: Restyle the control**

Rewrite `app/src/app/admin/users/_components/CompTierControl.tsx` — keep the exact same state logic (optimistic set, rollback on error, `router.refresh()` on success, no-op/pending guards) and only change presentation to a segmented control with a visible saving state:

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
      <div className="ts-seg" role="group" aria-label="Comp tier" aria-busy={pending}>
        {OPTIONS.map((o) => (
          <label key={o.label} data-active={value === o.value}>
            <input
              type="radio"
              name={`comp-${userId}`}
              checked={value === o.value}
              disabled={pending}
              onChange={() => choose(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 8, minHeight: 16 }}>
        {pending
          ? 'Saving…'
          : err
            ? <span style={{ color: 'var(--danger, #c0392b)' }}>{err}</span>
            : value
              ? `Comped ${value}.`
              : 'No comp grant.'}
      </p>
    </div>
  )
}
```

> Confirm the `.ts-seg` markup contract in `globals.css` (line ~217: `.ts-seg label:has(input:checked)`). If `.ts-seg` expects a different inner structure (e.g. no `data-active`, styling purely off `:has(input:checked)`), follow the actual CSS — the `data-active` attribute is a harmless extra hook. Keep the radio inputs visually hidden per the existing `.ts-seg` pattern; if that pattern does not already hide the native radio, add `style={{ position: 'absolute', opacity: 0 }}` (or the class the pattern uses) so only the labels show.

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/admin/users/_components/CompTierControl.tsx"
git commit -m "feat(admin): segmented comp-tier control with saving state"
```

---

## Task 6: Browser verification (dev)

**Depends on:** a human applying `0040_admin_users_filters.sql` to the dev DB first (no DB access in the implementation environment).

- [ ] **Step 1: Verify end-to-end in the dev preview**

With the dev server running and signed in as an admin (`claude@admin.tradingsocial.test`):
1. `/admin/users` defaults to **Real users** — the `@tradingsocial.io` test rows (`lb_hi_…`, `hov_a_…`) are hidden.
2. Switch Account → **Test / internal** — those rows appear, each with a **test** chip.
3. Subscription filter (e.g. **Pro sub**) narrows to real paying Pro subs; **Comp = comped** shows comped users.
4. Fuzzy search: type a misspelling (e.g. `ferar`, `allessandro`) — Alessandro Ferrari still matches.
5. Pagination preserves active filters in the URL.
6. Tier + source badges render in color; a user detail page shows the colored effective-tier badge, a **test** chip for an internal user, and the **segmented** comp control with a **Saving…** flash on change.

Capture a screenshot of the filtered directory and the detail page for the handoff. (This step is run by the controller after the human applies 0040; no commit.)

---

## Self-Review Notes

- **Spec coverage:** §1 RPC → Task 1. §2 helpers → Task 2. §3 directory → Task 3 (+CSS). §4 detail → Task 4. §4 control → Task 5. §5 styling → Task 3 CSS block (reused by 4 & 5). §6 testing → Task 2 unit + Task 6 browser. All covered.
- **Type/name consistency:** the 6-arg RPC params (`term, p_account, p_sub, p_comp, lim, off`) and the 9-column return (adds `is_internal`) in Task 1 match the `svc.rpc(...)` call and `Row` type in Task 3. Normalizer names in Task 2 match their imports in Tasks 3 (`normalize*`) and 4 (`isInternalRow`). CSS class names (`.ad-tier--{tier}`, `.ad-src--{source.toLowerCase()}`, `.ad-chip--test`) defined in Task 3 match their use in Tasks 3–4; `source.toLowerCase()` yields `admin|comp|paid|free`, matching the `.ad-src--*` variants.
- **Deferred (human):** apply `0040` to dev then prod before Task 6 / release; the directory shows an "apply migration 0040" hint until then.
- **Open verification items flagged in-task:** `.btn.btn-ghost` class (Task 3), `Stat.value` ReactNode (Task 4), and the exact `.ts-seg` markup contract + native-radio hiding (Task 5) — each confirmed against `globals.css`/`ui.tsx` during implementation.
```
