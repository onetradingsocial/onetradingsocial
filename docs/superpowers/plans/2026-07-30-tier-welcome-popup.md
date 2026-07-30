# Tier Welcome Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a celebratory, tier-specific welcome modal after onboarding completes and again on every subscription tier change, ported faithfully from the client's three standalone HTML mockups.

**Architecture:** One `WelcomeModal` client component driven by a `WELCOME_TIERS` config map, because the three mockups differ in only eight fields. A new `profiles.welcome_tier_seen` column records the last tier celebrated; the popup shows whenever the effective tier differs from it. A pure `shouldShowWelcome()` helper carries all the suppression rules so they are unit-testable. Mounted in the root layout so a plan change fires it from any page.

**Tech Stack:** Next.js 15 App Router (server components + server actions), Supabase (Postgres + RLS), TypeScript, Vitest (unit), Playwright (e2e), plain CSS in `globals.css`.

## Global Constraints

- **Design fidelity is a hard requirement.** Markup, copy, icon paths and animation timings come verbatim from the client's mockups in `D:\Library\Downloads\TradingSocial Welcome {Free,Trader,Pro Trader} (Standalone).html`. Do not reword copy, re-time animations, or substitute icons.
- **Copy uses real Unicode punctuation:** em dash `—` (U+2014) and middle dot `·` (U+00B7). Not `-` and not `*`.
- Working directory for all commands: `D:\Work\OneTradingSocial\Website\app`.
- Unit tests: `npm test` (vitest). E2E: `npm run test:e2e` (playwright).
- `welcome_tier_seen` is **service-role-only**. Per `0042_profiles_column_grants.sql`, never add it to the `grant update (...) on public.profiles to authenticated` list — writes go through `createServiceClient()`.
- Tier type is `'free' | 'trader' | 'pro'` from `@/lib/entitlements`. The Pro tier's display name is **"Pro Trader"**.
- Migrations are applied to dev and prod **by hand** by the project owner. Do not attempt to apply to prod.
- Every task ends with a commit. Do not push.

---

### Task 1: Migration 0043 — `welcome_tier_seen` column + backfill

The backfill is the whole risk of this feature: without it, every existing user's `NULL` fails to match their current tier and the entire userbase gets a popup on next page load.

**Files:**
- Create: `app/supabase/migrations/0043_welcome_tier_seen.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `public.profiles.welcome_tier_seen text` (nullable). `NULL` = never celebrated. Values are exactly `'free' | 'trader' | 'pro'`.

- [ ] **Step 1: Write the migration**

Create `app/supabase/migrations/0043_welcome_tier_seen.sql`:

```sql
-- Tier welcome popup state. Records the last tier we have celebrated for this
-- user, so the popup fires once after onboarding and again on every tier
-- change. NULL means "never celebrated" -> the popup is due.
alter table public.profiles
  add column if not exists welcome_tier_seen text;

comment on column public.profiles.welcome_tier_seen is
  'Last subscription tier celebrated by the welcome popup (free|trader|pro). NULL = never shown.';

-- Deliberately NOT added to the column-level UPDATE grant from 0042: this is
-- written only by ackWelcome() through the service client, exactly like
-- trial_ack_at. A user with a direct PostgREST grant could not do real harm
-- here, but the 0042 doctrine is that `authenticated` gets only the columns the
-- app writes with a USER client, and this is not one of them.

-- BACKFILL. Without this, every existing user's NULL fails to match their
-- current tier and the whole userbase gets a popup on their next page load.
--
-- Mirrors effectiveTier() in app/src/lib/entitlements.ts: the highest of
-- (comp grant, active/trialing Stripe subscription, active 14-day trial).
-- Ranked numerically because SQL has no tier ordering: pro=2, trader=1, free=0.
--
-- Rows with onboarding_completed <> true are left NULL on purpose, so a user
-- who is still mid-onboarding still gets their popup when they finish.
-- `onboarding_completed = true` also excludes NULLs, which is the behaviour we
-- want (NULL = not yet onboarded).
--
-- Known gap: the ADMIN_EMAILS override lives in env, not SQL, so an admin whose
-- stored tier ranks below the 'pro' the app computes will see the Pro popup
-- once. Accepted -- admin accounts only, and it self-corrects on dismissal.
with eff as (
  select
    p.id,
    greatest(
      case p.comp_tier when 'pro' then 2 when 'trader' then 1 else 0 end,
      coalesce((
        select max(case s.tier when 'pro' then 2 when 'trader' then 1 else 0 end)
        from public.subscriptions s
        where s.user_id = p.id
          and s.status in ('active', 'trialing')
      ), 0),
      case
        when p.trial_started_at is not null
         and p.trial_ack_at is null
         and p.trial_started_at > now() - interval '14 days'
        then 2 else 0
      end
    ) as rank
  from public.profiles p
  where p.onboarding_completed = true
    and p.welcome_tier_seen is null
)
update public.profiles p
set welcome_tier_seen = case eff.rank when 2 then 'pro' when 1 then 'trader' else 'free' end
from eff
where eff.id = p.id;
```

- [ ] **Step 2: Apply to the dev database**

Apply `0043_welcome_tier_seen.sql` to the **dev** Supabase project only (the separate dev project, not live).

- [ ] **Step 3: Verify the backfill left no onboarded user unset**

Run against dev:

```sql
select
  count(*) filter (where onboarding_completed = true and welcome_tier_seen is null) as onboarded_unset,
  count(*) filter (where onboarding_completed = true) as onboarded_total,
  welcome_tier_seen, count(*)
