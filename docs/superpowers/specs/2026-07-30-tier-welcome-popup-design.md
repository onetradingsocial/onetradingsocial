# Tier welcome popup (post-onboarding + plan change) — Design

**Date:** 2026-07-30
**Status:** Approved design, pending implementation plan

## Goal

Show a celebratory welcome modal after a user finishes onboarding, with **one variant per
subscription tier** (Free / Trader / Pro Trader), and re-show it whenever the user's tier changes.

Source designs, supplied by the client as standalone HTML mockups:

- `TradingSocial Welcome Free (Standalone).html`
- `TradingSocial Welcome Trader (Standalone).html`
- `TradingSocial Welcome Pro Trader (Standalone).html`

Requirements captured during brainstorming:

- Fires **after onboarding completes**, and again on **every plan change** (not upgrades only).
- **Suppressed while the end-of-trial wall is up.** Once the user answers the wall, the popup fires
  for whichever tier they settle on.
- Trial users see the **Pro Trader variant with an honest price line** — they hold Pro features, but
  they have paid nothing and given no card, so the mockup's "$50 / month · billed monthly" must not
  be shown to them.
- Dismissible: close button, "Maybe later", and backdrop click all close it.

## Background (current state)

### The mockups are one component, not three

Diffing the three extracted templates, they are byte-identical apart from **eight** fields:

| Field | Free | Trader | Pro Trader |
| --- | --- | --- | --- |
| `aria-label` | `Welcome to free` | `Welcome to trader` | `Welcome to pro` |
| Badge icon | person outline | bar chart | shield |
| Eyebrow | `You're on Free` | `You're on Trader` | `You're on Pro Trader` |
| Headline `<em>` | `Free` | `Trader` | `Pro Trader` |
| Subtitle | profile is live, no card | unlimited journaling… | full platform… |
| Price line | `$0 / month · free forever` | `$30 / month · billed monthly` | `$50 / month · billed monthly` |
| 6 feature rows | title + description each | " | " |
| CTA | `Explore your Profile` → Profile | `Explore your Journal` → Journal | `Explore Journal` → Journal |

Everything else — banner, confetti, burst, progress track, ring draw, feature reveal cascade, and
the entire 8.4 KB `.wpop-*` CSS block with its 16 `wpop*` keyframes — is shared. So this is **one
component driven by a tier config map**, not three components.

### The CSS ports cleanly

The `.wpop-*` block references 16 CSS custom properties — `--brand-grad`, `--brand-grad-soft`,
`--surface`, `--surface-3`, `--bg-2`, `--border`, `--border-vio`, `--violet-br`, `--dim`, `--faint`,
`--faintest`, `--display`, `--mono`, `--radius-lg`, `--shadow`, `--shadow-lg` — and **all 16 already
exist** in `app/src/app/globals.css`. The CTA's `.btn`/`.btn-primary` classes exist too
(`globals.css:164`, `globals.css:173`). The mockups were built on the app's own design system, so no
new design tokens are required.

Three things the mockup CSS lacks and must gain:

1. `z-index: 10` on `.wpop-backdrop` — **below the app nav** (40–46). Must be raised.
2. **No media queries at all.** The modal is `width: 100%; max-width: 460px`, so it is already
   fluid, but banner/body padding of 32px is tight at 375px.
3. **No `prefers-reduced-motion` handling**, while the app respects it elsewhere
   (`globals.css:1085`, `:2243`, `:2255`).

### Current signup flow

`/signup` → `/welcome` (trial starts; `TrialWelcome.tsx`) → `/onboarding` → `saveOnboarding()`
redirects to `/?signup=1&cid=…` (`app/src/app/actions/profile.ts:102`).

### Tier resolution

`getEntitlements()` (`app/src/lib/server/entitlements.ts`) does one pass over `profiles`
(`comp_tier, trial_started_at, trial_ack_at`) and `subscriptions` (`tier, status`), then returns
`{ tier, gate }`. `effectiveTier()` (`app/src/lib/entitlements.ts:66`) takes the highest of comp
grant, Stripe tier, and an active trial's implicit `pro`.

