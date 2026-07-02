# Feature Flags (Admin Tier Toggles) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins toggle features on/off per tier (free/trader/pro) from `/admin/features`, overriding the static `FEATURE_MIN_TIER` matrix with DB rows.

**Architecture:** New `feature_flags` table stores per-tier boolean overrides keyed by the existing `Feature` union in `app/src/lib/entitlements.ts`. Pure merge logic lives in `app/src/lib/feature-flags.ts` (testable, client-safe); the server fetch is a 60s `unstable_cache` wrapper in `app/src/lib/server/feature-flags.ts`. Admin writes go through server actions (`requireAdmin()` + service client), which revalidate the cache tag. Existing `can()` call sites switch to the flag-aware check; missing rows and fetch errors fall back to `can()`.

**Tech Stack:** Next.js 15 (App Router, server components/actions), Supabase (Postgres + RLS), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-02-feature-flags-design.md`

## Global Constraints

- All commands run from the `app/` directory unless noted.
- Unit tests: Vitest, files in `app/tests/unit/*.test.ts`, run with `npm test -- tests/unit/<file>`.
- Tier values are exactly `'free' | 'trader' | 'pro'` (`Tier` in `app/src/lib/entitlements.ts`).
- Feature keys are exactly the `Feature` union in `app/src/lib/entitlements.ts` — the code registry stays the source of truth for which features exist; DB stores overrides only.
- Admin writes: `requireAdmin()` from `@/lib/server/admin`, then `createServiceClient()` from `@/lib/supabase/service`. No RLS write policies on `feature_flags`.
- Failure behavior: any flag-fetch error ⇒ fall back to static `can()` (never lock out, never silently unlock).
- Migration file: `app/supabase/migrations/0015_feature_flags.sql` (0014 exists, uncommitted).

---

### Task 1: Pure flag logic (`lib/feature-flags.ts`)

**Files:**
- Create: `app/src/lib/feature-flags.ts`
- Test: `app/tests/unit/feature-flags.test.ts`

**Interfaces:**
- Consumes: `can`, `FEATURE_MIN_TIER`, types `Feature`, `Tier` from `@/lib/entitlements` (already exist).
- Produces (later tasks rely on these exact names):
  - `type FlagValues = { free: boolean; trader: boolean; pro: boolean }`
  - `type FlagRow = { feature: string } & FlagValues`
  - `type FlagMap = Partial<Record<Feature, FlagValues>>`
  - `FEATURE_KEYS: Feature[]`
  - `isFeature(key: string): key is Feature`
  - `flagsFromRows(rows: FlagRow[]): FlagMap`
  - `canFlag(flags: FlagMap, tier: Tier, feature: Feature): boolean`
  - `defaultMatrix(feature: Feature): FlagValues`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/feature-flags.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  flagsFromRows, canFlag, defaultMatrix, isFeature, FEATURE_KEYS,
} from '@/lib/feature-flags'
import { FEATURE_MIN_TIER } from '@/lib/entitlements'

describe('canFlag', () => {
  it('falls back to static defaults when no row exists', () => {
    expect(canFlag({}, 'trader', 'journal_unlimited')).toBe(true)
    expect(canFlag({}, 'free', 'journal_unlimited')).toBe(false)
    expect(canFlag({}, 'trader', 'pro_badge')).toBe(false)
    expect(canFlag({}, 'pro', 'pro_badge')).toBe(true)
  })
  it('uses the DB override when a row exists', () => {
    const flags = flagsFromRows([
      { feature: 'journal_unlimited', free: true, trader: false, pro: true },
    ])
    expect(canFlag(flags, 'free', 'journal_unlimited')).toBe(true)
    expect(canFlag(flags, 'trader', 'journal_unlimited')).toBe(false)
    expect(canFlag(flags, 'pro', 'journal_unlimited')).toBe(true)
  })
})

describe('flagsFromRows', () => {
  it('drops rows whose feature key is not in the registry', () => {
    expect(flagsFromRows([{ feature: 'nope', free: true, trader: true, pro: true }]))
      .toEqual({})
  })
})

describe('defaultMatrix', () => {
  it('mirrors min-tier semantics', () => {
    expect(defaultMatrix('journal_unlimited')).toEqual({ free: false, trader: true, pro: true })
    expect(defaultMatrix('pro_badge')).toEqual({ free: false, trader: false, pro: true })
  })
})

describe('registry', () => {
  it('FEATURE_KEYS covers every FEATURE_MIN_TIER key', () => {
    expect(FEATURE_KEYS.sort()).toEqual(Object.keys(FEATURE_MIN_TIER).sort())
  })
  it('isFeature accepts registry keys and rejects others', () => {
    expect(isFeature('journal_unlimited')).toBe(true)
    expect(isFeature('made_up')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `app/`): `npm test -- tests/unit/feature-flags.test.ts`
Expected: FAIL — cannot resolve `@/lib/feature-flags`.

- [ ] **Step 3: Write the implementation**

Create `app/src/lib/feature-flags.ts`:

```ts
import { can, FEATURE_MIN_TIER, type Feature, type Tier } from '@/lib/entitlements'

export type FlagValues = { free: boolean; trader: boolean; pro: boolean }
export type FlagRow = { feature: string } & FlagValues
export type FlagMap = Partial<Record<Feature, FlagValues>>

export const FEATURE_KEYS = Object.keys(FEATURE_MIN_TIER) as Feature[]

export function isFeature(key: string): key is Feature {
  return (FEATURE_KEYS as string[]).includes(key)
}

export function flagsFromRows(rows: FlagRow[]): FlagMap {
  const map: FlagMap = {}
  for (const r of rows) {
    if (isFeature(r.feature)) map[r.feature] = { free: r.free, trader: r.trader, pro: r.pro }
  }
  return map
}

/** DB override if present, else the static FEATURE_MIN_TIER default. */
export function canFlag(flags: FlagMap, tier: Tier, feature: Feature): boolean {
  const row = flags[feature]
  return row ? row[tier] : can(tier, feature)
}

