# Feature Flags — Admin-Togglable Tier Gates

**Date:** 2026-07-02
**Status:** Approved design

## Goal

Admins toggle app features on/off per tier (free / trader / pro) from the admin
page. Today the tier→feature matrix is hardcoded in
`app/src/lib/entitlements.ts` (`FEATURE_MIN_TIER` + `can()`); this makes it
DB-driven with the static map as the default/fallback.

## Non-goals

- Percentage rollouts, per-user targeting, experiment bucketing.
- Marketing/pricing-page display changes.
- Per-feature choice of hide-vs-upsell (always upsell).

## Data model — migration `0015_feature_flags.sql`

```sql
create table public.feature_flags (
  feature    text primary key,          -- matches Feature keys in entitlements.ts
  free       boolean not null,
  trader     boolean not null,
  pro        boolean not null,
  updated_at timestamptz not null default now()
);
```

- Seeded in the migration from the current `FEATURE_MIN_TIER` defaults
  (e.g. `journal_unlimited` → free=false, trader=true, pro=true).
- RLS enabled. `select` policy for `authenticated`. No insert/update/delete
  policies — admin writes go through the service client after `requireAdmin()`,
  matching the existing admin pattern.

## Read path (server)

New `app/src/lib/server/feature-flags.ts`:

- `getFeatureFlags(): Promise<FlagMap>` — single query over `feature_flags`,
  wrapped in `unstable_cache` with tag `feature-flags`, 60s TTL.
- `canFlag(flags: FlagMap, tier: Tier, feature: Feature): boolean` —
  if a DB row exists for `feature`, return `row[tier]`; otherwise fall back to
  the static `can(tier, feature)`.

Rules:

- The code registry (`Feature` union in `entitlements.ts`) remains the source
  of truth for *which features exist*. The DB stores *overrides* only.
- Sync `can()` stays as the static default and the fallback.
- Flag fetch failure ⇒ fall back to static `can()` (fail to defaults; never
  lock everyone out, never silently unlock).

### Call-site migration (3 files)

All already server-side; each fetches flags once per request and uses
`canFlag`:

- `app/src/app/journal/page.tsx` — `journal_unlimited`, `advanced_stats`
- `app/src/app/_components/AppNav.tsx` — `pro_badge`
- `app/src/app/[username]/page.tsx` — `pro_badge`

## Off behavior

Features are capability gates (not routes). Where `canFlag` is false, existing
upsell prompts render exactly as they do today for `can() === false` — now
flag-driven. New route-level gates (future) use the same helper plus a shared
`<UpgradePrompt/>`.

## Admin UI — `/admin/features`

- Nav link "Features" added to `app/src/app/admin/layout.tsx`.
- Table: one row per `Feature` key (human label + static default tier),
  columns Free / Trader / Pro as checkboxes.
- Toggle ⇒ server action: `requireAdmin()`, service-client upsert into
  `feature_flags`, then `revalidateTag('feature-flags')`.
- "Reset to default" per row: deletes the row ⇒ falls back to static map.
- Admin page reads flags uncached (direct query) so admin sees state
  instantly; users see changes within the 60s cache TTL.

## Testing

- Unit (Jest, alongside existing lib tests): `canFlag` override logic, fallback
  when row missing, fallback on fetch error.
- E2E-lite: admin toggles `advanced_stats` off for trader ⇒ journal page shows
  upsell for a trader seed user; reset restores.

## Error handling summary

| Failure | Behavior |
| --- | --- |
| `feature_flags` query errors | static `can()` defaults |
| Row missing for a feature | static `can()` defaults |
| Admin action without admin role | `requireAdmin()` rejects |