`layout.tsx:41` already calls `getEntitlements()` for every authenticated request and renders
`<TrialGateModal show={!!gate?.showWall} />` at `layout.tsx:69`. Its own parallel profiles read
(`layout.tsx:40`) selects `account_balance, is_public, is_internal` — note it does **not** currently
fetch `username`.

### The trial collision

**Every new signup gets 14 days of free Pro with no card.** So `effectiveTier()` returns `'pro'` for
a brand-new onboarded user. Keying the variant on tier alone would show *every* new user the Pro
Trader popup reading "$50 / month · billed monthly" — false for the exact population that sees it
most. Hence the trial-aware price line below.

Equally, **trial expiry is mechanically a `pro`→`free` change.** Every trialist who does not
subscribe drops tier on day 14, so a naive "tier changed" rule would stack a confetti "Welcome to
Free" on top of the non-escapable `TrialGateModal`. Hence the wall suppression below.

## Design

### 1. Data model — `0043_welcome_tier_seen.sql`

Add one nullable column recording the last tier we have celebrated:

```sql
alter table public.profiles
  add column if not exists welcome_tier_seen text;
```

`NULL` means "never celebrated" → the popup is due.

**The migration must backfill.** Without it, every existing user's `NULL` fails to match their
current tier and the whole userbase gets a popup on next page load. The backfill sets
`welcome_tier_seen` to the SQL-computed effective tier for rows where `onboarding_completed = true`,
mirroring `effectiveTier()`:

- highest `tier` among `subscriptions` rows with `status in ('active','trialing')`, ranked
  `pro > trader > free`; else
- `comp_tier` when it is `'trader'`/`'pro'`; else
- `'pro'` when `trial_started_at` is within 14 days and `trial_ack_at is null`; else
- `'free'`.

Rows with `onboarding_completed <> true` are **left `NULL`**, so users mid-onboarding still get the
popup when they finish.

Known backfill gap: the `ADMIN_EMAILS` override lives in env, not SQL, so an admin whose stored tier
is lower than the `pro` the app computes will see the Pro popup once. Accepted — it affects only
admin accounts and self-corrects on dismissal.

**Grants: none.** Per the doctrine in `0042_profiles_column_grants.sql`, `authenticated` receives
column-level `UPDATE` only on columns the app writes with a *user* client. `welcome_tier_seen` is
written exclusively by `ackWelcome()` through the service client, exactly like `trial_ack_at`, so it
must be **left out** of that grant list.

### 2. Server — extend `getEntitlements()`

Add `welcome_tier_seen` to the **existing** profiles select, so this costs no extra round trip, and
return a third field:

```ts
export type WelcomeState = { show: boolean; tier: Tier }
export type Entitlements = { tier: Tier; gate: TrialGate; welcome: WelcomeState }
```

Decision rule, as a pure helper in `app/src/lib/entitlements.ts` so it is unit-testable:

```ts
export function shouldShowWelcome(
  seen: string | null | undefined,
  tier: Tier,
  trial: TrialState,
  showWall: boolean,
  onboarded: boolean,
): boolean
```

Returns `true` only when **all** hold:

- `onboarded` — the root layout also wraps `/welcome` and `/onboarding`, so without this gate the
  popup renders on top of the very signup flow it is supposed to follow. `onboarding_completed` is
  read in the same profiles select.
- `seen !== tier` (tier changed, or never celebrated)
- `!showWall` (never compete with the wall)
- `trial !== 'expired'` (never celebrate the day-14 drop)

Fails **closed** (no popup) on a profiles read error, matching the tier's fail-closed direction —
a spurious celebration is worse than a missed one.

Decision table to encode in tests (all rows `onboarded = true` except the last):

