# Admin /admin/users UX upgrade — Design

**Date:** 2026-07-28
**Status:** Approved design, pending implementation plan
**Builds on:** [[2026-07-28-admin-comp-tier-design]] (the directory + detail pages this refines)

## Goal

Improve the `/admin/users` admin experience: add **filters** (account type / subscription / comp grant), **fuzzy search**, and a **visual polish** pass over the directory and per-user detail page — staying inside the existing admin design system (the `ad-*` / `ts-*` classes and violet tokens in `app/src/app/globals.css`), not a redesign.

## Background (current state)

- `/admin/users` (`app/src/app/admin/users/page.tsx`): search box (`?q=`) + paginated table, backed by RPC `admin_search_users(term, lim, off)` which does plain `ilike` substring on email/username/display_name, newest-first, and returns `id, username, display_name, email, created_at, comp_tier, sub_tier, sub_status`.
- Detail page (`app/src/app/admin/users/[id]/page.tsx`) + `CompTierControl` client component (`_components/CompTierControl.tsx`).
- Effective tier + source label computed in TS by `userTierSummary` (`app/src/lib/admin-users.ts`): Admin > higher of Comp/Paid, comp wins ties. **Source cannot be filtered in SQL** because Admin depends on `ADMIN_EMAILS` (not in the DB).
- **`pg_trgm` is already enabled** (migration `0011_search.sql`) with GIN trigram indexes on `profiles.username` and `profiles.display_name`. No email trigram index.
- **`is_internal`** flags test/internal accounts. Migrations `0035`/`0036` backfilled `@tradingsocial.io`, `.test`, `@example.com`, and disposable-domain accounts, and the `flag_internal_signup()` BEFORE-INSERT trigger auto-flags new `@tradingsocial.io` signups. So `@tradingsocial.io` == internal by existing convention.
- Latest migration: `0039_comp_tier.sql`. Next: **0040**.
- Stylesheet `app/src/app/globals.css` already has: `.ts-input`/`.ts-select`/`.ts-textarea` (142), `.ts-seg` segmented control with `label:has(input:checked)` (217), `.ts-filterbar` (275), `.ts-pill` (348), violet tokens `--violet`/`--violet-br`/`--violet-deep` (26-28), and the admin `ad-*` classes.

## Design

### 1. Migration `0040_admin_users_filters.sql` — extend `admin_search_users`

Replace the function (drop + recreate; signature changes) with added filter params and fuzzy matching.

**Signature:**
```
admin_search_users(
  term text,
  p_account text,   -- 'all' | 'real' | 'test'
  p_sub text,       -- 'any' | 'free' | 'trader' | 'pro'
  p_comp text,      -- 'any' | 'comped' | 'not'
  lim int,
  off int
)
```

**Returns:** the existing 8 columns **plus `is_internal boolean`**.

**Internal predicate** (used by the account filter and the returned `is_internal` display): `p.is_internal OR u.email ilike '%@tradingsocial.io'`. Expose this as a computed boolean `is_internal` in the result (so the UI marks a row internal whenever either holds, even if the flag is stale).

**Fuzzy matching** (when `term <> ''`):
- Match rows where **any** of: `u.email ilike '%'||term||'%'`, `p.username ilike '%'||term||'%'`, `coalesce(p.display_name,'') ilike '%'||term||'%'`, `word_similarity(term, p.username::text) > 0.3`, `word_similarity(term, coalesce(p.display_name,'')) > 0.3`.
- Order by `greatest(word_similarity(term, p.username::text), word_similarity(term, coalesce(p.display_name,''))) desc, p.created_at desc`.
- When `term = ''`: order by `p.created_at desc` (unchanged).

**Filters (WHERE):**
- **account:** `'real'` → NOT internal_pred; `'test'` → internal_pred; `'all'`/other → no constraint.
- **sub:** `'free'` → no active/trialing subscription row exists; `'trader'`/`'pro'` → an active/trialing subscription of exactly that tier exists; `'any'`/other → no constraint. (Reuse the existing lateral `s` for the active/trialing highest sub; `'free'` = `s.tier IS NULL`, tier filters = `s.tier = p_sub`.)
- **comp:** `'comped'` → `p.comp_tier IS NOT NULL`; `'not'` → `p.comp_tier IS NULL`; `'any'`/other → no constraint.

Keep `language sql`, `security definer`, `set search_path = public`; re-issue `revoke ... from public, anon, authenticated` and `grant execute ... to service_role` for the **new** signature. Because the parameter list changes, `drop function if exists public.admin_search_users(text, int, int)` first (the old 3+lim/off signature).

