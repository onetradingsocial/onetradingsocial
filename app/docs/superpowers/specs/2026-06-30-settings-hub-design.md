# Settings Hub — Design

Date: 2026-06-30
Status: Approved (pending spec review)

## Goal

Redesign `/settings` from a plain stacked `ts-card` page into a polished
settings hub matching the app's mockup UI (profile/journal/home). Expand scope
so profile content currently editable **only** during onboarding (display name,
username, markets, trading styles, experience, visibility) — plus `bio` and
`goal`, which are not editable anywhere today — can be edited from settings.

## Non-goals

- No account deletion / danger zone (deferred).
- No email or password change flow (Supabase Auth UI out of scope here).
- No changes to billing checkout/portal (only the summary card is restyled).
- No redesign of `/settings/billing` (only linked from the hub).

## Layout & shell

- `/settings/page.tsx` stays a **server component**.
- Wrapped in the existing app shell (`h-app > h-main`) for consistent
  max-width and reveal animation.
- New scoped stylesheet `src/app/settings/settings.css` (imported by the page)
  defines the two-column grid + sidebar nav. Everything else reuses existing
  global tokens/classes from `globals.css`: `ts-card`, `ts-input`, `ts-label`,
  `ts-textarea`, `ts-select`, `ts-chips`/`ts-chip`, `ts-seg`, `btn`,
  `btn-primary`/`btn-ghost`, `eyebrow`, `ts-error`.
- Icons reuse `@/app/[username]/_components/Icon` (cross-route import is fine in
  Next App Router).

### Grid

```
.settings-grid  (display:grid; grid-template-columns: 220px 1fr; gap; align-items:start)
  ├─ aside.settings-nav   (position: sticky; top)
  └─ div.settings-body    (flex column of cards, gap)
```

Mobile (`max-width: 900px`): single column; nav collapses to a horizontal
scrollable pill row above the body.

### Header

Calm, not a gradient hero (settings should not compete with the profile hero):
`eyebrow "Account"` + `h1 Settings` + sub `@username`.

## Left nav — `SettingsNav.tsx` (client)

- Renders anchor links: Profile, Trading account, Privacy, Billing, Account —
  each with an `Icon`.
- Smooth-scroll to `#profile`, `#trading`, `#privacy`, `#billing`, `#account`.
- `IntersectionObserver` scrollspy sets the active link (`data-active="true"`).
- Pure presentational client component; takes the list of sections as a
  constant (no props needed beyond optional active fallback).

## Sections (cards in `.settings-body`)

Each section is a `<section id="…" className="ts-card settings-section">` with an
`h2`/`ts-h2` heading + sub. Exception: Privacy is an anchored block inside the
Profile card (see §3), not its own card, so the single profile `<form>` stays a
contiguous subtree.

### 1. Profile  (`#profile`)

Rendered by `ProfileSettingsForm.tsx` (client, `useActionState`) — mirrors
`OnboardingForm` for inline error/success. Fields:

| Field            | Control                                   | Source column        |
|------------------|-------------------------------------------|----------------------|
| Avatar           | `AvatarUploader` (reused, unchanged)      | `avatar_url`         |
| Display name     | `ts-input`                                | `display_name`       |
| Username         | `ts-input`                                | `username`           |
| Bio              | `ts-textarea` (**new editable**)          | `bio`                |
| Experience       | `ts-select` (EXPERIENCE_LEVELS)           | `experience_level`   |
| Main markets     | `ts-chips` checkboxes (MARKETS)           | `main_markets[]`     |
| Trading styles   | `ts-chips` checkboxes (TRADING_STYLES)    | `trading_styles[]`   |
| Goal             | `ts-textarea`                             | `goal`               |
| Visibility       | `ts-seg` Public/Private (see Privacy §)   | `is_public`          |

The avatar uploader sits at the top of the card and saves independently (its own
action) — it is **not** part of the form submit. All other fields submit
together via `saveProfileSettings`. Single **Save changes** `btn-primary` at the
card foot. Inline `ts-error` on failure; transient "Saved." note on success.

### 2. Trading account  (`#trading`)

Unchanged behaviour: existing `saveAccount` form (account balance + currency,
keeps the risk%-sizing trade-backfill). Restyled to match (uses `ts-input`,
`ts-label`, `btn-primary`). Own Save button (separate action, separate concern).

### 3. Privacy  (`#privacy`)