| `seen` | tier | trial | wall | onboarded | show |
| --- | --- | --- | --- | --- | --- |
| `null` | pro | active | false | true | **yes** — new trialist, post-onboarding |
| `pro` | pro | active | false | true | no — already celebrated |
| `null` | free | none | false | true | **yes** — new user, no trial |
| `pro` | free | expired | true | true | no — wall is up |
| `pro` | free | expired | false | true | no — trial-expiry drop |
| `pro` | free | resolved | false | true | **yes** — answered wall, settled on Free |
| `pro` | trader | resolved | false | true | **yes** — answered wall, subscribed |
| `free` | trader | none | false | true | **yes** — upgrade |
| `pro` | free | none | false | true | **yes** — churn (see Accepted trade-offs) |
| `null` | pro | active | false | **false** | no — still mid-onboarding |

### 3. Component — `WelcomeModal.tsx` + `welcome-tiers.ts`

`app/src/lib/welcome-tiers.ts` holds the config map — the eight varying fields per tier, typed
`Record<Tier, WelcomeTierCopy>`, with feature rows as `{ t: string; d: string }[]`. Copy is taken
verbatim from the mockups. Kept separate from `plans.ts`, whose `PAID_PLANS` has no `free` entry and
serves the billing surfaces.

`app/src/app/_components/WelcomeModal.tsx` is a client component that ports the mockup markup 1:1,
rendered through `createPortal` like `TrialGateModal`. Two deliberate departures from the mockup
script:

- **Timer cleanup.** The mockup fires eight bare `setTimeout`s plus a `setInterval`. In React these
  outlive unmount and would write to detached nodes. The sequence runs in one `useEffect` that
  tracks its handles and clears them all on cleanup.
- **Trial-aware price line.** When `gate.state === 'active'`, the price renders
  **"14 days free · then choose a plan"** rather than the tier's own price string. This is the only
  copy the app overrides.

Dismissal (close button / "Maybe later" / backdrop click / Escape) closes optimistically, then calls
a server action:

```ts
// app/src/app/actions/welcome.ts
export async function ackWelcome(tier: Tier): Promise<void>
```

which writes `welcome_tier_seen = tier` for the current user. Optimistic close means a failed write
costs at most one repeat showing, never a stuck modal.

**The CTA is the exception and must not be fire-and-forget.** Next transports a server action over a
plain `fetch()` with no `keepalive`, so a document navigation aborts it — exactly why `lib/track.ts`
uses `sendBeacon`/`keepalive`. A bare `<a href>` CTA with an un-awaited `ackWelcome()` therefore
frequently fails to persist `welcome_tier_seen` on the *most common* dismissal path, and the popup
returns on the user's next visit. The CTA click must `preventDefault()`, close the modal visually for
instant feedback, `await ackWelcome(tier)` in a try/catch so a failed write still navigates rather
than trapping the user, and only then `router.push(href)`. The other four paths trigger no
navigation, so they may stay fire-and-forget.

Accessibility: `role="dialog"`, `aria-modal="true"`, the per-tier `aria-label`, focus moved to the
card on open, focus trap while open, and focus restored on close. Unlike the wall, Escape **does**
close this one.

### 4. CSS — port the `.wpop-*` block into `globals.css`

Appended as its own section, verbatim apart from:

- `.wpop-backdrop` `z-index: 10` → **`900`**. Above the nav (46) and `.ts-modal-backdrop` (60), but
  below `.tg-backdrop`'s `1000` — so the trial wall renders above this popup even if the
  suppression rule ever regressed. Defence in depth.
- A `@media (max-width: 420px)` rule trimming banner padding `44px 32px 78px` → `36px 20px 70px` and
  body padding `28px 32px 32px` → `24px 20px 26px`.
- A `@media (prefers-reduced-motion: reduce)` block setting `animation: none` across `.wpop-*` and
  forcing the end state (`opacity: 1; transform: none`) on the elements the JS sequence animates in,
  so a reduced-motion user sees the finished modal immediately.

The 16 `wpop*` keyframes are already uniquely prefixed and cannot collide with existing app
keyframes.

### 5. Mount