No email trigram index (decision: substring email is sufficient).

### 2. Pure helper — `app/src/lib/admin-users.ts`

Add small, testable normalizers so the page passes clean enum values to the RPC and never trusts raw query strings:
- `normalizeAccountFilter(v): 'all' | 'real' | 'test'` (default `'real'`).
- `normalizeSubFilter(v): 'any' | 'free' | 'trader' | 'pro'` (default `'any'`).
- `normalizeCompFilter(v): 'any' | 'comped' | 'not'` (default `'any'`).
- `isInternalRow({ is_internal, email }): boolean` — mirrors the SQL predicate for any UI that needs it client-side (defensive; the RPC already returns the computed `is_internal`).

`userTierSummary` is unchanged.

### 3. Directory page — `app/src/app/admin/users/page.tsx`

- **Filter bar** above the table: the search box plus three compact `<select className="ts-select">` controls (Account / Subscription / Comp), all in one `<form method="get">` so changing any and submitting updates the URL params (`q`, `account`, `sub`, `comp`, `page`). A "Reset" link clears to defaults. **Default `account=real`.**
- `searchParams` now reads `account`, `sub`, `comp` (normalized via the helpers) and passes them to the RPC. Pagination querystring (`qs`) preserves all active filters.
- **Row rendering:** color-coded tier badge + source pill (see §5). An **internal/test** row gets a small muted "test" chip next to the username (driven by the RPC's `is_internal`).
- Empty-state copy reflects active filters ("No users match these filters.").

### 4. Detail page + `CompTierControl`

- **Header:** show a **test/internal chip** when the account is internal (compute from `is_internal OR email ilike '@tradingsocial.io'`; the page already has email + can select `is_internal`). Stronger heading hierarchy for the "Comp tier" / "Profile" section titles and tidier spacing.
- **Effective tier + source:** color-coded, same vocabulary as the directory.
- **`CompTierControl`:** restyle into a real segmented control using the `.ts-seg` pattern (radio-backed, clear selected state, hover), keep the optimistic update + rollback, and surface a "Saving…" state while the transition is pending (the logic is unchanged from the comp-tier feature — only presentation changes).

### 5. Styling — `app/src/app/globals.css`

Add a small, self-contained block of admin badge classes (reusing existing tokens), e.g.:
- `.ad-tier` base + `.ad-tier--pro` (violet), `.ad-tier--trader` (accent/blue), `.ad-tier--free` (muted grey).
- `.ad-src` base + `.ad-src--admin` (amber), `.ad-src--comp` (violet tint), `.ad-src--paid` (green), `.ad-src--free` (grey).
- `.ad-chip--test` for the internal/test marker.
- Any minor spacing/heading tweaks scoped to the users pages (prefer existing `Section`/`Stats` primitives; only add CSS where a token/class doesn't already exist).

Keep additions minimal and grouped under a clear comment; do not restyle unrelated admin components.

### 6. Testing

- **Unit (TDD):** the four normalizer/`isInternalRow` helpers in `admin-users.ts` — defaults, valid pass-through, invalid → default, and the internal predicate (flag true, `@tradingsocial.io` email, neither).
- **SQL logic** (filters + fuzzy) lives in the RPC and has no unit harness → verified by a manual RPC query on dev and the browser check.
- **Browser verification (dev, 0040 applied):** each filter narrows correctly; a misspelled/partial term (e.g. "ferar", "allessandro") still finds Alessandro Ferrari; default hides `@tradingsocial.io` test rows; tier/source colors render; the segmented comp control shows selected + saving states; detail page shows the test chip for an internal user.

## Out of scope

- Filtering by *source* (Admin/Comp/Paid/Free) in SQL — Admin is env-derived; not worth replicating. Comp/sub filters cover the useful cases.
- Email trigram index / fuzzy email.
- Bulk actions, CSV export, column sorting.

## Files touched

- `app/supabase/migrations/0040_admin_users_filters.sql` (new)
- `app/src/lib/admin-users.ts` (add normalizers + `isInternalRow`)
- `app/src/app/admin/users/page.tsx` (filter bar, params, badges)
- `app/src/app/admin/users/[id]/page.tsx` (test chip, colors, hierarchy)
- `app/src/app/admin/users/_components/CompTierControl.tsx` (segmented restyle + saving state)
- `app/src/app/globals.css` (badge/chip classes)
- `app/tests/unit/admin-users.test.ts` (extend)