from public.profiles
group by welcome_tier_seen;
```

Expected: `onboarded_unset = 0`. Any other result means the backfill missed rows — stop and fix before continuing, because shipping the code with unset rows causes a popup blast.

- [ ] **Step 4: Verify the column is not user-writable**

```sql
select privilege_type, grantee
from information_schema.column_privileges
where table_name = 'profiles' and column_name = 'welcome_tier_seen';
```

Expected: **no** `UPDATE` row for `authenticated` or `anon`.

- [ ] **Step 5: Commit**

```bash
git add app/supabase/migrations/0043_welcome_tier_seen.sql
git commit -m "feat(welcome): add profiles.welcome_tier_seen with backfill"
```

---

### Task 2: `shouldShowWelcome()` pure helper

**Files:**
- Modify: `app/src/lib/entitlements.ts` (append after `shouldShowWall`, around line 96)
- Test: `app/tests/unit/welcome.test.ts` (create)

**Interfaces:**
- Consumes: `Tier`, `TrialState` from `@/lib/entitlements`.
- Produces: `shouldShowWelcome(seen: string | null | undefined, tier: Tier, trial: TrialState, showWall: boolean, onboarded: boolean): boolean`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/welcome.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shouldShowWelcome } from '@/lib/entitlements'

describe('shouldShowWelcome', () => {
  it('shows for a new trialist who just finished onboarding', () => {
    expect(shouldShowWelcome(null, 'pro', 'active', false, true)).toBe(true)
  })

  it('does not show once that tier has been celebrated', () => {
    expect(shouldShowWelcome('pro', 'pro', 'active', false, true)).toBe(false)
  })

  it('shows for a new user with no trial', () => {
    expect(shouldShowWelcome(null, 'free', 'none', false, true)).toBe(true)
  })

  it('never shows while the end-of-trial wall is up', () => {
    expect(shouldShowWelcome('pro', 'free', 'expired', true, true)).toBe(false)
  })

  it('never celebrates the day-14 trial expiry drop', () => {
    expect(shouldShowWelcome('pro', 'free', 'expired', false, true)).toBe(false)
  })

  it('shows once the wall is answered and the user settled on Free', () => {
    expect(shouldShowWelcome('pro', 'free', 'resolved', false, true)).toBe(true)
  })

  it('shows once the wall is answered and the user subscribed', () => {
    expect(shouldShowWelcome('pro', 'trader', 'resolved', false, true)).toBe(true)
  })

  it('shows on an upgrade', () => {
    expect(shouldShowWelcome('free', 'trader', 'none', false, true)).toBe(true)
  })

  it('shows on churn back to free', () => {
    expect(shouldShowWelcome('pro', 'free', 'none', false, true)).toBe(true)
  })

  it('never shows before onboarding is completed', () => {
    // Otherwise it renders on top of /welcome and /onboarding, which the root
    // layout also wraps.
    expect(shouldShowWelcome(null, 'pro', 'active', false, false)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/welcome.test.ts`
Expected: FAIL — `shouldShowWelcome is not a function` / no matching export.

- [ ] **Step 3: Write the implementation**

Append to `app/src/lib/entitlements.ts`, directly after `shouldShowWall`:

```ts
/** Whether to show the tier welcome popup.
 *
 *  `seen` is profiles.welcome_tier_seen — the last tier we celebrated, NULL for
 *  a user who has never seen it. A mismatch against the effective tier means
 *  either "never celebrated" or "tier changed", which are the same event as far
 *  as this popup is concerned.
 *
 *  Three suppressions, each earning its place:
 *    * !onboarded — the root layout also wraps /welcome and /onboarding, so
 *      without this the popup lands on top of the signup flow it is meant to
 *      follow.
 *    * showWall — never compete with the non-escapable end-of-trial wall.
 *    * trial 'expired' — trial expiry IS mechanically a pro->free change, so a
 *      naive tier diff would fire a confetti "Welcome to Free" at exactly the
 *      moment the user lost Pro. Once they answer the wall the state becomes
 *      'resolved' and the popup fires for the tier they settled on. */
export function shouldShowWelcome(
  seen: string | null | undefined,
  tier: Tier,
  trial: TrialState,
  showWall: boolean,
  onboarded: boolean,
): boolean {
  if (!onboarded) return false
  if (showWall) return false
  if (trial === 'expired') return false
  return seen !== tier
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/welcome.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/entitlements.ts app/tests/unit/welcome.test.ts
git commit -m "feat(welcome): add shouldShowWelcome decision helper"
```

---

### Task 3: `welcome-tiers.tsx` config map

All copy, icon paths and CTA text for the three variants. **Every string here is verbatim from the mockups** — see the Global Constraints note on Unicode punctuation.

**Files:**
- Create: `app/src/lib/welcome-tiers.tsx` (`.tsx`, not `.ts` — it contains JSX for the badge icons; the import specifier stays `@/lib/welcome-tiers`)
- Test: `app/tests/unit/welcome-tiers.test.ts`

**Interfaces:**
- Consumes: `Tier` from `@/lib/entitlements`.
- Produces:
  ```ts
  export type WelcomeFeat = { t: string; d: string }
  export type WelcomeCopy = {
    aria: string; eyebrow: string; em: string; sub: string; price: string
    cta: string; href: string; icon: ReactNode; feats: WelcomeFeat[]
  }
  export const WELCOME_TIERS: Record<Tier, WelcomeCopy>
  export const TRIAL_PRICE: string
  ```

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/welcome-tiers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { WELCOME_TIERS, TRIAL_PRICE } from '@/lib/welcome-tiers'
import type { Tier } from '@/lib/entitlements'

const TIERS: Tier[] = ['free', 'trader', 'pro']