In `layout.tsx`, beside the existing wall. Note `ent` is block-scoped inside `if (user)`, so
`welcome` and `username` must be hoisted alongside the existing `let gate` / `let tier`
(`layout.tsx:34-35`):

```tsx
let welcome: WelcomeState | null = null
let username: string | null = null
// …inside if (user): welcome = ent.welcome; username = data?.username ?? null
```

```tsx
{user && <TrialGateModal show={!!gate?.showWall} />}
{user && welcome?.show && (
  <WelcomeModal
    tier={welcome.tier}
    username={username}
    trialActive={gate?.state === 'active'}
  />
)}
```

Mounting in the layout rather than on `/` is what lets a plan change fire the popup from any page.

### 6. CTA destinations

| Tier | Label | Href |
| --- | --- | --- |
| free | Explore your Profile | `/{username}` |
| trader | Explore your Journal | `/journal` |
| pro | Explore Journal | `/journal` |

The free variant needs the username to build its href, so `username` must be **added** to the
existing `layout.tsx:40` profiles select (`account_balance, is_public, is_internal, username`) and
passed through. Widening a select the layout already issues costs no extra round trip.

If the username is somehow missing, the free variant falls back to `/settings` (the single settings
page that hosts `ProfileSettingsForm`) rather than rendering a broken `/undefined` link.

### 7. Analytics

Fire `track('welcome_popup_shown', { tier })` on open and `welcome_popup_dismissed` with
`{ tier, action: 'cta' | 'later' | 'close' }`, using the existing `track()` helper — so we can see
whether the CTA actually routes new users into the journal.

## Testing

**Unit** (`app/tests/unit/`):

- `shouldShowWelcome()` against the full decision table in §2, including both fail-closed paths.
- The backfill's tier ranking logic, if extracted to a helper.
- `welcome-tiers.ts`: every `Tier` key present, exactly 6 feature rows each, no empty strings.

**E2E** (`app/tests/e2e/`):

- New user completes onboarding → popup appears with the Pro variant and the **trial** price line,
  not "$50 / month".
- Dismiss → reload → popup does not reappear.
- With the wall showing, the popup does not render.
- Reduced-motion emulation: the CTA is visible and clickable immediately.

**Existing-suite regression (must be handled, not just tested).** 17 e2e specs complete onboarding
and then interact with the app, and each defines its own local `signUpAndOnboard()` helper (11 files)
or inlines the flow (6 files) — none of it is shared. Those helpers all end on `/`, which is exactly
where this popup now appears, behind a full-screen backdrop at `z-index: 900` with
`body { overflow: hidden }`. Every one of them would start failing on the first post-onboarding
click. The implementation must therefore add a shared `dismissWelcome(page)` helper and call it at
the end of each onboarding flow.

## Accepted trade-offs

- **A paying Pro subscriber never sees the Pro popup.** They were already `pro` via the trial, so
  converting is not a tier change. Inherent to keying on tier; keying on billing events instead
  would be a materially bigger build.
- **Churn fires a "Welcome to Free" celebration.** Cancelling drops `pro`→`free`, which "every plan
  change" treats as a change worth celebrating. Rarer than trial expiry, which is handled, and the
  Free variant's copy ("your profile is live", "no card required") reads acceptably as
  "here's what you keep".
- **A mid-trial Trader subscription is silent.** `effectiveTier` keeps such a user at `pro` (the
  trial is a deliberate gift, per `shouldAckTrialOnSubscription`), so no tier change occurs and no
  popup fires until the trial resolves.

## Out of scope

- Reworking `/welcome`'s `TrialWelcome` pre-onboarding screen. It stays as-is; this popup lands
  *after* onboarding.
- Any change to trial length, the wall's behaviour, or Stripe wiring.
- A fourth trial-specific variant. The Pro variant plus the overridden price line covers it.

## Deployment notes

- Migration `0043` must be applied to **dev and prod** by hand, per project convention.
- The backfill is the risk step: verify on dev that `welcome_tier_seen` is populated for all
  `onboarding_completed = true` rows **before** the code ships, otherwise existing users get a
  popup blast.
