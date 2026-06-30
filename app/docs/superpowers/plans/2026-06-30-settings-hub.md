# Settings Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/settings` as a polished settings hub (sticky sidebar nav + cards) that also lets users edit profile content currently editable only in onboarding, plus `bio`/`goal`.

**Architecture:** Server component page (`settings/page.tsx`) fetches profile + tier + subscription and renders a two-column grid: a client `SettingsNav` (scrollspy) and a body of cards. Profile + visibility edits go through one client form (`ProfileSettingsForm`, `useActionState`) calling a new `saveProfileSettings` server action; the account-balance form keeps its existing `saveAccount` action. Visibility is gated by a pure `resolveVisibility(tier, requested)` helper (fail-closed to public for free tier).

**Tech Stack:** Next.js App Router (RSC + server actions), React 19 `useActionState`, Supabase (`@supabase/ssr`), Tailwind v4 + global brand tokens, Vitest (unit), Playwright (e2e).

## Global Constraints

- App lives in `app/`; run all commands from `app/`. Routes are at root (`/settings`), NOT `/app/*` (basePath dropped).
- Reuse global classes from `src/app/globals.css`: `ts-card`, `ts-input`, `ts-textarea`, `ts-select`, `ts-label`, `ts-field`, `ts-chips`/`ts-chip`, `ts-seg`, `btn`, `btn-primary`, `btn-ghost`, `eyebrow`, `ts-error`, `h-app`, `h-main`. Only add NEW class rules in `settings.css`.
- Icon component: `@/app/[username]/_components/Icon` — available names include `users`, `chart`, `shield`, `globe`, `scale`, `medal`, `sliders`, `pencil`, `chevR`, `check`.
- Profile option lists come from `@/lib/profile`: `EXPERIENCE_LEVELS`, `MARKETS`, `TRADING_STYLES`.
- `Tier` type = `'free' | 'trader' | 'pro'` from `@/lib/entitlements`.
- Private profile is a paid perk: free tier is always public. Enforce server-side.
- Unit tests: `tests/unit/*.test.ts` run via `npm test`. e2e: `tests/e2e/*.spec.ts` via `npm run test:e2e` (needs warm dev server + email-confirm OFF).
- Username rules via `validateUsername` from `@/lib/username` (returns `{ ok: true } | { ok: false, error }`). Duplicate insert → Postgres error code `23505`.
- Commit after each task. Branch: `feat/settings-hub`.

---

### Task 1: `resolveVisibility` pure helper

**Files:**
- Modify: `src/lib/profile.ts` (append helper + import type)
- Test: `tests/unit/profile.test.ts` (append describe block)

**Interfaces:**
- Consumes: `Tier` from `@/lib/entitlements`.
- Produces: `resolveVisibility(tier: Tier, requestedPublic: boolean): boolean`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/profile.test.ts`:

```ts
import { resolveVisibility } from '@/lib/profile'