describe('WELCOME_TIERS', () => {
  it('covers every tier', () => {
    for (const t of TIERS) expect(WELCOME_TIERS[t]).toBeDefined()
  })

  it('gives every tier exactly six features with no blanks', () => {
    for (const t of TIERS) {
      const c = WELCOME_TIERS[t]
      expect(c.feats).toHaveLength(6)
      for (const f of c.feats) {
        expect(f.t.trim().length).toBeGreaterThan(0)
        expect(f.d.trim().length).toBeGreaterThan(0)
      }
    }
  })

  // NB: `href` is deliberately excluded — free's href is '' by design, resolved
  // at render time from the username. Including it here would contradict the
  // routing test below.
  it('has no empty text fields', () => {
    for (const t of TIERS) {
      const c = WELCOME_TIERS[t]
      for (const k of ['aria', 'eyebrow', 'em', 'sub', 'price', 'cta'] as const) {
        expect(c[k].trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the client copy verbatim, including Unicode punctuation', () => {
    expect(WELCOME_TIERS.free.price).toBe('$0 / month · free forever')
    expect(WELCOME_TIERS.trader.price).toBe('$30 / month · billed monthly')
    expect(WELCOME_TIERS.pro.price).toBe('$50 / month · billed monthly')
    expect(WELCOME_TIERS.pro.em).toBe('Pro Trader')
    expect(WELCOME_TIERS.trader.feats[0].d).toBe('No more 30-trade cap — log everything, forever')
    expect(WELCOME_TIERS.free.sub).toContain('—')
  })

  it('routes free to the profile and paid tiers to the journal', () => {
    expect(WELCOME_TIERS.free.href).toBe('')       // resolved at render from username
    expect(WELCOME_TIERS.trader.href).toBe('/journal')
    expect(WELCOME_TIERS.pro.href).toBe('/journal')
  })

  it('offers a trial price line that does not claim a charge', () => {
    expect(TRIAL_PRICE).toBe('14 days free · then choose a plan')
    expect(TRIAL_PRICE).not.toContain('$')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/welcome-tiers.test.ts`
Expected: FAIL — cannot resolve `@/lib/welcome-tiers`.

- [ ] **Step 3: Write the implementation**

Create `app/src/lib/welcome-tiers.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { Tier } from '@/lib/entitlements'

/** Per-tier copy for the post-onboarding welcome popup.
 *
 *  Every string is verbatim from the client's standalone mockups
 *  (TradingSocial Welcome {Free,Trader,Pro Trader} (Standalone).html) — the three
 *  files are byte-identical apart from the eight fields modelled here, so they
 *  are one component with a config map rather than three components.
 *
 *  Kept separate from plans.ts, whose PAID_PLANS has no 'free' entry and serves
 *  the billing surfaces with different copy. */
export type WelcomeFeat = { t: string; d: string }

export type WelcomeCopy = {
  aria: string
  eyebrow: string
  em: string
  sub: string
  price: string
  cta: string
  /** Empty for 'free', whose CTA needs the username — resolved at render. */
  href: string
  icon: ReactNode
  feats: WelcomeFeat[]
}

/** Shown instead of the tier's own price while a no-card trial is active: a
 *  trialist holds Pro features but has paid nothing, so "$50 / month · billed
 *  monthly" would be plainly false for them. */
export const TRIAL_PRICE = '14 days free · then choose a plan'

export const WELCOME_TIERS: Record<Tier, WelcomeCopy> = {
  free: {
    aria: 'Welcome to free',
    eyebrow: "You're on Free",
    em: 'Free',
    sub: 'Your trading profile is live. Log trades, follow traders, and start building your track record — no card required.',
    price: '$0 / month · free forever',
    cta: 'Explore your Profile',
    href: '',
    icon: (
      <>
        <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="2" />
        <path d="M5 20a7 7 0 0114 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    feats: [
      { t: 'Public trading profile', d: 'Your handle, stats and history, visible to the community' },
      { t: 'Basic trading journal', d: 'Manually log trades and tag how each one went' },
      { t: 'Basic stats dashboard', d: 'Win rate and P&L at a glance' },
      { t: 'Follow traders & newsfeed', d: 'See what disciplined traders are doing, in real time' },
      { t: 'Earn XP & badges', d: 'Level up as you journal and learn consistently' },
      { t: 'Public leaderboard access', d: 'See where you rank against the community' },
    ],
  },
  trader: {
    aria: 'Welcome to trader',
    eyebrow: "You're on Trader",
    em: 'Trader',
    sub: 'You just unlocked unlimited journaling, deeper analytics, and the full learning hub — everything to sharpen your edge.',
    price: '$30 / month · billed monthly',
    cta: 'Explore your Journal',
    href: '/journal',
    icon: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
    feats: [
      { t: 'Unlimited journal entries', d: 'No more 30-trade cap — log everything, forever' },
      { t: 'Advanced journal & full dashboard', d: 'Deeper performance breakdowns on every trade' },
      { t: 'Strategy tracking & mistake tagging', d: 'See exactly which setups and habits cost you' },
      { t: 'Weekly performance review', d: 'A standing check-in on risk and consistency' },
      { t: 'Advanced leaderboard filters', d: 'Compare yourself against traders like you' },
      { t: 'Full beginner & intermediate courses', d: 'The entire learning hub, unlocked' },
    ],
  },
  pro: {
    aria: 'Welcome to pro',
    eyebrow: "You're on Pro Trader",
    em: 'Pro Trader',
    sub: 'The full platform is yours — advanced analytics, premium courses, a creator-style profile, and competition eligibility.',
    price: '$50 / month · billed monthly',
    cta: 'Explore Journal',
    href: '/journal',
    icon: <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
    feats: [
      { t: 'Full advanced analytics & reporting', d: 'Every metric serious traders track, in one view' },
      { t: 'Monthly trader report', d: 'A downloadable summary of your month, automatically' },
      { t: 'AI journal insights', d: 'Pattern detection on your habits — coming soon' },
      { t: 'Premium courses & psychology modules', d: 'Advanced curriculum most traders never see' },
      { t: 'Creator-style profile & Pro badge', d: 'Stand out across leaderboards and feeds' },
      { t: 'Premium challenges & competitions', d: 'Eligible for prize competitions as they launch' },
    ],
  },
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/welcome-tiers.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/welcome-tiers.tsx app/tests/unit/welcome-tiers.test.ts
git commit -m "feat(welcome): add per-tier welcome copy config"
```

---

### Task 4: Return `welcome` from `getEntitlements()`

**Files:**
- Modify: `app/src/lib/server/entitlements.ts`

**Interfaces:**
- Consumes: `shouldShowWelcome()` (Task 2).
- Produces: `Entitlements` gains `welcome: WelcomeState` where `WelcomeState = { show: boolean; tier: Tier }`.

- [ ] **Step 1: Widen the profiles select**

In `getEntitlements()`, change the profiles select (currently `'comp_tier, trial_started_at, trial_ack_at'`) to add the two new fields. This costs no extra round trip — it is the same query.

```ts
      svc.from('profiles')
        .select('comp_tier, trial_started_at, trial_ack_at, welcome_tier_seen, onboarding_completed')
        .eq('id', userId).maybeSingle(),
```

- [ ] **Step 2: Add the types and the no-welcome fallback**

Near `NO_GATE`:

```ts
export type WelcomeState = { show: boolean; tier: Tier }
export type Entitlements = { tier: Tier; gate: TrialGate; welcome: WelcomeState }
```

Update the import from `@/lib/entitlements` to include `shouldShowWelcome`.

- [ ] **Step 3: Hoist showWall and populate welcome**

The current code computes `shouldShowWall(...)` inline inside the returned object. Hoist it to a const so the welcome rule can reuse the same value, then return the new field.

Replace the early-return and final return with:

```ts
  // Fails CLOSED (no popup) on a profiles read error: a spurious celebration is
  // worse than a missed one, and `tier` is already the fail-closed 'free' here.
  if (profError || !prof) return { tier, gate: NO_GATE, welcome: { show: false, tier } }

  // Only a positively-confirmed free tier may be walled. If we could not read
  // the subscriptions we do not know the tier, so we must not wall: substitute
  // a tier that can never satisfy shouldShowWall rather than the 'free' the
  // fail-closed path handed us.
  const wallTier: Tier = tierKnown ? tier : 'pro'
  const showWall = shouldShowWall(state, wallTier, process.env.TRIAL_WALL_ENABLED === 'true')

  return {
    tier,
    gate: {
      state,
      daysLeft: trialDaysLeft(prof.trial_started_at, now),
      showWall,
    },
    welcome: {
      show: shouldShowWelcome(
        prof.welcome_tier_seen,
        tier,
        state,
        showWall,
        prof.onboarding_completed === true,
      ),
      tier,
    },
  }
```

- [ ] **Step 4: Fix the other call sites**

`getEntitlements` has other consumers and there is a sibling `getTier()`. Find every place that destructures the return value and make sure nothing breaks on the added field (adding a field is source-compatible, but any explicit `Entitlements` object literal in tests or helpers must gain `welcome`).

Run: `npx tsc --noEmit`
Expected: no errors. Fix any object literal that now misses `welcome`.

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS. The existing trial/entitlement tests must still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/server/entitlements.ts
git commit -m "feat(welcome): surface welcome state from getEntitlements"
```

---

### Task 5: `ackWelcome()` server action

**Files:**
- Create: `app/src/app/actions/welcome.ts`

**Interfaces:**
- Consumes: `Tier`.
- Produces: `ackWelcome(tier: Tier): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the action**

Mirrors `ackTrial()` in `app/src/app/actions/trial.ts` — same service-client pattern, same `revalidatePath`.

Create `app/src/app/actions/welcome.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { TIER_RANK, type Tier } from '@/lib/entitlements'

export type AckWelcomeResult = { ok: true } | { ok: false; error: string }

/** Records that the user has seen the welcome popup for `tier`, so it does not
 *  fire again until their tier changes.
 *
 *  The tier is validated rather than trusted. A server action is reachable over
 *  HTTP by its action id, so the `Tier` parameter type guarantees nothing at
 *  runtime, and 0043 puts no CHECK constraint on the column. An unrecognised
 *  string would persist and then never equal the computed effective tier, so
 *  shouldShowWelcome would fire the popup on EVERY page load, permanently.
 *
 *  The check must be an OWN-property test. `tier in TIER_RANK` walks the
 *  prototype chain, so 'toString', 'constructor', 'valueOf', 'hasOwnProperty'
 *  and '__proto__' would all pass it. Do not "simplify" this back to `in`.
 *
 *  Writes through the service client because welcome_tier_seen is deliberately
 *  outside the column-level UPDATE grant from 0042. */
export async function ackWelcome(tier: Tier): Promise<AckWelcomeResult> {
  if (!Object.hasOwn(TIER_RANK, tier)) return { ok: false, error: 'Unknown tier.' }

  const supabase = await createClient()
  // A mutation, so getUser() rather than getSessionUser().
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const { error } = await createServiceClient()
    .from('profiles')
    .update({ welcome_tier_seen: tier })
    .eq('id', user.id)

  if (error) {
    console.error('[ackWelcome] failed', error)
    return { ok: false, error: 'Could not save. Please try again.' }
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/actions/welcome.ts
git commit -m "feat(welcome): add ackWelcome server action"
```

---

### Task 6: Port the `.wpop-*` CSS into `globals.css`

**Files:**
- Modify: `app/src/app/globals.css` (append a new section at end of file)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS classes `.wpop-backdrop`, `.wpop-modal`, `.wpop-banner`, `.wpop-banner-noise`, `.wpop-confetti`, `.wpop-close`, `.wpop-badge-wrap`, `.wpop-ring`, `.wpop-badge`, `.wpop-burst`, `.wpop-eyebrow`, `.wpop-sub`, `.wpop-price`, `.wpop-body`, `.wpop-progress-card`, `.wpop-progress-head`, `.wpop-track`, `.wpop-seg`, `.wpop-track-caption`, `.wpop-feats`, `.wpop-feat`, `.wpop-fic`, `.wpop-cta`, `.wpop-secondary`, plus 16 `wpop*` keyframes. Task 7 depends on all of these.

- [ ] **Step 1: Extract the CSS block from the client mockup**

The mockups are self-extracting bundles; the real page is a JSON-escaped string in a `<script type="__bundler/template">` tag. Run from the repo root:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('D:/Library/Downloads/TradingSocial Welcome Free (Standalone).html','utf8');const t=JSON.parse(s.match(/<script type=\"__bundler\/template\">\s*([\s\S]*?)\s*<\/script>/)[1]);const b=[...t.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).find(x=>x.includes('wpop'));fs.writeFileSync('wpop-extracted.css',b);console.log('chars',b.length)"
```

Expected: `chars 8454`.

- [ ] **Step 2: Apply the six required modifications**

Open `wpop-extracted.css` and make exactly these changes. Everything else stays byte-for-byte.

1. **Delete the leading `body{...}` rule.** The extracted block starts with mockup page chrome:
   ```css
   body{background:var(--bg-2);min-height:100vh;display:flex;align-items:center;justify-content:center}
   ```
   This must go — it would force the whole app body into a centred flex container.

2. **Raise the backdrop z-index.** In `.wpop-backdrop`, change `z-index:10` to `z-index:900`. The mockup value sits *below* the app nav (40–46). 900 is above the nav and `.ts-modal-backdrop` (60) but below `.tg-backdrop` (1000), so the non-escapable trial wall always renders on top even if the suppression rule ever regressed.

3. **Verify the close-animation selectors are scoped — they already are; expect a no-op.**
   The mockup already ships them correctly scoped to the backdrop:
   ```css
   .wpop-backdrop.closing{animation:wpopFadeOut .25s ease forwards}
   .wpop-backdrop.closing .wpop-modal{animation:wpopPopOut .22s ease forwards}
   ```
   An earlier draft of this plan claimed they were bare `.closing` rules and asked for them to be
   scoped. That was wrong — it came from reading `grep -o` output, which began its match at
   `.closing` and silently dropped the `.wpop-backdrop` prefix. Nothing needs changing here. The step
   is kept only so the check is performed: confirm no bare `.closing` selector enters globals.css,
   since that class name is generic enough to collide in a shared stylesheet.

4. **Add reveal classes for the four elements the mockup animated imperatively.** The mockup assigned `element.style.animation` from JS for the eyebrow, headline, subtitle and price; the React port uses classes instead. All four already have `opacity:0` in their base rules, so these produce identical output. Append:

   ```css
   /* The mockup set these four via element.style.animation from its inline
      script; as classes they are equivalent and React-idiomatic. Timings and
      easings copied exactly from that script. */
   .wpop-eyebrow.in { animation: wpopRevealUp .5s ease forwards; }
   .wpop-banner h1.in { animation: wpopRevealUp .55s cubic-bezier(.2,.9,.25,1) forwards; }
   .wpop-banner .wpop-sub.in { animation: wpopRevealUp .55s ease forwards; }
   .wpop-banner .wpop-price.in { animation: wpopRevealUp .5s ease forwards; }
   ```

5. **Add the small-screen breakpoint.** The modal is already fluid (`width:100%;max-width:460px`), but 32px side padding is tight at 375px. Append:

   ```css
   @media (max-width: 420px) {
     .wpop-backdrop { padding: 12px; }
     .wpop-banner { padding: 36px 20px 70px; }
     .wpop-body { padding: 24px 20px 26px; }
     .wpop-banner h1 { font-size: 25px; }
   }
   ```

6. **Add reduced-motion support.** The mockup has none, while the app respects the preference elsewhere (`globals.css:1085`, `:2243`, `:2255`). Without this a reduced-motion user waits ~3.8s staring at a mostly empty modal. Append:

   **Specificity is the trap here.** Each "force the finished state" selector must match or beat
   the specificity of the base rule that hides the element, or the base rule wins and the element
   stays invisible *forever* — the animation that would have revealed it has just been disabled.
   The base rules to beat are `.wpop-banner .wpop-sub` and `.wpop-banner .wpop-price` at (0,2,0),
   `.wpop-ring .fill` at (0,1,1) with `stroke-dashoffset:301.6`, `.wpop-fic` at (0,1,0) with
   `transform:scale(0)`, and `.wpop-seg i` at (0,1,1) with `transform:scaleX(0)`.

   ```css
   @media (prefers-reduced-motion: reduce) {
     .wpop-backdrop, .wpop-modal, .wpop-badge-wrap, .wpop-badge, .wpop-ring .fill,
     .wpop-eyebrow, .wpop-banner h1, .wpop-banner .wpop-sub, .wpop-banner .wpop-price,
     .wpop-feat, .wpop-fic, .wpop-seg i, .wpop-cta, .wpop-secondary,
     .wpop-confetti span, .wpop-burst i { animation: none !important; }
     /* Land every animated element in its finished state. Selectors must match or
        beat the base rules that hide them — bare .wpop-sub / .wpop-price are
        (0,1,0) and would LOSE to .wpop-banner .wpop-sub / .wpop-price at (0,2,0),
        leaving the subtitle and price permanently invisible. */
     .wpop-badge-wrap, .wpop-eyebrow, .wpop-banner h1,
     .wpop-banner .wpop-sub, .wpop-banner .wpop-price,
     .wpop-feat, .wpop-cta, .wpop-secondary { opacity: 1; transform: none; }
     .wpop-fic { transform: none; }
     .wpop-ring .fill { stroke-dashoffset: 0; }
     .wpop-seg.filled i { transform: scaleX(1); }
     .wpop-confetti, .wpop-burst { display: none; }
   }
   ```

- [ ] **Step 3: Append to globals.css**

Add a section header, then the modified CSS, at the end of `app/src/app/globals.css`:

```css
/* ============================================================
   Tier welcome popup (post-onboarding + plan change)
   Ported from the client's standalone mockups. Every custom
   property it uses already existed in this file.
   ============================================================ */
```

Delete `wpop-extracted.css` afterwards — it is a scratch file, not part of the repo.

- [ ] **Step 4: Verify no rule leaked outside the popup**

Run: `npm run build`
Expected: builds clean. Then confirm the only `body` selector added is none:

```bash
git diff app/src/app/globals.css | grep -n "^+body" || echo "OK: no body rule added"
```

Expected: `OK: no body rule added`.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/globals.css
git commit -m "feat(welcome): port welcome popup styles from client mockups"
```

---

### Task 7: `WelcomeModal` component

A faithful port of the mockup markup and its animation choreography.

**Files:**
- Create: `app/src/app/_components/WelcomeModal.tsx`

**Interfaces:**
- Consumes: `WELCOME_TIERS`, `TRIAL_PRICE` (Task 3); `ackWelcome()` (Task 5); the CSS from Task 6.
- Produces: `<WelcomeModal tier={Tier} username={string | null} trialActive={boolean} />`

- [ ] **Step 1: Write the component**

Create `app/src/app/_components/WelcomeModal.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import type { Tier } from '@/lib/entitlements'
import { WELCOME_TIERS, TRIAL_PRICE } from '@/lib/welcome-tiers'
import { ackWelcome } from '@/app/actions/welcome'
import { track } from '@/lib/track'

// The signup flow's own screens are wrapped by the root layout too. The server
// rule already requires onboarding_completed, so this is belt-and-braces.
const EXEMPT_PATHS = ['/onboarding', '/welcome']

const TOTAL = 6
const CONFETTI_COLORS = ['#3FB6E8', '#7C5CE6', '#C840BC', '#FF7A4D', '#ffffff']

/** Timings copied exactly from the mockup's inline script. */
const T_BADGE = 480
const T_EYEBROW = 780
const T_HEADLINE = 900
const T_SUB = 1040
const T_PRICE = 1160
const T_COUNTER = 1300
const SEG_EVERY = 260
const T_FEATS = T_COUNTER + TOTAL * SEG_EVERY + 100      // 2960
const FEAT_EVERY = 110
const T_FINISH = T_FEATS + TOTAL * FEAT_EVERY + 200      // 3820

type Phase = {
  badge: boolean; eyebrow: boolean; headline: boolean; sub: boolean
  price: boolean; segs: number; feats: number; finish: boolean
}

const START: Phase = {
  badge: false, eyebrow: false, headline: false, sub: false,
  price: false, segs: 0, feats: 0, finish: false,
}

export function WelcomeModal({
  tier, username, trialActive,
}: { tier: Tier; username: string | null; trialActive: boolean }) {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)
  const [gone, setGone] = useState(false)
  const [p, setP] = useState<Phase>(START)
  const cardRef = useRef<HTMLDivElement>(null)
  const acked = useRef(false)

  const copy = WELCOME_TIERS[tier]
  const exempt = EXEMPT_PATHS.some((x) => pathname?.startsWith(x))
  const open = mounted && !gone && !exempt

  useEffect(() => setMounted(true), [])

  // Free's CTA needs the handle; fall back to settings rather than /undefined.
  const href = copy.href || (username ? `/${username}` : '/settings')

  const close = (action: 'cta' | 'later' | 'close') => {
    if (acked.current) return
    acked.current = true
    track('welcome_popup_dismissed', { tier, action })
    // Optimistic: a failed write costs at most one repeat showing, never a
    // stuck modal.
    void ackWelcome(tier)
    if (action === 'cta') { setGone(true); return }
    setClosing(true)
    window.setTimeout(() => setGone(true), 300)
  }

  // The mockup fires eight setTimeouts plus a setInterval from a bare inline
  // script. In React those outlive unmount and would write to detached state,
  // so every handle is tracked and cleared.
  useEffect(() => {
    if (!open) return
    track('welcome_popup_shown', { tier })

    const timeouts: number[] = []
    let interval = 0
    const at = (ms: number, fn: () => void) => { timeouts.push(window.setTimeout(fn, ms)) }

    at(T_BADGE, () => setP((s) => ({ ...s, badge: true })))
    at(T_EYEBROW, () => setP((s) => ({ ...s, eyebrow: true })))
    at(T_HEADLINE, () => setP((s) => ({ ...s, headline: true })))
    at(T_SUB, () => setP((s) => ({ ...s, sub: true })))
    at(T_PRICE, () => setP((s) => ({ ...s, price: true })))

    // The progress track fills one segment every 260ms, same as the mockup.
    at(T_COUNTER, () => {
      let n = 0
      interval = window.setInterval(() => {
        n += 1
        setP((s) => ({ ...s, segs: n }))
        if (n >= TOTAL) window.clearInterval(interval)
      }, SEG_EVERY)
    })

    for (let i = 0; i < TOTAL; i++) {
      at(T_FEATS + i * FEAT_EVERY, () => setP((s) => ({ ...s, feats: i + 1 })))
    }
    at(T_FINISH, () => setP((s) => ({ ...s, finish: true })))

    return () => {
      for (const t of timeouts) window.clearTimeout(t)
      if (interval) window.clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Escape closes this one (unlike the end-of-trial wall), and the page behind
  // it is locked while it is up.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cardRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close('close') }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const price = trialActive ? TRIAL_PRICE : copy.price

  return createPortal(
    <div
      className={'wpop-backdrop' + (closing ? ' closing' : '')}
      onClick={(e) => { if (e.target === e.currentTarget) close('close') }}
    >
      <div
        className="wpop-modal" role="dialog" aria-modal="true" aria-label={copy.aria}
        ref={cardRef} tabIndex={-1}
      >
        <div className="wpop-banner">
          <div className="wpop-banner-noise" />
          <div className="wpop-confetti">
            {p.finish && Array.from({ length: 26 }).map((_, i) => {
              const w = 5 + ((i * 7) % 4)
              return (
                <span key={i} style={{
                  width: w, height: w * 1.6,
                  left: `${(i * 3.85) % 100}%`,
                  background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                  animationDelay: `${((i * 13) % 50) / 100}s`,
                  animationDuration: `${1.2 + ((i * 17) % 80) / 100}s`,
                }} />
              )
            })}
          </div>

          <button className="wpop-close" aria-label="Close" onClick={() => close('close')}>
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>

          <div className={'wpop-badge-wrap' + (p.badge ? ' on' : '')}>
            <svg className="wpop-ring" viewBox="0 0 96 96">
              <circle className="track" cx="48" cy="48" r="48" style={{ r: 44 } as React.CSSProperties} />
              <circle className="fill" cx="48" cy="48" r="44" />
            </svg>
            <div className="wpop-badge">
              <svg viewBox="0 0 24 24" fill="none">{copy.icon}</svg>
            </div>
            <div className="wpop-burst">
              {p.badge && Array.from({ length: 14 }).map((_, i) => {
                const ang = (i / 14) * Math.PI * 2
                const dist = 40 + ((i * 11) % 30)
                return (
                  <i key={i} style={{
                    '--bx': `${Math.cos(ang) * dist}px`,
                    '--by': `${Math.sin(ang) * dist}px`,
                    animationDelay: `${((i * 11) % 15) / 100}s`,
                  } as React.CSSProperties} />
                )
              })}
            </div>
          </div>

          <span className={'wpop-eyebrow' + (p.eyebrow ? ' in' : '')}>
            <span className="dot" />{copy.eyebrow}
          </span>
          <h1 className={p.headline ? 'in' : undefined}>
            Welcome to<br /><em>{copy.em}</em>.
          </h1>
          <p className={'wpop-sub' + (p.sub ? ' in' : '')}>{copy.sub}</p>
          <span className={'wpop-price' + (p.price ? ' in' : '')}>{price}</span>
        </div>

        <div className="wpop-body">
          <div className="wpop-progress-card">
            <div className="wpop-progress-head">
              <span className="lbl">Unlocking your plan</span>
              <span className="val">{p.segs} / {TOTAL}</span>
            </div>
            <div className="wpop-track">
              {Array.from({ length: TOTAL }).map((_, i) => (
                <div key={i} className={'wpop-seg' + (i < p.segs ? ' filled' : '')}>
                  {i < p.segs && <i />}
                </div>
              ))}
            </div>
            <div className="wpop-track-caption">{TOTAL} features just unlocked</div>
          </div>

          <ul className="wpop-feats">
            {copy.feats.map((f, i) => (
              <li key={i} className={'wpop-feat' + (i < p.feats ? ' in' : '')} style={{ ['--i' as string]: i }}>
                <span className="wpop-fic">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <b>{f.t}</b>
                  <p>{f.d}</p>
                </div>
              </li>
            ))}
          </ul>

          <a
            className={'btn btn-primary wpop-cta' + (p.finish ? ' in' : '')}
            href={href}
            onClick={() => close('cta')}
          >
            {copy.cta}
          </a>
          <span
            className={'wpop-secondary' + (p.finish ? ' in' : '')}
            role="button" tabIndex={0}
            onClick={() => close('later')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') close('later') }}
          >
            Maybe later
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 2: Verify `track()` accepts these event names**

Read `app/src/lib/track.ts` and confirm the signature accepts an arbitrary event name plus a payload object. If it uses a union of allowed event names, add `welcome_popup_shown` and `welcome_popup_dismissed` to it.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. The `--bx` / `--by` / `--i` custom properties need the `as React.CSSProperties` casts shown above.

Then run `npm test` and confirm 42 files / 387 tests still pass.

Do **not** run `npm run lint`. This repo has no ESLint config, no ESLint packages installed, and the
`lint` script is a bare `next lint`, which drops into an interactive first-run setup wizard and hangs
in a non-interactive shell. An earlier draft of this plan required lint to pass; that was wrong.
Bootstrapping an ESLint config repo-wide is out of scope for this feature.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/_components/WelcomeModal.tsx
git commit -m "feat(welcome): add WelcomeModal ported from client mockups"
```

---

### Task 8: Mount in the root layout

**Files:**
- Modify: `app/src/app/layout.tsx`

**Interfaces:**
- Consumes: `welcome` from `getEntitlements()` (Task 4), `WelcomeModal` (Task 7).
- Produces: the popup rendered app-wide.

- [ ] **Step 1: Hoist the new state and widen the profiles select**

`ent` is block-scoped inside `if (user)`, so `welcome` and `username` must be declared alongside the existing `let gate` / `let tier` (`layout.tsx:34-35`):

```ts
  let gate: TrialGate | null = null
  let tier: Tier | null = null
  let welcome: WelcomeState | null = null
  let username: string | null = null
```

Import `WelcomeState` from `@/lib/server/entitlements` and `WelcomeModal` from `./_components/WelcomeModal`.

Widen the layout's own profiles select (`layout.tsx:40`) to fetch the handle the free variant's CTA needs — same query, no extra round trip:

```ts
      supabase.from('profiles').select('account_balance, is_public, is_internal, username').eq('id', user.id).single(),
```

Then inside the `if (user)` block, after `gate = ent.gate`:

```ts
    welcome = ent.welcome
    username = data?.username ?? null
```

- [ ] **Step 2: Render it below the wall**

Replace `layout.tsx:69` region so both modals are siblings:

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

Mounting in the layout rather than on `/` is what lets a tier change fire the popup from any page.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors, clean build.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/layout.tsx
git commit -m "feat(welcome): mount WelcomeModal in the root layout"
```

---

### Task 9: Unblock the existing e2e suite (regression fix)

**This task is mandatory and must land in the same change as Task 8.** 17 e2e specs complete
onboarding and then interact with the app. They all end up on `/`, which is now covered by a
full-screen backdrop at `z-index: 900` with `body { overflow: hidden }`, so their first
post-onboarding click starts failing. Each spec defines its **own local** `signUpAndOnboard()` (11
files) or inlines the flow (6 files) — nothing is shared, so every file needs the call added.

**Files:**
- Create: `app/tests/e2e/utils/welcome.ts`
- Modify (local `signUpAndOnboard` helper — add the dismissal before the helper returns):
  `admin.spec.ts`, `analytics.spec.ts`, `billing.spec.ts`, `journal.spec.ts`, `leaderboard.spec.ts`,
  `learning.spec.ts`, `nav-perf.spec.ts`, `profile-hover.spec.ts`, `settings.spec.ts`,
  `trial.spec.ts`, `xp.spec.ts`
- Modify (inlined onboarding flow — add the dismissal after the `Enter TradingSocial` click):
  `auth.spec.ts`, `attachments.spec.ts`, `messaging.spec.ts`, `notifications.spec.ts`,
  `search.spec.ts`, `social.spec.ts`

All paths are under `app/tests/e2e/`.

**Interfaces:**
- Consumes: the rendered popup from Task 8.
- Produces: `dismissWelcome(page: Page): Promise<void>` — idempotent, safe to call when no popup is present.

- [ ] **Step 1: Write the shared helper**

Create `app/tests/e2e/utils/welcome.ts`:

```ts
import type { Page } from '@playwright/test'

/** Dismisses the post-onboarding welcome popup if it appears.
 *
 *  Every onboarding flow in the suite lands on '/', where this popup renders a
 *  full-screen backdrop that swallows clicks. Because WelcomeModal is mounted in
 *  the root layout, an undismissed popup blocks every later page too, not just
 *  the next click.
 *
 *  Why a bounded waitFor and NOT `count()`: WelcomeModal returns null on its
 *  first render and only portals the backdrop in on a second render, after its
 *  `useEffect(() => setMounted(true))` commits. `toHaveURL('/')` can resolve
 *  before that, and `count()` — unlike `expect().toHaveCount()` — does not
 *  retry. A single snapshot is therefore a coin-flip, and losing it means the
 *  popup mounts afterwards and breaks the rest of the spec intermittently.
 *
 *  Still tolerant: a spec whose user has already acknowledged their tier simply
 *  falls through when the wait times out.
 *
 *  Trade-off: when the popup legitimately does not appear, that spec pays the
 *  full 5s. That should be rare — a freshly onboarded user always has
 *  welcome.show true — and the common path returns as soon as it is visible.
 *  The close button is in the DOM from first render, not gated behind the
 *  ~3.8s reveal sequence, so no extra wait is needed before clicking. */
export async function dismissWelcome(page: Page): Promise<void> {
  const backdrop = page.locator('.wpop-backdrop')
  const appeared = await backdrop
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (!appeared) return
  await page.locator('.wpop-close').click()
  await backdrop.waitFor({ state: 'detached', timeout: 5000 })
}
```

- [ ] **Step 2: Wire it into the 11 specs with a local helper**

In each of the 11 files listed above, add the import and call it as the last step of the local
`signUpAndOnboard()`, immediately after the existing `await expect(page).toHaveURL('/', …)` and
before `return username`:

```ts
import { dismissWelcome } from './utils/welcome'
// …
  await expect(page).toHaveURL('/', { timeout: 15000 })
  await dismissWelcome(page)
  return username
```

- [ ] **Step 3: Wire it into the 6 specs that inline the flow**

In each of the 6 remaining files, add the same import and call `await dismissWelcome(page)` directly
after the `Enter TradingSocial` click and its URL assertion.

- [ ] **Step 4: Confirm no spec still trips over the backdrop**

```bash
grep -rln "Enter TradingSocial" app/tests/e2e/ | xargs grep -L "dismissWelcome"
```

Expected: no output. Any file listed still completes onboarding without dismissing the popup.

- [ ] **Step 5: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: PASS at the same rate as before this feature. Compare against a pre-change baseline — if
you do not have one, `git stash` the feature, record the results, then unstash. Any *new* failure is
this feature's regression and must be fixed here, not deferred.

- [ ] **Step 6: Commit**

```bash
git add app/tests/e2e/utils/welcome.ts app/tests/e2e/*.spec.ts
git commit -m "test(welcome): dismiss the welcome popup in existing onboarding flows"
```

---

### Task 10: E2E coverage for the popup itself, and browser verification

**Files:**
- Create: `app/tests/e2e/utils/onboard.ts`
- Create: `app/tests/e2e/welcome-popup.spec.ts`

**Interfaces:**
- Consumes: `createServiceClient` from `./utils/db`.
- Produces: `signUpAndOnboard(page: Page, prefix?: string): Promise<string>` in `./utils/onboard`.

- [ ] **Step 1: Extract the onboarding flow into a shared helper**

The 11 specs with a local `signUpAndOnboard()` all run the **same** onboarding click sequence
(Forex → Beginner → Build consistency → Public → Log trades manually → Create my profile → Enter
TradingSocial); they differ only in cosmetics — some take a `prefix`, they use three different
username/email schemes, and two return shapes (`username` vs `{ username }`). That drift pre-dates
this feature and migrating all 17 specs is out of scope here, but the new spec must not add a 12th
copy.

Create `app/tests/e2e/utils/onboard.ts`:

```ts
import { expect, type Page } from '@playwright/test'

/** Walks the full signup funnel: /signup -> /welcome (trial) -> /onboarding -> /.
 *  Returns the generated username.
 *
 *  Shared by specs that need a freshly-onboarded user. Deliberately does NOT
 *  dismiss the post-onboarding welcome popup — callers that want it gone should
 *  call dismissWelcome() from ./welcome afterwards. The specs that assert on the
 *  popup need it left up. */
export async function signUpAndOnboard(page: Page, prefix = 'e2e'): Promise<string> {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36)
  const username = `${prefix}_${stamp}`.slice(0, 20)

  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@tradingsocial.io`)
  await page.fill('input[name="password"]', 'password123')
  await page.locator('label.fl-terms .fl-check').click()
  await expect(page.locator('input[name="terms"]')).toBeChecked()
  await page.click('button:has-text("Join the Beta")')

  // Trial welcome step — 14 days of Pro, no card.
  await expect(page).toHaveURL(/\/welcome/, { timeout: 15000 })
  await page.click('button:has-text("Start my trial")')

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

  // saveOnboarding redirects to /?signup=1&cid=..., so match the root with or
  // without a query string.
  await expect(page).toHaveURL(/\/(\?.*)?$/, { timeout: 15000 })
  return username
}
```

Leave the 11 existing local helpers in place — Task 9 already added their `dismissWelcome()` call,
and rewriting every spec's setup is a larger regression surface than this feature warrants.

- [ ] **Step 2: Write the spec**

Create `app/tests/e2e/welcome-popup.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'
import { createServiceClient } from './utils/db'
import { signUpAndOnboard } from './utils/onboard'

const WALL = process.env.TRIAL_WALL_ENABLED === 'true'

async function seedProfile(username: string, row: Record<string, unknown>) {
  const { error } = await createServiceClient().from('profiles').update(row).eq('username', username)
  if (error) throw new Error(`could not seed profile: ${error.message}`)
}

const popup = (page: Page) => page.getByRole('dialog', { name: /^Welcome to/ })

test('shows the Pro variant with a trial-honest price after onboarding', async ({ page }) => {
  await signUpAndOnboard(page)
  const modal = page.getByRole('dialog', { name: 'Welcome to pro' })
  await expect(modal).toBeVisible()
  await expect(modal).toContainText("You're on Pro Trader")
  // The entire reason for the price override: a no-card trialist must not be
  // told they are being billed $50/month.
  await expect(modal).toContainText('14 days free · then choose a plan')
  await expect(modal).not.toContainText('$50 / month')
})

test('shows the six features and fills the counter to 6 / 6', async ({ page }) => {
  await signUpAndOnboard(page)
  const modal = popup(page)
  await expect(modal.locator('.wpop-feat')).toHaveCount(6)
  // The reveal sequence finishes around 3.8s.
  await expect(modal).toContainText('6 / 6', { timeout: 10000 })
})

test('does not reappear after dismissal', async ({ page }) => {
  await signUpAndOnboard(page)
  await expect(popup(page)).toBeVisible()
  await page.locator('.wpop-close').click()
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
})

test('records the tier so a reload after "Maybe later" stays quiet', async ({ page }) => {
  const username = await signUpAndOnboard(page)
  await expect(popup(page)).toBeVisible()
  await page.locator('.wpop-secondary').click()
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
  const { data } = await createServiceClient()
    .from('profiles').select('welcome_tier_seen').eq('username', username).single()
  expect(data?.welcome_tier_seen).toBe('pro')
})

test('stays hidden while the end-of-trial wall is up', async ({ page }) => {
  test.skip(!WALL, 'requires TRIAL_WALL_ENABLED=true on the dev server')
  const username = await signUpAndOnboard(page)
  await page.locator('.wpop-close').click()
  // Expire the trial AND reset the celebrated tier, so the only thing keeping
  // the popup away is the wall suppression itself.
  await seedProfile(username, {
    trial_started_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    trial_ack_at: null,
    welcome_tier_seen: 'pro',
  })
  await page.goto('/')
  await expect(page.locator('.tg-backdrop')).toBeVisible()
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
})

test('does not cover the onboarding flow', async ({ page }) => {
  const stamp = Date.now().toString(36)
  await page.goto('/signup')
  await page.fill('input[name="username"]', `n_${stamp}`)
  await page.fill('input[name="email"]', `n_${stamp}@tradingsocial.io`)
  await page.fill('input[name="password"]', 'password123')
  await page.locator('label.fl-terms .fl-check').click()
  await page.click('button:has-text("Join the Beta")')
  await expect(page).toHaveURL(/\/welcome/, { timeout: 15000 })
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
  await page.click('button:has-text("Start my trial")')
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 })
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
})
```

- [ ] **Step 3: Run the e2e suite**

Run: `npm run test:e2e -- welcome-popup.spec.ts`
Expected: 5 pass, plus the wall test either passing or skipped depending on `TRIAL_WALL_ENABLED`. Playwright's `webServer` config starts `npm run dev` automatically and reuses a running server outside CI.

- [ ] **Step 4: Verify the port against the mockup in the browser**

Design fidelity is the hard requirement in this plan, so confirm it visually rather than only by assertion:

1. Open the app preview signed in as a freshly-onboarded user so the popup fires.
2. Take a screenshot and compare side by side against `D:\Library\Downloads\TradingSocial Welcome Pro Trader (Standalone).html` opened directly in a browser tab.
3. Check specifically: badge ring draw, the six progress segments filling left to right, the feature rows cascading in, confetti on completion, and the CTA's pulse.
4. Check the console for errors and warnings — React key warnings and hydration mismatches both surface here.
5. Resize to 375px wide and confirm nothing overflows horizontally.
6. Re-run with reduced motion emulated and confirm the CTA is visible immediately rather than after ~3.8s.

Fix any visual divergence from the mockup before committing.

- [ ] **Step 5: Commit**

```bash
git add app/tests/e2e/utils/onboard.ts app/tests/e2e/welcome-popup.spec.ts
git commit -m "test(welcome): e2e coverage for the tier welcome popup"
```

---

## Deployment notes

- Migration `0043_welcome_tier_seen.sql` must be applied to **dev and prod by hand** by the project owner.
- **Apply and verify the backfill on prod before the code ships there.** If prod has unset `welcome_tier_seen` rows when this deploys, every existing onboarded user gets a popup on their next page load.
- No new environment variables. No Stripe changes. No change to trial length or wall behaviour.