- Visibility is folded into the Profile form (single Save). To keep the form
  wrapping a single contiguous DOM subtree, Privacy is rendered as a titled,
  bordered **block at the end of the Profile card** carrying `id="privacy"` for
  nav anchoring — **not** a separate `ts-card`. It uses the `ts-seg` segmented
  control (Public / Private). The left nav still lists it as its own item.
- Private is a paid perk. Free users: the Private option is disabled/locked with
  an inline upgrade nudge linking to `/settings/billing` (mirrors onboarding's
  `canGoPrivate`).
- Enforced server-side regardless of the client control via
  `resolveVisibility` (below) — fail-closed to public for free tier.

### 4. Billing & plan  (`#billing`)

Server-rendered summary: current tier label + status/renew/cancel line (reuse
`getTier` + `getSubscription` from `lib/server/entitlements`, same formatting as
`/settings/billing/page.tsx`). "Manage plan" `btn-ghost` → `/settings/billing`.

### 5. Account  (`#account`)

- Email shown read-only (`user.email`).
- Log out: existing `<form action="/auth/signout" method="post">` button.

## New server action — `saveProfileSettings`

Location: `src/app/actions/profile.ts` (alongside `saveOnboarding`).

```
export async function saveProfileSettings(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState>
```

Behaviour:
1. `getUser()`; redirect `/login` if absent.
2. Validate username via `validateUsername`; return `{ error }` if invalid.
3. Read fields: display_name, bio, experience_level, main_markets[],
   trading_styles[], goal, requested visibility (`is_public === 'public'`).
4. Resolve visibility: `is_public = resolveVisibility(tier, requested)` where
   `tier = await getTier(supabase, user.id)`.
5. `update(...)` the row. On `error.code === '23505'` →
   `{ error: 'That username is already taken.' }`; other errors →
   `{ error: error.message }`.
6. On success: `revalidatePath('/settings')` + `revalidatePath('/[username]', 'page')`
   (so the public profile reflects edits); return `{}` (no redirect — stay on
   settings, show "Saved.").

Note: `display_name`, `bio`, `goal` are trimmed; empty string → `null` for
nullable columns. `onboarding_completed` is **not** touched (already true).

## New pure helper — `resolveVisibility`

Location: `src/lib/profile.ts`.

```
export function resolveVisibility(tier: Tier, requestedPublic: boolean): boolean
```

- Free tier (`tier === 'free'`): always returns `true` (public) — fail-closed.
- Paid tier: returns `requestedPublic`.

Keeps the paid-perk rule in one unit-testable function, reused by the action.

## Data flow

`/settings/page.tsx` (server) fetches in parallel:
- profile row: `display_name, username, bio, avatar_url, experience_level,
  main_markets, trading_styles, goal, is_public, account_balance,
  account_currency`
- `tier = getTier(...)`, `sub = getSubscription(...)`

Passes profile + `canGoPrivate = tier !== 'free'` + billing summary into the
client form and section cards.

## Error handling

- Username taken → inline `ts-error` (23505).
- Free user requesting private → coerced to public by `resolveVisibility`;
  client also disables the Private control + shows the upgrade nudge.
- Avatar upload errors → handled inside `AvatarUploader` (unchanged).

## Testing

- **Unit** (`src/lib/__tests__` vitest): `resolveVisibility` — free coerces to
  public even when private requested; paid honors both choices.
- **e2e** (`tests/e2e/settings.spec.ts`, Playwright): sign up → onboard → open
  `/settings`; edit bio + display name, toggle a market chip, Save; navigate to
  the public profile and assert the new bio/name render. Plus a free-user
  privacy-gating assertion (Private control disabled). Written but flagged
  needs-warm-server, consistent with the existing stale-e2e suite situation
  (paths are root `/settings`, `/onboarding`, not `/app/*`).

## Files

New:
- `src/app/settings/settings.css`
- `src/app/settings/SettingsNav.tsx`
- `src/app/settings/ProfileSettingsForm.tsx`
- `tests/e2e/settings.spec.ts`
- `src/lib/__tests__/settings.test.ts` (or add to existing profile test)

Modified:
- `src/app/settings/page.tsx` (full rewrite to the hub layout)
- `src/app/actions/profile.ts` (+ `saveProfileSettings`)
- `src/lib/profile.ts` (+ `resolveVisibility`, import `Tier` type)