describe('resolveVisibility', () => {
  it('forces free tier to public even when private requested', () => {
    expect(resolveVisibility('free', false)).toBe(true)
    expect(resolveVisibility('free', true)).toBe(true)
  })
  it('honors the requested visibility for paid tiers', () => {
    expect(resolveVisibility('trader', false)).toBe(false)
    expect(resolveVisibility('trader', true)).toBe(true)
    expect(resolveVisibility('pro', false)).toBe(false)
    expect(resolveVisibility('pro', true)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/profile.test.ts`
Expected: FAIL — `resolveVisibility` is not exported / not a function.

- [ ] **Step 3: Write minimal implementation**

At the top of `src/lib/profile.ts` add the import, and append the helper at the end:

```ts
import type { Tier } from '@/lib/entitlements'
```

```ts
// Private profiles are a paid perk. Free tier is forced public (fail-closed);
// paid tiers may choose. Single source of truth for the visibility gate.
export function resolveVisibility(tier: Tier, requestedPublic: boolean): boolean {
  if (tier === 'free') return true
  return requestedPublic
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/profile.test.ts`
Expected: PASS (existing `onboardingToRow` tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/profile.ts tests/unit/profile.test.ts
git commit -m "feat(settings): resolveVisibility gate (free tier forced public)"
```

---

### Task 2: `saveProfileSettings` server action

**Files:**
- Modify: `src/app/actions/profile.ts` (add export)

**Interfaces:**
- Consumes: `resolveVisibility` (Task 1), `validateUsername` (`@/lib/username`), `getTier` (`@/lib/server/entitlements`), `ProfileState` type (already exported from this file).
- Produces: `saveProfileSettings(_prev: ProfileState, formData: FormData): Promise<ProfileState>`

- [ ] **Step 1: Add imports**

Ensure these imports exist at the top of `src/app/actions/profile.ts` (add the missing ones; `createClient`, `validateUsername`, `redirect`, `ProfileState` are already there):

```ts
import { revalidatePath } from 'next/cache'
import { getTier } from '@/lib/server/entitlements'
import { resolveVisibility } from '@/lib/profile'
```

- [ ] **Step 2: Implement the action**

Append to `src/app/actions/profile.ts`:

```ts
// Edits profile content from the settings hub. Unlike saveOnboarding it does NOT
// touch onboarding_completed and returns to the same page (no redirect) so the
// client form can show inline success/error.
export async function saveProfileSettings(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const username = String(formData.get('username') ?? '')
  const v = validateUsername(username)
  if (!v.ok) return { error: v.error }

  const clean = (key: string): string | null => {
    const s = String(formData.get(key) ?? '').trim()
    return s.length ? s : null
  }

  const tier = await getTier(supabase, user.id)
  const requestedPublic = formData.get('is_public') === 'public'

  const { error } = await supabase
    .from('profiles')
    .update({
      username,
      display_name: clean('display_name'),
      bio: clean('bio'),
      goal: clean('goal'),
      experience_level: String(formData.get('experience_level') ?? 'beginner'),
      main_markets: formData.getAll('main_markets').map(String),
      trading_styles: formData.getAll('trading_styles').map(String),
      is_public: resolveVisibility(tier, requestedPublic),
    })
    .eq('id', user.id)

  if (error) {
    if (error.code === '23505') return { error: 'That username is already taken.' }
    return { error: error.message }
  }

  revalidatePath('/settings')
  revalidatePath(`/${username}`)
  return {}
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/profile.ts
git commit -m "feat(settings): saveProfileSettings action with visibility gate"
```

---

### Task 3: Settings hub stylesheet + sidebar nav

**Files:**
- Create: `src/app/settings/settings.css`
- Create: `src/app/settings/SettingsNav.tsx`

**Interfaces:**
- Produces: default export `SettingsNav` (client component, no props). Renders nav links to `#profile`, `#trading`, `#privacy`, `#billing`, `#account` with scrollspy.

- [ ] **Step 1: Create the stylesheet**

Create `src/app/settings/settings.css`:

```css
/* Settings hub — two-column grid + sticky sidebar nav. Tokens from globals.css. */
.settings-grid {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 28px;
  align-items: start;
}
.settings-head { margin-bottom: 22px; }

.settings-nav {
  position: sticky; top: 84px;
  display: flex; flex-direction: column; gap: 4px;
}
.settings-navlink {
  display: flex; align-items: center; gap: 11px;
  padding: 10px 13px; border-radius: 11px;
  font-size: 14px; font-weight: 600; color: var(--dim);
  border: 1px solid transparent; cursor: pointer;
  transition: background .15s, color .15s, border-color .15s;
}
.settings-navlink:hover { background: var(--surface-2); color: var(--text); }
.settings-navlink[data-active="true"] {
  background: var(--brand-grad-soft); color: var(--violet-deep);
  border-color: var(--border-vio);
}
.settings-navlink svg { flex: none; }

.settings-body { display: flex; flex-direction: column; gap: 18px; }
.settings-section { scroll-margin-top: 84px; }
.settings-section .ts-h2 { display: flex; align-items: center; gap: 9px; }

/* visibility sub-block inside the profile card */
.settings-privacy {
  margin-top: 22px; padding-top: 22px;
  border-top: 1px solid var(--border);
  scroll-margin-top: 84px;
}
.settings-locknote {
  display: flex; align-items: center; gap: 8px; margin-top: 10px;
  font-size: 13px; color: var(--dim);
}
.settings-locknote a { color: var(--violet-br); font-weight: 600; }

.settings-foot {
  display: flex; align-items: center; gap: 14px;
  margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--border);
}
.settings-saved { font-size: 13.5px; font-weight: 600; color: var(--up); }

.settings-readonly {
  height: 46px; display: flex; align-items: center; padding: 0 14px;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 12px; color: var(--dim); font-size: 15px;
}

@media (max-width: 900px) {
  .settings-grid { grid-template-columns: 1fr; gap: 16px; }
  .settings-nav {
    position: static; flex-direction: row; overflow-x: auto;
    gap: 6px; padding-bottom: 4px;
  }
  .settings-navlink { white-space: nowrap; }
  .settings-navlink span.lab { display: inline; }
}
```

- [ ] **Step 2: Create the nav component**

Create `src/app/settings/SettingsNav.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/app/[username]/_components/Icon'

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: 'users' },
  { id: 'trading', label: 'Trading account', icon: 'chart' },
  { id: 'privacy', label: 'Privacy', icon: 'shield' },
  { id: 'billing', label: 'Billing & plan', icon: 'scale' },
  { id: 'account', label: 'Account', icon: 'sliders' },
] as const

export function SettingsNav() {
  const [active, setActive] = useState<string>('profile')

  useEffect(() => {
    const els = SECTIONS
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el)
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-80px 0px -55% 0px', threshold: 0 },
    )
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  return (
    <nav className="settings-nav" aria-label="Settings sections">
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="settings-navlink"
          data-active={active === s.id}
          onClick={() => setActive(s.id)}
        >
          <Icon name={s.icon} size={17} />
          <span className="lab">{s.label}</span>
        </a>
      ))}
    </nav>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Component is not yet imported anywhere — that's fine.)

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/settings.css src/app/settings/SettingsNav.tsx
git commit -m "feat(settings): hub stylesheet + scrollspy sidebar nav"
```

---

### Task 4: `ProfileSettingsForm` client component

**Files:**
- Create: `src/app/settings/ProfileSettingsForm.tsx`

**Interfaces:**
- Consumes: `saveProfileSettings` (Task 2), `AvatarUploader` (`@/app/_components/AvatarUploader`), `EXPERIENCE_LEVELS`/`MARKETS`/`TRADING_STYLES` (`@/lib/profile`), `Icon`.
- Produces: `ProfileSettingsForm` named export with props:

```ts
type Props = {
  avatarUrl: string | null
  username: string
  displayName: string
  bio: string
  goal: string
  experience: string
  markets: string[]
  styles: string[]
  isPublic: boolean
  canGoPrivate: boolean
}
```

- [ ] **Step 1: Create the component**

Create `src/app/settings/ProfileSettingsForm.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { saveProfileSettings } from '@/app/actions/profile'
import type { ProfileState } from '@/app/actions/profile'
import { AvatarUploader } from '@/app/_components/AvatarUploader'
import { EXPERIENCE_LEVELS, MARKETS, TRADING_STYLES } from '@/lib/profile'
import { Icon } from '@/app/[username]/_components/Icon'

type Props = {
  avatarUrl: string | null
  username: string
  displayName: string
  bio: string
  goal: string
  experience: string
  markets: string[]
  styles: string[]
  isPublic: boolean
  canGoPrivate: boolean
}

export function ProfileSettingsForm(props: Props) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(
    saveProfileSettings,
    {},
  )
  const saved = !pending && state && !state.error && '__saved' in (state as object) === false
  // NOTE: success = action resolved with no error. We surface it whenever
  // the action has run at least once without error.

  return (
    <>
      <section id="profile" className="ts-card settings-section">
        <h2 className="ts-h2"><Icon name="users" size={18} /> Profile</h2>
        <p className="ts-sub mb-5">How you appear across TradingSocial.</p>

        <div className="mb-6">
          <AvatarUploader current={props.avatarUrl} />
        </div>

        <form action={action} className="grid gap-4">
          <div className="ts-grid2">
            <label className="ts-field">
              <span className="ts-label">Display name</span>
              <input name="display_name" className="ts-input"
                defaultValue={props.displayName} placeholder="Your name" />
            </label>
            <label className="ts-field">
              <span className="ts-label">Username</span>
              <input name="username" className="ts-input" required
                defaultValue={props.username} placeholder="username" />
            </label>
          </div>

          <label className="ts-field">
            <span className="ts-label">Bio</span>
            <textarea name="bio" className="ts-textarea" rows={3}
              defaultValue={props.bio} placeholder="A line about how you trade." />
          </label>

          <label className="ts-field" style={{ maxWidth: 260 }}>
            <span className="ts-label">Experience</span>
            <select name="experience_level" className="ts-select"
              defaultValue={props.experience || 'beginner'}>
              {EXPERIENCE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>

          <div className="ts-field">
            <span className="ts-label">Main markets</span>
            <div className="ts-chips">
              {MARKETS.map((m) => (
                <label key={m} className="ts-chip">
                  <input type="checkbox" name="main_markets" value={m}
                    defaultChecked={props.markets.includes(m)} />
                  {m}
                </label>
              ))}
            </div>
          </div>

          <div className="ts-field">
            <span className="ts-label">Trading styles</span>
            <div className="ts-chips">
              {TRADING_STYLES.map((s) => (
                <label key={s} className="ts-chip">
                  <input type="checkbox" name="trading_styles" value={s}
                    defaultChecked={props.styles.includes(s)} />
                  {s}
                </label>
              ))}
            </div>
          </div>

          <label className="ts-field">
            <span className="ts-label">Goal</span>
            <textarea name="goal" className="ts-textarea" rows={2}
              defaultValue={props.goal} placeholder="What are you working toward?" />
          </label>

          {/* Privacy — folded into this form, anchored for the nav */}
          <div id="privacy" className="settings-privacy">
            <h2 className="ts-h2"><Icon name="shield" size={18} /> Privacy</h2>
            <p className="ts-sub mb-4">
              Public profiles appear on the leaderboard and can gain followers.
            </p>
            <div className="ts-seg">
              <label>
                <input type="radio" name="is_public" value="public"
                  defaultChecked={props.isPublic} />
                Public
              </label>
              <label>
                <input type="radio" name="is_public" value="private"
                  defaultChecked={!props.isPublic} disabled={!props.canGoPrivate} />
                Private
              </label>
            </div>
            {!props.canGoPrivate && (
              <p className="settings-locknote">
                <Icon name="shield" size={14} />
                Private journaling is a paid perk. <a href="/settings/billing">Upgrade</a> to go solo.
              </p>
            )}
          </div>

          {state?.error && <p className="ts-error">{state.error}</p>}

          <div className="settings-foot">
            <button className="btn btn-primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </button>
            {saved && <span className="settings-saved">Saved.</span>}
          </div>
        </form>
      </section>
    </>
  )
}
```

- [ ] **Step 2: Simplify the `saved` flag**

The `saved` expression above is convoluted. Replace it with a clear version — the action returns `{}` on success and `{ error }` on failure, so success after a run is simply "not pending, has run, no error". Track whether it ran via a ref is overkill; use: success shows when `state` is the empty object after submit. Replace the `const saved = …` line with:

```tsx
  // After a submit, success = no error on the returned state.
  // Initial state is also {} so we additionally require the form to have been used.
  const saved = state && !state.error && (state as { ok?: boolean }).ok === true
```

…and in the action (`saveProfileSettings`, Task 2) change the final `return {}` to `return { ok: true }`, and extend `ProfileState`:

In `src/app/actions/profile.ts`, change:

```ts
export type ProfileState = { error?: string }
```

to:

```ts
export type ProfileState = { error?: string; ok?: boolean }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/ProfileSettingsForm.tsx src/app/actions/profile.ts
git commit -m "feat(settings): ProfileSettingsForm with folded privacy + inline save state"
```

---

### Task 5: Rewrite the settings page (hub layout)

**Files:**
- Modify: `src/app/settings/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `SettingsNav` (Task 3), `ProfileSettingsForm` (Task 4), `saveAccount` (`@/app/actions/account`), `getTier`/`getSubscription` (`@/lib/server/entitlements`), `Icon`, `createClient`/`getSessionUser` (`@/lib/supabase/server`).

- [ ] **Step 1: Rewrite the page**

Replace the entire contents of `src/app/settings/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTier, getSubscription } from '@/lib/server/entitlements'
import { saveAccount } from '@/app/actions/account'
import { Icon } from '@/app/[username]/_components/Icon'
import { SettingsNav } from './SettingsNav'
import { ProfileSettingsForm } from './ProfileSettingsForm'
import './settings.css'

const PLAN_LABEL = { free: 'Free', trader: 'Trader', pro: 'Pro Trader' } as const

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, tier, sub] = await Promise.all([
    supabase
      .from('profiles')
      .select('username, display_name, bio, goal, avatar_url, experience_level, main_markets, trading_styles, is_public, account_balance, account_currency')
      .eq('id', user.id)
      .single(),
    getTier(supabase, user.id),
    getSubscription(supabase, user.id),
  ])

  const canGoPrivate = tier !== 'free'
  const renews = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString()
    : null

  return (
    <div className="h-app">
      <div className="h-main">
        <div className="settings-head">
          <p className="eyebrow">Account</p>
          <h1 className="ts-h1 mt-3">Settings</h1>
          <p className="ts-sub">@{profile?.username}</p>
        </div>

        <div className="settings-grid">
          <SettingsNav />

          <div className="settings-body">
            <ProfileSettingsForm
              avatarUrl={profile?.avatar_url ?? null}
              username={profile?.username ?? ''}
              displayName={profile?.display_name ?? ''}
              bio={profile?.bio ?? ''}
              goal={profile?.goal ?? ''}
              experience={profile?.experience_level ?? 'beginner'}
              markets={profile?.main_markets ?? []}
              styles={profile?.trading_styles ?? []}
              isPublic={profile?.is_public ?? true}
              canGoPrivate={canGoPrivate}
            />

            <section id="trading" className="ts-card settings-section">
              <h2 className="ts-h2"><Icon name="chart" size={18} /> Trading account</h2>
              <p className="ts-sub mb-4">Used to size trades by risk % and show P/L in money.</p>
              <form action={saveAccount} className="grid gap-3.5" style={{ maxWidth: 320 }}>
                <label className="ts-field">
                  <span className="ts-label">Account balance</span>
                  <input name="account_balance" type="number" step="0.01" min="0"
                    defaultValue={profile?.account_balance ?? 0} className="ts-input" />
                </label>
                <label className="ts-field">
                  <span className="ts-label">Currency</span>
                  <input name="account_currency" maxLength={3}
                    defaultValue={profile?.account_currency ?? 'USD'} className="ts-input" />
                </label>
                <button className="btn btn-primary">Save account</button>
              </form>
            </section>

            <section id="billing" className="ts-card settings-section">
              <h2 className="ts-h2"><Icon name="scale" size={18} /> Billing &amp; plan</h2>
              <p className="ts-sub mb-4">
                You&apos;re on the <b>{PLAN_LABEL[tier]}</b> plan
                {sub?.status && sub.status !== 'active' ? ` · ${sub.status}` : ''}.
                {sub?.cancelAtPeriodEnd && renews
                  ? ` Cancels on ${renews} — access continues until then.`
                  : renews ? ` Renews ${renews}.` : ''}
              </p>
              <a className="btn btn-ghost" href="/settings/billing">Manage plan</a>
            </section>

            <section id="account" className="ts-card settings-section">
              <h2 className="ts-h2"><Icon name="sliders" size={18} /> Account</h2>
              <p className="ts-sub mb-4">Your sign-in email and session.</p>
              <div className="ts-field mb-4" style={{ maxWidth: 360 }}>
                <span className="ts-label">Email</span>
                <div className="settings-readonly">{user.email}</div>
              </div>
              <form action="/auth/signout" method="post">
                <button className="btn btn-ghost">Log out</button>
              </form>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify in the browser (preview tools)**

Start the dev server, open `/settings` while logged in. Confirm: sidebar nav highlights the section while scrolling; profile form renders all fields with current values; chips reflect saved markets/styles; the Private radio is disabled for a free account with the upgrade nudge; trading/billing/account cards render. Edit the bio, click **Save changes**, confirm the "Saved." note appears and no console errors. Capture a screenshot.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat(settings): rebuild settings as a sidebar-nav hub"
```

---

### Task 6: e2e coverage

**Files:**
- Create: `tests/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: the running app at root paths (`/signup`, `/onboarding`, `/settings`, `/<username>`). Follow the signup→onboarding helper pattern already used in `tests/e2e/social.spec.ts` (read it first for the exact selectors and multi-step onboarding flow; usernames must stay ≤20 chars).

- [ ] **Step 1: Read an existing spec for the signup/onboarding helper**

Open `tests/e2e/social.spec.ts` (or `search.spec.ts`) and copy the established `signUp`/onboarding flow into the new spec — do NOT invent selectors. Reuse short-prefix + base36 username stamping.

- [ ] **Step 2: Write the spec**

Create `tests/e2e/settings.spec.ts` with two tests, using the copied helper:

```ts
import { test, expect } from '@playwright/test'
// import / inline the signUp+onboard helper copied from social.spec.ts

test('edits profile bio + display name and persists on the public profile', async ({ page }) => {
  const { username } = await signUpAndOnboard(page) // helper returns the handle
  await page.goto('/settings')

  await page.fill('input[name="display_name"]', 'Edited Name')
  await page.fill('textarea[name="bio"]', 'Scalping NAS100 since dawn.')
  // toggle a market chip on
  await page.getByText('crypto', { exact: true }).click()
  await page.getByRole('button', { name: /save changes/i }).click()
  await expect(page.getByText('Saved.')).toBeVisible()

  await page.goto(`/${username}`)
  await expect(page.getByText('Scalping NAS100 since dawn.')).toBeVisible()
  await expect(page.getByText('Edited Name')).toBeVisible()
})

test('free account cannot select Private', async ({ page }) => {
  await signUpAndOnboard(page)
  await page.goto('/settings')
  const privateRadio = page.locator('input[name="is_public"][value="private"]')
  await expect(privateRadio).toBeDisabled()
  await expect(page.getByText(/paid perk/i)).toBeVisible()
})
```

- [ ] **Step 3: Run the spec against a warm server**

Ensure `npm run dev` is already running (cold compile busts Playwright timeouts), then:
Run: `npm run test:e2e -- settings.spec.ts`
Expected: both tests PASS. If the signup helper drifts from the live onboarding flow, fix the helper (this is the known stale-e2e hazard — paths must be root `/settings`, not `/app/*`).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/settings.spec.ts
git commit -m "test(settings): e2e profile edit persistence + private gating"
```

---

## Self-Review Notes

- **Spec coverage:** layout/shell → T5; header → T5; SettingsNav scrollspy → T3; Profile fields incl. bio/goal → T4; Trading account → T5; Privacy folded + gated → T4 + T1/T2; Billing summary → T5; Account/email/logout → T5; `saveProfileSettings` → T2; `resolveVisibility` → T1; unit test → T1; e2e → T6. All covered.
- **Ordering:** `is_public` radios in T4 — when both `defaultChecked` could be true only one (`public`) is when `isPublic`; if `isPublic` false and free tier, `private` is disabled AND defaultChecked — acceptable (form posts `private`, server coerces to public via `resolveVisibility`; matches fail-closed intent). For a paid user the control is enabled.
- **Type consistency:** `ProfileState` extended to `{ error?, ok? }` in T4 Step 2; action returns `{ ok: true }`; form reads `state.ok`. Consistent.
- **Tier import:** `resolveVisibility` imports `Tier` type-only — no runtime cycle (`entitlements.ts` has no import from `profile.ts`).