/** The static default matrix for a feature — what "reset" restores. */
export function defaultMatrix(feature: Feature): FlagValues {
  return {
    free: can('free', feature),
    trader: can('trader', feature),
    pro: can('pro', feature),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/feature-flags.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/feature-flags.ts app/tests/unit/feature-flags.test.ts
git commit -m "feat(flags): pure per-tier feature flag logic with static fallback"
```

---

### Task 2: Migration `0015_feature_flags.sql`

**Files:**
- Create: `app/supabase/migrations/0015_feature_flags.sql`

**Interfaces:**
- Consumes: `public.touch_updated_at()` trigger function (exists since earlier migrations; used by `subscriptions` in `0009_billing.sql`).
- Produces: table `public.feature_flags(feature text pk, free bool, trader bool, pro bool, updated_at timestamptz)` — RLS select for `authenticated`, writes service-role-only. Seeded with one row per current `Feature` key.

- [ ] **Step 1: Write the migration**

Create `app/supabase/migrations/0015_feature_flags.sql`:

```sql
-- Feature flags: admin-togglable per-tier overrides of the static
-- FEATURE_MIN_TIER matrix in app/src/lib/entitlements.ts.
-- Code registry stays the source of truth for WHICH features exist;
-- this table stores per-tier on/off overrides.

create table if not exists public.feature_flags (
  feature    text primary key,   -- matches Feature keys in entitlements.ts
  free       boolean not null,
  trader     boolean not null,
  pro        boolean not null,
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;
-- Signed-in users read; NO insert/update/delete policy -> service role only
-- (admin server actions gate on requireAdmin()).
drop policy if exists feature_flags_select on public.feature_flags;
create policy feature_flags_select on public.feature_flags
  for select to authenticated using (true);

drop trigger if exists feature_flags_touch_updated_at on public.feature_flags;
create trigger feature_flags_touch_updated_at
  before update on public.feature_flags
  for each row execute function public.touch_updated_at();

-- Seed from the static defaults (FEATURE_MIN_TIER as of this migration).
-- min_tier 'trader' -> free=f, trader=t, pro=t
-- min_tier 'pro'    -> free=f, trader=f, pro=t
insert into public.feature_flags (feature, free, trader, pro) values
  ('journal_unlimited',            false, true,  true),
  ('advanced_stats',               false, true,  true),
  ('learning_intermediate',        false, true,  true),
  ('saved_traders',                false, true,  true),
  ('strategy_tracking',            false, true,  true),
  ('mistake_tagging',              false, true,  true),
  ('risk_tracking',                false, true,  true),
  ('private_notes',                false, true,  true),
  ('weekly_review',                false, true,  true),
  ('advanced_leaderboard_filters', false, true,  true),
  ('xp_boosts',                    false, true,  true),
  ('export_journal',               false, true,  true),
  ('premium_courses',              false, false, true),
  ('pro_badge',                    false, false, true),
  ('creator_profile',              false, false, true),
  ('custom_templates',             false, false, true),
  ('strategy_breakdown',           false, false, true),
  ('advanced_reporting',           false, false, true),
  ('monthly_report',               false, false, true),
  ('ai_insights',                  false, false, true),
  ('leaderboard_placement',        false, false, true),
  ('premium_challenges',           false, false, true),
  ('priority_support',             false, false, true),
  ('early_access',                 false, false, true)
on conflict (feature) do nothing;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP tool `apply_migration` with name `feature_flags` and the exact SQL above (this project applies migrations to the remote directly; files are the record).

Expected: success, no errors.

- [ ] **Step 3: Verify**

Via Supabase MCP `execute_sql`: `select count(*) from public.feature_flags;`
Expected: `24`.

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0015_feature_flags.sql
git commit -m "feat(flags): feature_flags table, RLS, seed from static defaults"
```

---

### Task 3: Cached server read path (`lib/server/feature-flags.ts`)

**Files:**
- Create: `app/src/lib/server/feature-flags.ts`

**Interfaces:**
- Consumes: `flagsFromRows`, `FlagMap`, `FlagRow` from Task 1; `createServiceClient` from `@/lib/supabase/service`.
- Produces:
  - `FLAGS_TAG = 'feature-flags'` (cache tag; the admin action revalidates it)
  - `getFeatureFlags(): Promise<FlagMap>` — cached 60s

No unit test: thin I/O wrapper around `unstable_cache` + Supabase; its logic (`flagsFromRows`) is tested in Task 1. Verified by build (Task 6) and manual check (Task 7).

- [ ] **Step 1: Write the implementation**

Create `app/src/lib/server/feature-flags.ts`:

```ts
import 'server-only'
import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { flagsFromRows, type FlagMap, type FlagRow } from '@/lib/feature-flags'

export const FLAGS_TAG = 'feature-flags'

/** Cached per-tier flag overrides. Fails open to {} so canFlag falls back to
 *  the static FEATURE_MIN_TIER defaults on any error. Service client: flags
 *  must resolve for logged-out renders (e.g. AppNav) too. */
export const getFeatureFlags = unstable_cache(
  async (): Promise<FlagMap> => {
    try {
      const svc = createServiceClient()
      const { data, error } = await svc
        .from('feature_flags').select('feature, free, trader, pro')
      if (error || !data) return {}
      return flagsFromRows(data as FlagRow[])
    } catch {
      return {}
    }
  },
  ['feature-flags'],
  { revalidate: 60, tags: [FLAGS_TAG] },
)
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors (pre-existing errors, if any, unrelated to these files).

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/feature-flags.ts
git commit -m "feat(flags): cached server flag fetch with fail-open fallback"
```

---

### Task 4: Admin server actions (`setFeatureFlag`, `resetFeatureFlag`)

**Files:**
- Modify: `app/src/app/actions/admin.ts` (append at end of file; also extend the `next/cache` import on line 3)

**Interfaces:**
- Consumes: `isFeature`, `FlagValues` (Task 1); `FLAGS_TAG` (Task 3); existing `requireAdmin`, `createServiceClient` already imported in this file.
- Produces (admin UI in Task 5 calls these):
  - `setFeatureFlag(feature: string, values: FlagValues): Promise<{ error?: string }>`
  - `resetFeatureFlag(feature: string): Promise<{ error?: string }>`

- [ ] **Step 1: Write the actions**

In `app/src/app/actions/admin.ts`, change line 3 from:

```ts
import { revalidatePath } from 'next/cache'
```

to:

```ts
import { revalidatePath, revalidateTag } from 'next/cache'
```

Add imports below the existing ones:

```ts
import { isFeature, type FlagValues } from '@/lib/feature-flags'
import { FLAGS_TAG } from '@/lib/server/feature-flags'
```

Append at end of file:

```ts
export async function setFeatureFlag(feature: string, values: FlagValues): Promise<{ error?: string }> {
  await requireAdmin()
  if (!isFeature(feature)) return { error: 'Unknown feature.' }
  const svc = createServiceClient()
  const { error } = await svc.from('feature_flags').upsert({
    feature, free: values.free, trader: values.trader, pro: values.pro,
  })
  if (error) return { error: 'Update failed.' }
  revalidateTag(FLAGS_TAG)
  revalidatePath('/admin/features')
  return {}
}

export async function resetFeatureFlag(feature: string): Promise<{ error?: string }> {
  await requireAdmin()
  if (!isFeature(feature)) return { error: 'Unknown feature.' }
  const svc = createServiceClient()
  const { error } = await svc.from('feature_flags').delete().eq('feature', feature)
  if (error) return { error: 'Reset failed.' }
  revalidateTag(FLAGS_TAG)
  revalidatePath('/admin/features')
  return {}
}
```

Note: `actions/admin.ts` is a `'use server'` module — only async function (and type) exports are allowed; both additions comply.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/actions/admin.ts
git commit -m "feat(flags): admin actions to set/reset per-tier feature flags"
```

---

### Task 5: Admin UI — `/admin/features` + nav link

**Files:**
- Create: `app/src/app/admin/features/page.tsx`
- Create: `app/src/app/admin/_components/FlagMatrix.tsx`
- Modify: `app/src/app/admin/layout.tsx:16` (add nav link)

**Interfaces:**
- Consumes: `setFeatureFlag`, `resetFeatureFlag` (Task 4); `FEATURE_KEYS`, `defaultMatrix`, `flagsFromRows`, `FlagValues`, `FlagRow` (Task 1); `FEATURE_MIN_TIER` from `@/lib/entitlements`; `requireAdmin`, `createServiceClient`.
- Produces: admin page only; nothing downstream.

- [ ] **Step 1: Write the client matrix component**

Create `app/src/app/admin/_components/FlagMatrix.tsx` (style mirrors `PublishToggle.tsx`: `useTransition`, optimistic local state, existing `btn`/`faint` classes):

```tsx
'use client'

import { useState, useTransition } from 'react'
import { setFeatureFlag, resetFeatureFlag } from '@/app/actions/admin'
import type { FlagValues } from '@/lib/feature-flags'

export type FlagRowView = {
  key: string
  label: string
  defaultTier: string
  values: FlagValues
  defaults: FlagValues
}

const TIERS = ['free', 'trader', 'pro'] as const

function Row({ row }: { row: FlagRowView }) {
  const [values, setValues] = useState(row.values)
  const [pending, start] = useTransition()
  const isDefault =
    values.free === row.defaults.free &&
    values.trader === row.defaults.trader &&
    values.pro === row.defaults.pro

  const toggle = (tier: (typeof TIERS)[number], checked: boolean) => {
    const next = { ...values, [tier]: checked }
    start(async () => {
      const r = await setFeatureFlag(row.key, next)
      if (!r.error) setValues(next)
    })
  }

  const reset = () => start(async () => {
    const r = await resetFeatureFlag(row.key)
    if (!r.error) setValues(row.defaults)
  })

  return (
    <tr>
      <td style={{ textTransform: 'capitalize' }}>
        {row.label} <span className="faint">(default: {row.defaultTier}+)</span>
      </td>
      {TIERS.map((t) => (
        <td key={t} style={{ textAlign: 'center' }}>
          <input type="checkbox" checked={values[t]} disabled={pending}
            aria-label={`${row.label} — ${t}`}
            onChange={(e) => toggle(t, e.target.checked)} />
        </td>
      ))}
      <td>
        {!isDefault && (
          <button type="button" className="btn btn-sm" disabled={pending} onClick={reset}>
            Reset
          </button>
        )}
      </td>
    </tr>
  )
}

export function FlagMatrix({ rows }: { rows: FlagRowView[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ textAlign: 'left' }}>
          <th>Feature</th>
          <th style={{ textAlign: 'center' }}>Free</th>
          <th style={{ textAlign: 'center' }}>Trader</th>
          <th style={{ textAlign: 'center' }}>Pro</th>
          <th></th>
        </tr>
      </thead>
      <tbody>{rows.map((r) => <Row key={r.key} row={r} />)}</tbody>
    </table>
  )
}
```

- [ ] **Step 2: Write the server page**

Create `app/src/app/admin/features/page.tsx` (reads DB directly, uncached, so admin sees state instantly):

```tsx
import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { FEATURE_MIN_TIER } from '@/lib/entitlements'
import { FEATURE_KEYS, defaultMatrix, flagsFromRows, type FlagRow } from '@/lib/feature-flags'
import { FlagMatrix, type FlagRowView } from '../_components/FlagMatrix'

export const dynamic = 'force-dynamic'

export default async function AdminFeaturesPage() {
  await requireAdmin()
  const svc = createServiceClient()
  const { data } = await svc.from('feature_flags').select('feature, free, trader, pro')
  const flags = flagsFromRows((data ?? []) as FlagRow[])

  const rows: FlagRowView[] = FEATURE_KEYS.map((key) => ({
    key,
    label: key.replace(/_/g, ' '),
    defaultTier: FEATURE_MIN_TIER[key],
    values: flags[key] ?? defaultMatrix(key),
    defaults: defaultMatrix(key),
  }))

  return (
    <section>
      <h2 className="ts-h2">Feature flags</h2>
      <p className="faint mt-1">
        Per-tier access. Unchecked = that tier sees the upgrade prompt.
        Changes reach users within ~60s (cache). Reset restores the code default.
      </p>
      <div className="ts-card mt-4">
        <FlagMatrix rows={rows} />
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Add the admin nav link**

In `app/src/app/admin/layout.tsx`, after the Courses link (line 16), add:

```tsx
        <Link className="ts-nav-link" href="/admin/features">Features</Link>
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/admin/features/page.tsx app/src/app/admin/_components/FlagMatrix.tsx app/src/app/admin/layout.tsx
git commit -m "feat(flags): admin features page with per-tier toggle matrix"
```

---

### Task 6: Switch call sites to flag-aware checks

**Files:**
- Modify: `app/src/app/journal/page.tsx:7,34-36,65`
- Modify: `app/src/app/_components/AppNav.tsx:5,29-30`
- Modify: `app/src/app/[username]/page.tsx:140` (+ its imports)

**Interfaces:**
- Consumes: `getFeatureFlags` (Task 3), `canFlag` (Task 1). Fetch flags once per component, pass to `canFlag`.

- [ ] **Step 1: journal/page.tsx**

Line 7, replace:

```ts
import { JOURNAL_FREE_LIMIT, can } from '@/lib/entitlements'
```

with:

```ts
import { JOURNAL_FREE_LIMIT } from '@/lib/entitlements'
import { canFlag } from '@/lib/feature-flags'
import { getFeatureFlags } from '@/lib/server/feature-flags'
```

Lines 34-36, replace:

```ts
  const tier = await getTier(supabase, user.id)
  const unlimited = can(tier, 'journal_unlimited')
```

with:

```ts
  const tier = await getTier(supabase, user.id)
  const flags = await getFeatureFlags()
  const unlimited = canFlag(flags, tier, 'journal_unlimited')
```

Line 65, replace `advanced={can(tier, 'advanced_stats')}` with `advanced={canFlag(flags, tier, 'advanced_stats')}`.

- [ ] **Step 2: AppNav.tsx**

Line 5, replace:

```ts
import { can } from '@/lib/entitlements'
```

with:

```ts
import { canFlag } from '@/lib/feature-flags'
import { getFeatureFlags } from '@/lib/server/feature-flags'
```

Line 29-30, replace:

```ts
    const tier = await getTier(supabase, user.id)
    isPro = can(tier, 'pro_badge')
```

with:

```ts
    const tier = await getTier(supabase, user.id)
    isPro = canFlag(await getFeatureFlags(), tier, 'pro_badge')
```

- [ ] **Step 3: [username]/page.tsx**

In imports, replace the `can` import from `@/lib/entitlements` with:

```ts
import { canFlag } from '@/lib/feature-flags'
import { getFeatureFlags } from '@/lib/server/feature-flags'
```

(If the file imports other names from `@/lib/entitlements`, keep those — only remove `can`.)

Line 140, replace:

```ts
  if (profileId) proBadge = can(await getTier(createServiceClient(), profileId), 'pro_badge')
```

with:

```ts
  if (profileId) proBadge = canFlag(await getFeatureFlags(), await getTier(createServiceClient(), profileId), 'pro_badge')
```

- [ ] **Step 4: Verify — tests and build**

Run: `npm test`
Expected: all unit tests pass.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/journal/page.tsx app/src/app/_components/AppNav.tsx "app/src/app/[username]/page.tsx"
git commit -m "feat(flags): journal, nav, profile gates read DB feature flags"
```

---

### Task 7: End-to-end verification (manual, dev server)

**Files:** none (verification only).

- [ ] **Step 1: Start dev server, load admin page**

Start the app dev server (preview tooling or `npm run dev` from `app/`). Log in as an admin (email in `ADMIN_EMAILS`). Open `/admin/features`.
Expected: 24-row matrix, Free unchecked everywhere, Trader checked for trader-tier rows, Pro checked everywhere.

- [ ] **Step 2: Toggle + verify effect**

Uncheck `advanced stats` → Trader. Expected: checkbox persists after reload (DB row updated).
As a trader-tier user (seed users in `seed-users.md`, e.g. a demo user with a trader sub — or temporarily check Free on a feature and use a free user), open `/journal`.
Expected: advanced stat cards replaced by the existing upsell state (may take up to 60s for cache; `/admin/features` reflects instantly).

- [ ] **Step 3: Reset + verify fallback**

Click Reset on the row. Expected: values return to defaults; row still behaves per static `FEATURE_MIN_TIER`.

- [ ] **Step 4: Confirm no writes without admin**

Signed in as a non-admin (any seed user), POST attempt is irrelevant — but confirm `/admin/features` 404s (via `requireAdmin()`).

Expected: 404 page.
