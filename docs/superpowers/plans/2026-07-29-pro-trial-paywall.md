# 14-day Pro Trial + End-of-Trial Paywall — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user 14 days of free Pro with no card and no Stripe customer, then present a non-dismissible modal offering Trader/Pro checkout or "Continue on Free".

**Architecture:** Trial state is two nullable timestamps on `profiles` (`trial_started_at`, `trial_ack_at`). Pure functions in `src/lib/entitlements.ts` turn those into a `TrialState` and fold a trial `pro` grant into the existing `getTier()` via `higherTier()`. A server-computed gate drives a client modal rendered from the root layout. The signup plan-picker is replaced by a no-checkout trial welcome screen.

**Tech Stack:** Next.js 15 (App Router, server actions), React 19, Supabase (Postgres + RLS, service-role client for privileged writes), Stripe (subscriptions only — never for the trial), Vitest (unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-07-29-pro-trial-paywall-design.md`

## Global Constraints

- Trial length is **14 days**, exported as `TRIAL_DAYS = 14`. Never hardcode `14` anywhere else.
- The trial creates **no Stripe customer and no Stripe subscription**. Stripe is touched only when a user actually subscribes.
- The end-of-trial modal has **no logout button**, **no Escape handler**, **no backdrop-click close**, **no close button**. Its only actions are: subscribe to Trader, subscribe to Pro, Continue on Free.
- The **Free tier survives** — no change to what Free includes, and no removal of Free from the billing page.
- The gate **fails open**: null `trial_started_at`, a failed profile read, or an unset env var must all resolve to *no wall*.
- All trial date arithmetic happens **server-side**. Client components receive a `daysLeft` number, never a raw date to compare against `new Date()`.
- Kill switch: the wall renders only when `process.env.TRIAL_WALL_ENABLED === 'true'`.
- Migration number is **0041**. File: `app/supabase/migrations/0041_pro_trial.sql`. Migrations must be idempotent (`if not exists`, `create or replace`) — this repo re-runs them.
- All commands run from the `app/` directory. Unit tests: `npm test`. E2E: `npm run test:e2e`.
- Never commit to `main`. This work lands on the existing `feat/pro-trial-paywall` branch.

## File Structure

**Created:**
- `app/supabase/migrations/0041_pro_trial.sql` — columns, trigger update, backfill.
- `app/src/lib/plans.ts` — shared Trader/Pro plan copy for the funnel and the modal.
- `app/src/app/welcome/page.tsx` + `TrialWelcome.tsx` — trial welcome funnel step.
- `app/src/app/_components/TrialGateModal.tsx` — the blocking modal.
- `app/src/app/_components/TrialEndingBanner.tsx` — final-3-days nudge.
- `app/src/app/actions/trial.ts` — `ackTrial()` server action.
- `app/tests/unit/trial.test.ts` — pure trial-logic tests.
- `app/tests/e2e/trial.spec.ts` — wall behaviour end-to-end.

**Modified:**
- `app/src/lib/entitlements.ts` — `TRIAL_DAYS`, `TrialState`, `trialState()`, `trialDaysLeft()`, `effectiveTier()`, `shouldShowWall()`.
- `app/src/lib/server/entitlements.ts` — `getTier()` folds the trial in; new `getTrialGate()`.
- `app/src/app/layout.tsx` — compute the gate, render the modal + banner.
- `app/src/app/_components/AppNav.tsx` — trial countdown chip.
- `app/src/app/actions/auth.ts:49` — post-signup redirect `/select-plan` → `/welcome`.
- `app/src/app/select-plan/page.tsx` — becomes a redirect; `SelectPlanForm.tsx` deleted.
- `app/middleware.ts:5` — `FUNNEL_PATHS` gains `/welcome`.
- `app/src/lib/username.ts` — reserve `welcome`.
- `app/src/app/api/billing/checkout/route.ts` — `flow: 'trial_end'`.
- `app/src/app/api/stripe/webhook/route.ts` — stamp `trial_ack_at` on first paid sub.
- `app/src/app/globals.css` — modal, chip, banner styles.
- 15 e2e spec files — signup helper must stop clicking "Continue with Free".

**Deliberate deviations from the spec** (both are scope-control decisions; flag to the user if either is unwelcome):
1. Spec §Testing asks for a **component test** of the modal's non-escapability. This repo has no component-test infrastructure — Vitest runs pure-logic tests only, with no `jsdom` and no `@testing-library/react`. Rather than add two devDependencies for one test, non-escapability is covered in Playwright (Task 9), which exercises a real Escape keypress in a real browser — a stronger test.
2. Spec §8 says the shared plans module is read by "TrialWelcome, TrialGateModal, and the billing page". `BillingActions.tsx` has its own `PLANS` array with **different feature copy and different CSS pip class names** (`pip-free` vs `free`). Consolidating it would silently change the billing page's visible copy, which nobody asked for. `src/lib/plans.ts` serves the funnel and the modal only; `BillingActions.tsx` is left untouched.

---

### Task 1: Migration — trial columns, trigger, backfill

**Files:**
- Create: `app/supabase/migrations/0041_pro_trial.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `profiles.trial_started_at timestamptz null`, `profiles.trial_ack_at timestamptz null`. New signups get `trial_started_at = now()` automatically.

- [ ] **Step 1: Write the migration**

Create `app/supabase/migrations/0041_pro_trial.sql`:

```sql
-- 14-day free Pro trial. No Stripe object exists for a trial — these two
-- timestamps are the whole state. NULL trial_started_at means "never on a
-- trial", which is also the fail-open value: such a user is never walled.
alter table public.profiles
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ack_at     timestamptz;

comment on column public.profiles.trial_started_at is
  '14-day free Pro trial start. NULL = never on a trial (never walled).';
comment on column public.profiles.trial_ack_at is
  'When the user answered the end-of-trial modal (Continue on Free, or first paid subscription).';

-- New signups start their trial at account creation. Mirrors 0001_profiles.sql
-- with trial_started_at added.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uname text;
begin
  uname := coalesce(
    new.raw_user_meta_data->>'username',
    'user_' || substr(new.id::text, 1, 8)
  );
  insert into public.profiles (id, username, trial_started_at)
  values (new.id, uname, now())
  on conflict (id) do nothing;
  return new;
end $$;

-- Backfill existing users. Deliberately skipped:
--   * internal/seed accounts — the demo users and the 3-hourly activity
--     routine must keep working untouched;
--   * anyone with a live subscription — they never had a trial, so if they
--     churn later they must not be walled for one.
update public.profiles p set trial_started_at = now()
where p.trial_started_at is null
  and coalesce(p.is_internal, false) = false
  and not exists (
    select 1 from public.subscriptions s
    where s.user_id = p.id and s.status in ('active', 'trialing')
  );
```

- [ ] **Step 2: Apply to the dev Supabase project**

Apply via the Supabase MCP `apply_migration` tool (or the SQL editor) against the **dev** project — never prod at this stage. Migration name: `0041_pro_trial`.

- [ ] **Step 3: Verify the backfill did the right thing**

Run in the dev SQL editor:

```sql
select
  count(*) filter (where trial_started_at is not null) as with_trial,
  count(*) filter (where trial_started_at is null)     as without_trial,
  count(*) filter (where trial_started_at is null and is_internal) as internal_skipped
from public.profiles;
```

Expected: `internal_skipped` equals your seeded internal user count (10 if all seed users are flagged internal), and every non-internal, non-subscribed profile has a `trial_started_at`.

- [ ] **Step 4: Verify the trigger fires on new signups**

```sql
select id, username, trial_started_at from public.profiles
order by created_at desc limit 5;
```

Then sign up a throwaway account at `http://localhost:3000/signup` and re-run — the new row must have a non-null `trial_started_at` within seconds of `created_at`.

- [ ] **Step 5: Commit**

```bash
git add app/supabase/migrations/0041_pro_trial.sql
git commit -m "feat(trial): add trial_started_at/trial_ack_at columns, trigger and backfill"
```

---

### Task 2: Pure trial logic

**Files:**
- Modify: `app/src/lib/entitlements.ts`
- Test: `app/tests/unit/trial.test.ts` (create)

**Interfaces:**
- Consumes: `Tier`, `TIER_RANK`, `higherTier`, `normalizeCompTier` from `@/lib/entitlements`.
- Produces:
  - `TRIAL_DAYS: 14`
  - `type TrialState = 'none' | 'active' | 'expired' | 'resolved'`
  - `trialState(startedAt: string | null | undefined, ackAt: string | null | undefined, now: Date): TrialState`
  - `trialDaysLeft(startedAt: string | null | undefined, now: Date): number`
  - `effectiveTier(compTier: string | null | undefined, stripeTier: Tier, trial: TrialState): Tier`
  - `shouldShowWall(state: TrialState, tier: Tier, enabled: boolean): boolean`

These are pure so they can be unit-tested without a database. `getTier()` and `getTrialGate()` in Task 3 become thin I/O wrappers around them.

- [ ] **Step 1: Write the failing tests**

Create `app/tests/unit/trial.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  TRIAL_DAYS, trialState, trialDaysLeft, effectiveTier, shouldShowWall,
} from '@/lib/entitlements'

const NOW = new Date('2026-07-29T12:00:00.000Z')
const daysBefore = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

describe('trialState', () => {
  it('is none when no trial was ever started', () => {
    expect(trialState(null, null, NOW)).toBe('none')
    expect(trialState(undefined, undefined, NOW)).toBe('none')
    // A stray ack without a start is still "never on a trial".
    expect(trialState(null, daysBefore(1), NOW)).toBe('none')
  })

  it('is active from day 0 until the instant day 14 arrives', () => {
    expect(trialState(daysBefore(0), null, NOW)).toBe('active')
    expect(trialState(daysBefore(1), null, NOW)).toBe('active')
    expect(trialState(daysBefore(13.9), null, NOW)).toBe('active')
  })

  it('is expired at exactly 14 days and beyond', () => {
    expect(trialState(daysBefore(14), null, NOW)).toBe('expired')
    expect(trialState(daysBefore(400), null, NOW)).toBe('expired')
  })

  it('is resolved once acknowledged, whatever the elapsed time', () => {
    expect(trialState(daysBefore(400), daysBefore(300), NOW)).toBe('resolved')
    expect(trialState(daysBefore(1), daysBefore(1), NOW)).toBe('resolved')
  })
})

describe('trialDaysLeft', () => {
  it('counts down whole days and never goes negative', () => {
    expect(trialDaysLeft(daysBefore(0), NOW)).toBe(TRIAL_DAYS)
    expect(trialDaysLeft(daysBefore(13.5), NOW)).toBe(1)
    expect(trialDaysLeft(daysBefore(14), NOW)).toBe(0)
    expect(trialDaysLeft(daysBefore(99), NOW)).toBe(0)
  })

  it('is 0 with no trial', () => {
    expect(trialDaysLeft(null, NOW)).toBe(0)
  })
})

describe('effectiveTier', () => {
  it('grants pro while the trial is active', () => {
    expect(effectiveTier(null, 'free', 'active')).toBe('pro')
  })

  it('never downgrades a paying user', () => {
    expect(effectiveTier(null, 'pro', 'expired')).toBe('pro')
    expect(effectiveTier(null, 'trader', 'expired')).toBe('trader')
    // Trial pro outranks a Trader sub — a deliberate gift until day 14.
    expect(effectiveTier(null, 'trader', 'active')).toBe('pro')
  })

  it('honours comp grants after the trial ends', () => {
    expect(effectiveTier('trader', 'free', 'expired')).toBe('trader')
    expect(effectiveTier('pro', 'free', 'resolved')).toBe('pro')
  })

  it('falls back to free once the trial is over', () => {
    expect(effectiveTier(null, 'free', 'expired')).toBe('free')
    expect(effectiveTier(null, 'free', 'resolved')).toBe('free')
    expect(effectiveTier(null, 'free', 'none')).toBe('free')
    expect(effectiveTier('gold', 'free', 'expired')).toBe('free')
  })
})

describe('shouldShowWall', () => {
  it('walls only an expired trial on the free tier with the flag on', () => {
    expect(shouldShowWall('expired', 'free', true)).toBe(true)
  })

  it('does not wall when any one condition fails', () => {
    expect(shouldShowWall('expired', 'free', false)).toBe(false)
    expect(shouldShowWall('expired', 'trader', true)).toBe(false)
    expect(shouldShowWall('expired', 'pro', true)).toBe(false)
    expect(shouldShowWall('active', 'free', true)).toBe(false)
    expect(shouldShowWall('resolved', 'free', true)).toBe(false)
    expect(shouldShowWall('none', 'free', true)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- tests/unit/trial.test.ts
```

Expected: FAIL — `TRIAL_DAYS`, `trialState`, `trialDaysLeft`, `effectiveTier`, `shouldShowWall` are not exported from `@/lib/entitlements`.

- [ ] **Step 3: Implement the pure logic**

Append to `app/src/lib/entitlements.ts` (below `normalizeCompTier`, above `PlanEnv`):

```ts
/* ── 14-day free Pro trial ──────────────────────────────────────────────── */

export const TRIAL_DAYS = 14
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000

/** none = never on a trial (also the fail-open value); active = inside the
 *  window; expired = past it and unanswered (the wall); resolved = answered. */
export type TrialState = 'none' | 'active' | 'expired' | 'resolved'

export function trialState(
  startedAt: string | null | undefined,
  ackAt: string | null | undefined,
  now: Date,
): TrialState {
  if (!startedAt) return 'none'
  const start = Date.parse(startedAt)
  if (Number.isNaN(start)) return 'none'
  if (ackAt) return 'resolved'
  return now.getTime() - start < TRIAL_MS ? 'active' : 'expired'
}

/** Whole days remaining, rounded up, clamped to [0, TRIAL_DAYS]. */
export function trialDaysLeft(startedAt: string | null | undefined, now: Date): number {
  if (!startedAt) return 0
  const start = Date.parse(startedAt)
  if (Number.isNaN(start)) return 0
  const remaining = start + TRIAL_MS - now.getTime()
  if (remaining <= 0) return 0
  return Math.min(TRIAL_DAYS, Math.ceil(remaining / (24 * 60 * 60 * 1000)))
}

/** Comp grant, Stripe subscription and trial combined — highest rank wins, so
 *  a trial never downgrades a paying or comped user. */
export function effectiveTier(
  compTier: string | null | undefined,
  stripeTier: Tier,
  trial: TrialState,
): Tier {
  const trialTier: Tier = trial === 'active' ? 'pro' : 'free'
  return higherTier(normalizeCompTier(compTier), higherTier(stripeTier, trialTier))
}

/** The end-of-trial wall. Every condition must hold, so admins, comped users
 *  and subscribers are exempt without any special-casing. */
export function shouldShowWall(state: TrialState, tier: Tier, enabled: boolean): boolean {
  return enabled && state === 'expired' && tier === 'free'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- tests/unit/trial.test.ts
```

Expected: PASS, all cases green.

- [ ] **Step 5: Run the full unit suite for regressions**

```bash
npm test
```

Expected: PASS. `entitlements.test.ts` in particular must still be green — nothing in it was modified.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/entitlements.ts app/tests/unit/trial.test.ts
git commit -m "feat(trial): pure trial-state, days-left and wall-gate helpers"
```

---

### Task 3: Wire the trial into `getTier()` and add `getTrialGate()`

**Files:**
- Modify: `app/src/lib/server/entitlements.ts`

**Interfaces:**
- Consumes: `trialState`, `trialDaysLeft`, `effectiveTier`, `shouldShowWall`, `TrialState` from Task 2.
- Produces:
  - `getTier(supabase, userId): Promise<Tier>` — unchanged signature, now trial-aware.
  - `type TrialGate = { state: TrialState; daysLeft: number; showWall: boolean }`
  - `getTrialGate(supabase, userId, tier: Tier): Promise<TrialGate>`

`getTrialGate` takes the already-computed `tier` rather than calling `getTier()` again — both callers (`layout.tsx`, `AppNav.tsx`) already have it.

- [ ] **Step 1: Extend the profile read and fold the trial into `getTier`**

In `app/src/lib/server/entitlements.ts`, update the import and the `getTier` body:

```ts
import {
  tierFromSubscriptions, higherTier, normalizeCompTier, TIER_RANK,
  trialState, trialDaysLeft, effectiveTier, shouldShowWall,
  type Tier, type TrialState,
} from '@/lib/entitlements'
```

```ts
export async function getTier(supabase: SupabaseClient, userId: string): Promise<Tier> {
  const svc = createServiceClient()
  const { data: { user } } = await svc.auth.admin.getUserById(userId)
  if (user && emailIsAdmin(user.email, parseAdminEmails(process.env.ADMIN_EMAILS))) {
    return 'pro'
  }

  const [{ data: prof }, { data: subs, error }] = await Promise.all([
    svc.from('profiles')
      .select('comp_tier, trial_started_at, trial_ack_at')
      .eq('id', userId).maybeSingle(),
    supabase.from('subscriptions').select('tier, status').eq('user_id', userId),
  ])

  const stripeTier: Tier = error || !subs ? 'free' : tierFromSubscriptions(subs)
  const trial = trialState(prof?.trial_started_at, prof?.trial_ack_at, new Date())
  return effectiveTier(prof?.comp_tier, stripeTier, trial)
}
```

`higherTier` and `normalizeCompTier` are now used only inside `effectiveTier`. Drop them from this file's import list if TypeScript flags them as unused; keep `TIER_RANK`, which `getSubscription` still uses.

- [ ] **Step 2: Add `getTrialGate`**

Append to the same file:

```ts
export type TrialGate = { state: TrialState; daysLeft: number; showWall: boolean }

const NO_GATE: TrialGate = { state: 'none', daysLeft: 0, showWall: false }

/** Trial state for UI: the countdown chip, the final-days banner and the
 *  end-of-trial wall. Fails open — any read failure yields no wall, because a
 *  bug here must never lock the userbase out. */
export async function getTrialGate(
  supabase: SupabaseClient, userId: string, tier: Tier,
): Promise<TrialGate> {
  const svc = createServiceClient()
  const { data: prof, error } = await svc
    .from('profiles')
    .select('trial_started_at, trial_ack_at')
    .eq('id', userId).maybeSingle()
  if (error || !prof) return NO_GATE

  const now = new Date()
  const state = trialState(prof.trial_started_at, prof.trial_ack_at, now)
  return {
    state,
    daysLeft: trialDaysLeft(prof.trial_started_at, now),
    showWall: shouldShowWall(state, tier, process.env.TRIAL_WALL_ENABLED === 'true'),
  }
}
```

The unused `supabase` parameter is intentional — it keeps the signature consistent with `getTier`/`getSubscription` in this module. If lint objects, rename it to `_supabase`.

- [ ] **Step 3: Typecheck and run the unit suite**

```bash
npx tsc --noEmit && npm test
```

Expected: no type errors, all tests PASS.

- [ ] **Step 4: Verify a live trial grants Pro**

Start the dev server via the preview tooling (never `npm run dev` in a raw shell), log in as a freshly signed-up user, and visit `/settings/billing`. Expected: the page reports the **Pro Trader** plan even though no subscription exists.

Then, in the dev SQL editor, expire that user's trial and reload:

```sql
update public.profiles set trial_started_at = now() - interval '15 days'
where username = '<the test username>';
```

Expected: `/settings/billing` now reports **Free**.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/entitlements.ts
git commit -m "feat(trial): fold trial grant into getTier, add getTrialGate"
```

---

### Task 4: Shared plan copy

**Files:**
- Create: `app/src/lib/plans.ts`

**Interfaces:**
- Consumes: `Tier` from `@/lib/entitlements`.
- Produces: `type PaidPlan`, `PAID_PLANS: PaidPlan[]` (Trader and Pro, in that order).

`pip` is a bare tier name; each consumer composes its own CSS class (`fl-pip ${pip}` in the funnel). This module intentionally does **not** include the Free plan and is **not** consumed by `settings/billing/BillingActions.tsx` — see "Deliberate deviations" above.

- [ ] **Step 1: Create the module**

Create `app/src/lib/plans.ts`:

```ts
import type { Tier } from '@/lib/entitlements'

/** Paid plan copy shared by the signup welcome screen and the end-of-trial
 *  modal. Prices mirror settings/billing; `pip` is a bare tier name so each
 *  surface can compose its own CSS class. */
export type PaidPlan = {
  tier: Extract<Tier, 'trader' | 'pro'>
  name: string
  pip: string
  tag: string
  monthly: number
  annual: number
  billedM: string
  billedA: string
  featsLabel: string
  feats: { t: string; lim?: boolean }[]
}

export const PAID_PLANS: PaidPlan[] = [
  {
    tier: 'trader', name: 'Trader', pip: 'trader', tag: 'Build discipline and improve faster.',
    monthly: 30, annual: 6, billedM: 'Billed monthly', billedA: '$72 first year, then $300/yr',
    featsLabel: 'Everything in Free, plus',
    feats: [
      { t: 'Unlimited journal entries' },
      { t: 'Import MT5 history (statement upload)' },
      { t: 'Advanced stats & full dashboard' },
      { t: 'Strategy tracking & mistake tagging' },
      { t: 'Private (solo) profile option' },
      { t: 'Advanced leaderboard filters' },
    ],
  },
  {
    tier: 'pro', name: 'Pro Trader', pip: 'pro', tag: 'Advanced tools for serious traders.',
    monthly: 50, annual: 10, billedM: 'Billed monthly', billedA: '$120 first year, then $500/yr',
    featsLabel: 'Everything in Trader, plus',
    feats: [
      { t: 'Automatic MT5 sync — hourly' },
      { t: 'Advanced analytics & reporting' },
      { t: 'Monthly downloadable reports' },
      { t: 'Premium courses & psychology' },
      { t: 'Creator profile & Pro badge' },
      { t: 'Premium challenges & competitions' },
    ],
  },
]
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/plans.ts
git commit -m "feat(trial): shared paid-plan copy for funnel and trial modal"
```

---

### Task 5: Replace the plan-picker funnel step with `/welcome`

**Files:**
- Create: `app/src/app/welcome/page.tsx`, `app/src/app/welcome/TrialWelcome.tsx`
- Modify: `app/src/app/select-plan/page.tsx`, `app/src/app/actions/auth.ts:49`, `app/middleware.ts:5`, `app/src/lib/username.ts:6`
- Delete: `app/src/app/select-plan/SelectPlanForm.tsx`
- Modify (15 files): every `app/tests/e2e/*.spec.ts` containing a signup helper

**Interfaces:**
- Consumes: `PAID_PLANS` from Task 4.
- Produces: route `/welcome`; `/select-plan` permanently redirects to it.

- [ ] **Step 1: Create the welcome page shell**

Create `app/src/app/welcome/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TrialWelcome } from './TrialWelcome'

// Sits between sign-up and onboarding: Sign up → Trial starts → Onboarding.
// No plan picker and no checkout — every new account gets 14 days of Pro.
export default async function WelcomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('onboarding_completed').eq('id', user.id).single()
  if (profile?.onboarding_completed) redirect('/')

  return (
    <div className="fl-stage fl-stage--full">
      <TrialWelcome />
    </div>
  )
}
```

- [ ] **Step 2: Create the welcome screen**

Create `app/src/app/welcome/TrialWelcome.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { TRIAL_DAYS } from '@/lib/entitlements'
import { PAID_PLANS } from '@/lib/plans'

const CHK: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const ARROW: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)

const PRO = PAID_PLANS.find((p) => p.tier === 'pro')!

export function TrialWelcome() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <div className="fl-card fl-plan">
      <div className="fl-plan-top">
        <div className="fl-tex" />
        <div className="fl-steps">
          <div className="fl-step done"><span className="num">{CHK}</span><span className="lbl">Account</span></div>
          <span className="fl-step-sep done" />
          <div className="fl-step on"><span className="num">2</span><span className="lbl">Trial</span></div>
          <span className="fl-step-sep" />
          <div className="fl-step"><span className="num">3</span><span className="lbl">Profile</span></div>
        </div>

        <h1>Your {TRIAL_DAYS} days of <span className="gr">Pro start now</span>.</h1>
        <p>Every tool we make, unlocked from day one. No card, no charge — decide what you want to keep at the end.</p>
      </div>

      <div className="fl-plan-body">
        <ul className="fl-pfeats fl-trial-feats">
          <span className="fl-pfeats-lbl">{PRO.name} includes</span>
          {PRO.feats.map((f, i) => (
            <li key={i}><span className="chk">{CHK}</span><span>{f.t}</span></li>
          ))}
        </ul>
      </div>

      <div className="fl-plan-foot">
        <span className="fl-plan-note">No card required · nothing to cancel</span>
        <span className="sp" />
        <button
          type="button"
          className="fl-continue"
          disabled={busy}
          onClick={() => { setBusy(true); router.push('/onboarding') }}
        >
          {busy ? 'Loading…' : 'Start my trial'}
          {ARROW}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add the one new style rule**

Append to `app/src/app/globals.css`, near the other `fl-` funnel rules:

```css
/* Trial welcome: the Pro feature list stands alone (no plan grid around it). */
.fl-trial-feats { max-width: 460px; margin: 0 auto; }
```

- [ ] **Step 4: Redirect the old route and delete the picker**

Replace the entire contents of `app/src/app/select-plan/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

// The plan picker was replaced by the 14-day Pro trial welcome screen. Kept as
// a redirect so stale tabs and old Stripe cancel URLs still land somewhere.
export default function SelectPlanPage() {
  redirect('/welcome')
}
```

Delete the picker:

```bash
git rm app/src/app/select-plan/SelectPlanForm.tsx
```

- [ ] **Step 5: Point signup, middleware and reserved names at `/welcome`**

In `app/src/app/actions/auth.ts:49`, change `redirect('/select-plan')` to `redirect('/welcome')`.

In `app/middleware.ts:5`:

```ts
const FUNNEL_PATHS = ['/onboarding', '/select-plan', '/welcome']
```

In `app/src/lib/username.ts:6`, add `'welcome'` to `RESERVED_USERNAMES` alongside `'select-plan'`:

```ts
  'achievements', 'select-plan', 'welcome', 'demo', 'feature-board', 'changelog', 'for',
```

- [ ] **Step 6: Update every e2e signup helper**

Fifteen spec files each carry their own copy of the signup helper that waits for `/select-plan` and clicks "Continue with Free". All fifteen break otherwise:

`admin.spec.ts`, `analytics.spec.ts`, `attachments.spec.ts`, `auth.spec.ts`, `billing.spec.ts`, `journal.spec.ts`, `leaderboard.spec.ts`, `learning.spec.ts`, `messaging.spec.ts`, `nav-perf.spec.ts`, `notifications.spec.ts`, `profile-hover.spec.ts`, `search.spec.ts`, `settings.spec.ts`, `social.spec.ts`.

In each, replace this pair of lines:

```ts
  await expect(page).toHaveURL(/\/select-plan/, { timeout: 15000 })
  await page.click('button:has-text("Continue with Free")')
```

with:

```ts
  await expect(page).toHaveURL(/\/welcome/, { timeout: 15000 })
  await page.click('button:has-text("Start my trial")')
```

Also update the stale comment above it (`// Select-plan step — default selection is Free; continue with it`) to `// Trial welcome step — 14 days of Pro, no card`. Verify none remain:

```bash
grep -rn "select-plan\|Continue with Free" app/tests/
```

Expected: no output.

- [ ] **Step 7: Run the unit suite and typecheck**

```bash
npx tsc --noEmit && npm test
```

Expected: PASS. `username.test.ts` still passes — adding a reserved name doesn't break its assertions.

- [ ] **Step 8: Verify the funnel in a browser**

Start the dev server via the preview tooling. Sign up a throwaway account. Expected: `/welcome` renders with the 3-step bar reading Account → **Trial** → Profile, "Start my trial" routes to `/onboarding`, and navigating directly to `/select-plan` lands on `/welcome`. Check the browser console for errors.

- [ ] **Step 9: Run one e2e spec to confirm the helper change works**

```bash
npm run test:e2e -- tests/e2e/auth.spec.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A app/src/app/welcome app/src/app/select-plan app/src/app/actions/auth.ts app/middleware.ts app/src/lib/username.ts app/src/app/globals.css app/tests/e2e
git commit -m "feat(trial): replace signup plan picker with /welcome trial screen"
```

---

### Task 6: `ackTrial()` server action

**Files:**
- Create: `app/src/app/actions/trial.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ackTrial(): Promise<{ ok: true } | { ok: false; error: string }>`, consumed by `TrialGateModal` in Task 7.

- [ ] **Step 1: Write the action**

Create `app/src/app/actions/trial.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type AckResult = { ok: true } | { ok: false; error: string }

/** "Continue on Free" — records that the user answered the end-of-trial modal
 *  so it never blocks them again. Takes no arguments: a user can only ever
 *  acknowledge their own trial, so there is nothing to forge. */
export async function ackTrial(): Promise<AckResult> {
  const supabase = await createClient()
  // A mutation, so getUser() rather than getSessionUser().
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const { error } = await createServiceClient()
    .from('profiles')
    .update({ trial_ack_at: new Date().toISOString() })
    .eq('id', user.id)
    .is('trial_ack_at', null)

  if (error) {
    console.error('[ackTrial] failed', error)
    return { ok: false, error: 'Could not save your choice. Please try again.' }
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}
```

The `.is('trial_ack_at', null)` guard makes repeat calls harmless — the first answer stands.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/actions/trial.ts
git commit -m "feat(trial): ackTrial server action for Continue on Free"
```

---

### Task 7: The blocking modal

**Files:**
- Create: `app/src/app/_components/TrialGateModal.tsx`
- Modify: `app/src/app/layout.tsx`, `app/src/app/globals.css`

**Interfaces:**
- Consumes: `getTrialGate` (Task 3), `PAID_PLANS` (Task 4), `ackTrial` (Task 6).
- Produces: `<TrialGateModal show={boolean} />`.

- [ ] **Step 1: Write the modal**

Create `app/src/app/_components/TrialGateModal.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import type { Interval } from '@/lib/entitlements'
import { TRIAL_DAYS } from '@/lib/entitlements'
import { PAID_PLANS } from '@/lib/plans'
import { ackTrial } from '@/app/actions/trial'
import { trackMeta } from '@/app/_components/MetaPixel'

const CHK: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

// Subscribing has to land somewhere, so billing is the one page the wall skips.
const EXEMPT_PATHS = ['/settings/billing']

export function TrialGateModal({ show }: { show: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [interval, setInterval] = useState<Interval>('monthly')
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  const exempt = EXEMPT_PATHS.some((p) => pathname?.startsWith(p))
  const open = show && !exempt

  // Lock the page behind the modal and trap focus inside it. Deliberately NO
  // Escape handler and NO backdrop-click close — this modal must be answered.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cardRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])

  const subscribe = async (tier: 'trader' | 'pro') => {
    setBusy(true); setError(null)
    trackMeta('InitiateCheckout', { content_name: `${tier}_${interval}` })
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier, interval, flow: 'trial_end' }),
      })
      const { url } = (await res.json().catch(() => ({}))) as { url?: string }
      if (res.ok && url) { window.location.href = url; return }
      setError('Could not start checkout. Please try again.')
    } catch {
      setError('Could not start checkout. Please try again.')
    }
    setBusy(false)
  }

  const continueFree = async () => {
    setBusy(true); setError(null)
    const result = await ackTrial()
    if (!result.ok) { setError(result.error); setBusy(false); return }
    router.refresh()
  }

  if (!mounted || !open) return null

  // Portal to <body> so the fixed backdrop escapes the nav's backdrop-filter,
  // which would otherwise become its containing block and clip it.
  return createPortal(
    <div className="tg-backdrop">
      <div
        className="tg-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tg-title"
        ref={cardRef}
        tabIndex={-1}
      >
        <div className="tg-head">
          <span className="tg-eyebrow"><span className="dot" />Trial ended</span>
          <h1 id="tg-title">Your {TRIAL_DAYS} days of Pro have ended.</h1>
          <p>
            Keep the full toolkit — unlimited journal, advanced analytics, MT5 sync and premium
            courses — or continue on Free with your last 30 trades, basic stats, the feed and the
            leaderboard.
          </p>
        </div>

        <div className="tg-billing">
          <button
            type="button"
            className={`tg-bopt${interval === 'monthly' ? ' on' : ''}`}
            onClick={() => setInterval('monthly')}
          >Monthly</button>
          <button
            type="button"
            className={`tg-bopt${interval === 'annual' ? ' on' : ''}`}
            onClick={() => setInterval('annual')}
          >Annual</button>
        </div>

        <div className="tg-grid">
          {PAID_PLANS.map((p) => (
            <div key={p.tier} className={`tg-card${p.tier === 'pro' ? ' pop' : ''}`}>
              <span className="tg-name"><span className={`fl-pip ${p.pip}`} />{p.name}</span>
              <div className="tg-price">
                <span className="cur">$</span>
                <span className="amt">{interval === 'monthly' ? p.monthly : p.annual}</span>
                <span className="per">/mo</span>
              </div>
              <div className="tg-billed">{interval === 'monthly' ? p.billedM : p.billedA}</div>
              <ul className="tg-feats">
                {p.feats.map((f, i) => (
                  <li key={i}><span className="chk">{CHK}</span><span>{f.t}</span></li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn-primary tg-cta"
                disabled={busy}
                onClick={() => subscribe(p.tier)}
              >
                {busy ? 'Starting…' : `Subscribe to ${p.name}`}
              </button>
            </div>
          ))}
        </div>

        {error && <p className="tg-error" role="alert">{error}</p>}

        <button type="button" className="tg-free" disabled={busy} onClick={continueFree}>
          Continue on Free
        </button>
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 2: Add the styles**

Append to `app/src/app/globals.css`:

These rules use the design tokens this file actually defines — `--surface`, `--surface-3`, `--faint`, `--faintest`, `--violet`, `--brand-grad`, `--radius-lg`, `--shadow-lg`, `--display`, `--mono`. Do **not** invent tokens; there is no `--muted` or `--accent` in this codebase, and `--surface` is the light card colour, not a dark one.

```css
/* ---------- End-of-trial wall ---------- */
.tg-backdrop {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  padding: 24px; overflow-y: auto;
  background: rgba(16,13,26,0.72); backdrop-filter: blur(6px);
  animation: ref-fade .2s ease;
}
.tg-modal {
  position: relative; width: 100%; max-width: 780px; margin: auto; outline: none;
  max-height: calc(100vh - 48px); overflow: hidden auto;
  background: var(--surface); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg); padding: 28px 32px 32px;
  animation: ref-pop .35s cubic-bezier(.2,.9,.25,1);
}
.tg-head h1 { font-family: var(--display); font-size: 26px; margin: 10px 0 8px; }
.tg-head p { color: var(--faint); font-size: 14px; line-height: 1.55; }
.tg-eyebrow { display: inline-flex; align-items: center; gap: 7px;
  font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: var(--faint); }
.tg-eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--violet); }
.tg-billing { display: inline-flex; gap: 4px; margin: 18px 0 14px; padding: 4px;
  border-radius: 999px; background: var(--surface-3); }
.tg-bopt { padding: 6px 16px; border-radius: 999px; font-size: 13px; font-weight: 600;
  background: transparent; border: 0; color: var(--faint); cursor: pointer; }
.tg-bopt.on { background: var(--surface); color: var(--violet); }
.tg-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.tg-card { padding: 18px; border-radius: 14px; border: 1px solid var(--surface-3); }
.tg-card.pop { border-color: var(--violet); }
.tg-name { display: flex; align-items: center; gap: 8px; font-weight: 700; }
.tg-price { display: flex; align-items: baseline; gap: 2px; margin-top: 10px; }
.tg-price .amt { font-family: var(--display); font-size: 30px; font-weight: 700; }
.tg-price .cur, .tg-price .per { color: var(--faint); font-size: 13px; }
.tg-billed { color: var(--faint); font-size: 12px; margin-bottom: 12px; }
.tg-feats { display: grid; gap: 7px; margin-bottom: 16px; font-size: 13px; }
.tg-feats li { display: flex; gap: 8px; align-items: flex-start; }
.tg-feats .chk { width: 14px; flex: none; color: var(--violet); }
.tg-feats .chk svg { width: 14px; height: 14px; }
.tg-cta { width: 100%; }
.tg-error { margin-top: 14px; font-size: 13px; color: var(--loss, #d1435b); text-align: center; }
.tg-free { display: block; margin: 18px auto 0; padding: 8px 14px; font-size: 13px;
  font-weight: 600; background: none; border: 0; color: var(--faint);
  text-decoration: underline; cursor: pointer; }
.tg-free:disabled { opacity: .5; cursor: default; }
@media (max-width: 640px) {
  .tg-grid { grid-template-columns: 1fr; }
  .tg-modal { padding: 22px; }
}
```

`ref-fade` and `ref-pop` are the existing keyframes defined alongside `.ref-backdrop` — reused, not redefined. Before writing `--loss`, check whether this file defines it (search for `--loss`); if it does not, substitute whichever token the codebase already uses for negative/error red.

- [ ] **Step 3: Wire it into the layout**

In `app/src/app/layout.tsx`, import the gate and the modal:

```ts
import { getTier, getTrialGate, type TrialGate } from '@/lib/server/entitlements'
import { TrialGateModal } from './_components/TrialGateModal'
```

Declare the gate alongside the existing `let internalTraffic = false`, and populate it inside the `if (user)` block — the whole gate, not just `showWall`, because Task 10 needs `state` and `daysLeft` from the same call:

```ts
  let gate: TrialGate | null = null
  if (user) {
    const [{ data }, tier, flags] = await Promise.all([
      supabase.from('profiles').select('account_balance, is_public, is_internal').eq('id', user.id).single(),
      getTier(supabase, user.id),
      getFeatureFlags(),
    ])
    gate = await getTrialGate(supabase, user.id, tier)
    internalTraffic = isAdmin(user) || (data?.is_internal ?? false)
    config = { /* unchanged */ }
  }
```

Then render the modal inside the provider, after `<HelpWidget />`:

```tsx
          {user && <HelpWidget />}
          {user && <TrialGateModal show={!!gate?.showWall} />}
```

- [ ] **Step 4: Typecheck and build**

```bash
npx tsc --noEmit && npm run build
```

Expected: no type errors, build succeeds.

- [ ] **Step 5: Verify the wall in a browser**

Set `TRIAL_WALL_ENABLED=true` in `app/.env.local` and restart the dev server via the preview tooling. Expire a test user's trial:

```sql
update public.profiles
set trial_started_at = now() - interval '15 days', trial_ack_at = null
where username = '<the test username>';
```

Then check, as that user:

- `/` shows the modal.
- Pressing **Escape** does nothing.
- Clicking the **backdrop** does nothing.
- There is no close/X control anywhere in the modal.
- **Tab** cycles within the modal and never reaches the page behind it.
- `/journal` and `/leaderboard` also show it.
- `/settings/billing` does **not** show it.
- The browser console is clean.

Then click **Continue on Free** — the modal disappears and does not return after a reload. Confirm the write landed:

```sql
select trial_ack_at from public.profiles where username = '<the test username>';
```

- [ ] **Step 6: Verify the kill switch**

Reset the user (`update public.profiles set trial_ack_at = null where username = '<...>'`), set `TRIAL_WALL_ENABLED=false`, restart, and reload `/`. Expected: no modal. Set it back to `true` afterwards.

- [ ] **Step 7: Take a screenshot for the user**

Capture the modal on `/` and share it, so the copy and layout can be reviewed before the plan continues.

- [ ] **Step 8: Commit**

```bash
git add app/src/app/_components/TrialGateModal.tsx app/src/app/layout.tsx app/src/app/globals.css
git commit -m "feat(trial): non-dismissible end-of-trial wall with subscribe / continue-free"
```

---

### Task 8: Checkout flow + webhook acknowledgement

**Files:**
- Modify: `app/src/app/api/billing/checkout/route.ts`, `app/src/app/api/stripe/webhook/route.ts`

**Interfaces:**
- Consumes: the `flow: 'trial_end'` body sent by `TrialGateModal` (Task 7).
- Produces: a checkout session returning to `/settings/billing?status=success&…`; `profiles.trial_ack_at` stamped on the first live subscription.

- [ ] **Step 1: Accept `trial_end` in the checkout route**

In `app/src/app/api/billing/checkout/route.ts`, widen the destructured type:

```ts
  const { tier, interval, flow } = (await request.json().catch(() => ({}))) as {
    tier?: Tier; interval?: Interval; flow?: 'onboarding' | 'referral' | 'trial_end'
  }
```

No other change is needed in this file. `trial_end` falls through to the `else if` validation branch (so a bad tier/interval is still rejected) and then to the default `successUrl`/`cancelUrl`, which already point at `/settings/billing?status=success&tier=…&interval=…` — exactly where the trial-end flow should land, and where the existing Meta `Subscribe` pixel fires. It gets no `trial_period_days` and no `payment_method_collection` override, so it is an ordinary paid subscription, and the annual beta coupon applies as it does for the default flow.

- [ ] **Step 2: Stamp `trial_ack_at` in the webhook**

In `app/src/app/api/stripe/webhook/route.ts`, extend the existing active/trialing branch inside `upsertFromSubscription`:

```ts
  const status = (row as { status?: string }).status
  if (status === 'active' || status === 'trialing') {
    try { await markReferralPaid(svc, userId) } catch { /* ignore */ }
    // A paid subscription is itself an answer to the end-of-trial modal, so the
    // user is never re-walled if they later churn. Guarded on null for webhook
    // retry idempotence; best-effort — bookkeeping must never fail the webhook.
    try {
      await svc.from('profiles')
        .update({ trial_ack_at: new Date().toISOString() })
        .eq('id', userId).is('trial_ack_at', null)
    } catch { /* ignore */ }
  }
```

- [ ] **Step 3: Typecheck and run the unit suite**

```bash
npx tsc --noEmit && npm test
```

Expected: PASS. `billing-webhook.test.ts` covers `subscriptionRow()`, which is untouched.

- [ ] **Step 4: Verify the round trip**

With `stripe listen --forward-to localhost:3000/api/stripe/webhook` running and Stripe test keys in `.env.local`, trigger the wall for a test user, click **Subscribe to Trader**, and pay with `4242 4242 4242 4242`, expiry `12/34`, CVC `123`.

Expected: redirect to `/settings/billing?status=success&tier=trader&interval=monthly`; the plan reads **Trader** after the webhook lands; the wall is gone everywhere. Then confirm the acknowledgement was recorded:

```sql
select trial_ack_at from public.profiles where username = '<the test username>';
```

Expected: non-null. If Stripe test keys are unavailable, skip this step and say so explicitly when reporting the task — do not mark it verified.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/billing/checkout/route.ts app/src/app/api/stripe/webhook/route.ts
git commit -m "feat(trial): trial_end checkout flow, ack trial on first paid subscription"
```

---

### Task 9: E2E coverage for the wall

**Files:**
- Create: `app/tests/e2e/trial.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no application code.

This is where the spec's non-escapability requirement is verified — in a real browser, with a real Escape keypress (see "Deliberate deviations").

- [ ] **Step 1: Write the spec**

Create `app/tests/e2e/trial.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { createServiceClient } from './utils/db'

// The wall only renders when the kill switch is on. Skip rather than fail when
// the dev server was started without it.
const WALL = process.env.TRIAL_WALL_ENABLED === 'true'

async function signUpAndOnboard(page: import('@playwright/test').Page) {
  const stamp = Date.now().toString(36)
  const username = `t_${stamp}`
  const email = `t_${stamp}@tradingsocial.io`
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', 'password123')
  await page.locator('label.fl-terms .fl-check').click()
  await expect(page.locator('input[name="terms"]')).toBeChecked()
  await page.click('button:has-text("Join the Beta")')
  // Trial welcome step — 14 days of Pro, no card
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
  await expect(page).toHaveURL('/', { timeout: 15000 })
  return username
}

async function expireTrial(username: string) {
  const svc = createServiceClient()
  const { error } = await svc
    .from('profiles')
    .update({
      trial_started_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      trial_ack_at: null,
    })
    .eq('username', username)
  if (error) throw new Error(`could not expire trial: ${error.message}`)
}

const wall = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: /days of Pro have ended/i })

test('a new user is on the Pro trial, not Free', async ({ page }) => {
  await signUpAndOnboard(page)
  await page.goto('/settings/billing')
  await expect(page.locator('.ts-sub')).toContainText('Pro Trader')
})

test('an expired trial walls the app and cannot be escaped', async ({ page }) => {
  test.skip(!WALL, 'requires TRIAL_WALL_ENABLED=true on the dev server')
  const username = await signUpAndOnboard(page)
  await expireTrial(username)

  await page.goto('/')
  await expect(wall(page)).toBeVisible()

  // No close control, and neither Escape nor a backdrop click dismisses it.
  await expect(page.locator('.tg-modal button[aria-label="Close"]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(wall(page)).toBeVisible()
  await page.locator('.tg-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(wall(page)).toBeVisible()

  // It follows the user around the app…
  for (const path of ['/journal', '/leaderboard']) {
    await page.goto(path)
    await expect(wall(page)).toBeVisible()
  }
  // …except on billing, where Subscribe has to land.
  await page.goto('/settings/billing')
  await expect(wall(page)).toHaveCount(0)
})

test('Continue on Free clears the wall for good', async ({ page }) => {
  test.skip(!WALL, 'requires TRIAL_WALL_ENABLED=true on the dev server')
  const username = await signUpAndOnboard(page)
  await expireTrial(username)

  await page.goto('/')
  await expect(wall(page)).toBeVisible()
  await page.click('button:has-text("Continue on Free")')
  await expect(wall(page)).toHaveCount(0)

  await page.reload()
  await expect(wall(page)).toHaveCount(0)
  await page.goto('/settings/billing')
  await expect(page.locator('.ts-sub')).toContainText('Free')
})
```

- [ ] **Step 2: Run the spec**

Make sure the dev server was started with `TRIAL_WALL_ENABLED=true` in `app/.env.local`, then:

```bash
npm run test:e2e -- tests/e2e/trial.spec.ts
```

Expected: 3 passed.

- [ ] **Step 3: Run the full e2e suite for regressions**

```bash
npm run test:e2e
```

Expected: no new failures versus the pre-change baseline. `billing.spec.ts`'s first test asserts `Current plan:` while the page renders "You're on the …" — if that test was already failing before this branch, report it as pre-existing rather than fixing it here.

- [ ] **Step 4: Commit**

```bash
git add app/tests/e2e/trial.spec.ts
git commit -m "test(trial): e2e coverage for the non-escapable end-of-trial wall"
```

---

### Task 10: Trial countdown chip and final-days banner

**Files:**
- Modify: `app/src/app/_components/AppNav.tsx`, `app/src/app/layout.tsx`, `app/src/app/globals.css`
- Create: `app/src/app/_components/TrialEndingBanner.tsx`

**Interfaces:**
- Consumes: `getTrialGate` (Task 3).
- Produces: `<TrialEndingBanner daysLeft={number} />`.

- [ ] **Step 1: Add the chip to the nav**

In `app/src/app/_components/AppNav.tsx`, import the gate:

```ts
import { getTier, getTrialGate } from '@/lib/server/entitlements'
```

Add `let trialDaysLeft = 0` and `let onTrial = false` beside `let isPro = false`, and inside the `if (user)` block, after `isPro` is computed:

```ts
    const gate = await getTrialGate(supabase, user.id, tier)
    onTrial = gate.state === 'active'
    trialDaysLeft = gate.daysLeft
```

Replace the badge/upgrade ternary at `AppNav.tsx:55-57` with a three-way choice — an active trial gets its own honest label rather than a PRO badge implying they pay:

```tsx
              {onTrial
                ? <Link href="/settings/billing" className="ts-trial-chip">
                    PRO TRIAL · {trialDaysLeft}d left
                  </Link>
                : isPro
                  ? <span className="ts-pro-badge">PRO</span>
                  : <Link href="/settings/billing" className="btn btn-sm" style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px' }}>Upgrade</Link>}
```

- [ ] **Step 2: Write the banner**

Create `app/src/app/_components/TrialEndingBanner.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

/** Final-days nudge. The dismissal key includes the day count, so it shows
 *  once on each of the last few days rather than once ever. */
export function TrialEndingBanner({ daysLeft }: { daysLeft: number }) {
  const [hidden, setHidden] = useState(true)
  const key = `ts_trial_nudge_${daysLeft}`

  useEffect(() => {
    setHidden(localStorage.getItem(key) === '1')
  }, [key])

  if (hidden) return null

  const dismiss = () => { localStorage.setItem(key, '1'); setHidden(true) }

  return (
    <div className="ts-trial-banner" role="status">
      <span>
        {daysLeft === 0
          ? 'Your Pro trial ends today.'
          : `Your Pro trial ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}.`}
        {' '}Keep unlimited journaling, advanced analytics and MT5 sync.
      </span>
      <Link href="/settings/billing" className="btn btn-primary btn-sm">See plans</Link>
      <button type="button" onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  )
}
```

- [ ] **Step 3: Render the banner from the layout**

`layout.tsx` already holds the full `gate` from Task 7, so this is purely additive. Add the import:

```ts
import { TrialEndingBanner } from './_components/TrialEndingBanner'
```

and render between `<AppNav />` and `{children}`:

```tsx
          <AppNav />
          {gate?.state === 'active' && gate.daysLeft <= 3 && (
            <TrialEndingBanner daysLeft={gate.daysLeft} />
          )}
          {children}
```

No other change to `layout.tsx` — the modal line from Task 7 stays as it is.

- [ ] **Step 4: Add the styles**

Append to `app/src/app/globals.css`:

```css
/* ---------- Trial countdown chip + final-days banner ---------- */
.ts-trial-chip {
  display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px;
  font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: .02em;
  white-space: nowrap; color: var(--violet); border: 1px solid currentColor;
  text-decoration: none;
}
.ts-trial-banner {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 10px 18px; font-size: 13px;
  background: var(--surface-3); border-bottom: 1px solid var(--faintest);
}
.ts-trial-banner > span { flex: 1 1 260px; }
.ts-trial-banner > button {
  background: none; border: 0; color: var(--faint); cursor: pointer;
  font-size: 14px; line-height: 1; padding: 4px;
}
```

Same rule as Task 7: only tokens this file already defines.

- [ ] **Step 5: Typecheck and build**

```bash
npx tsc --noEmit && npm run build
```

Expected: no type errors, build succeeds.

- [ ] **Step 6: Verify chip and banner in a browser**

As a user with a fresh trial, expect `PRO TRIAL · 14d left` in the nav and no banner. Then push the start date back and reload each time:

```sql
update public.profiles set trial_started_at = now() - interval '12 days'
where username = '<the test username>';
```

Expected: chip reads `2d left` and the banner appears. Dismiss it — it stays gone on reload. Then set the interval to `13 days`: the chip reads `1d left` and the banner returns (different day count, different dismissal key). Take a screenshot of the nav chip and the banner for the user.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/_components/AppNav.tsx app/src/app/_components/TrialEndingBanner.tsx app/src/app/layout.tsx app/src/app/globals.css
git commit -m "feat(trial): nav countdown chip and final-days reminder banner"
```

---

### Task 11: Rollout notes and environment

**Files:**
- Modify: `app/.env.example`, `README.md` if it documents env vars

**Interfaces:**
- Consumes: nothing.
- Produces: no application code.

- [ ] **Step 1: Document the kill switch**

Append to the existing `app/.env.example`:

```bash
# End-of-trial paywall. The 14-day Pro trial always runs; this only controls
# whether the blocking end-of-trial modal renders. Ship with 'false', flip to
# 'true' once the first cohort is genuinely 14 days past signup.
TRIAL_WALL_ENABLED=false
```

If `README.md` has an environment-variable table, add the same row there.

- [ ] **Step 2: Write the rollout checklist into the plan's home**

Create `docs/superpowers/plans/2026-07-29-pro-trial-rollout.md`:

```markdown
# Pro trial rollout checklist

1. [ ] Apply `0041_pro_trial.sql` to **dev**; verify the backfill skipped internal
   and subscribed accounts.
2. [ ] Set `TRIAL_WALL_ENABLED=false` in Vercel (production **and** preview) and in
   `app/.env.local` **before** deploying.
3. [ ] Merge and deploy. Verify: `/welcome` renders for new signups, the nav chip
   counts down, and a new user resolves to Pro on `/settings/billing`.
4. [ ] Apply `0041_pro_trial.sql` to **production**.
5. [ ] Re-verify on production with a throwaway account.
6. [ ] Wait until the first cohort is 14 days past signup, then flip
   `TRIAL_WALL_ENABLED=true` in Vercel and redeploy.
7. [ ] Watch signups and churn for a week. The switch reverses instantly if needed.
```

Steps 2, 4 and 6 need a human — they touch production infrastructure. Do not attempt them.

- [ ] **Step 3: Commit**

```bash
git add app/.env.example docs/superpowers/plans/2026-07-29-pro-trial-rollout.md README.md
git commit -m "docs(trial): kill-switch env var and rollout checklist"
```

---

### Task 12: Final verification

**Files:** none.

- [ ] **Step 1: Full typecheck, lint, build**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Expected: all clean.

- [ ] **Step 2: Full unit suite**

```bash
npm test
```

Expected: PASS, including the new `trial.test.ts`.

- [ ] **Step 3: Full e2e suite**

```bash
npm run test:e2e
```

Expected: no new failures versus the baseline recorded in Task 9 Step 3.

- [ ] **Step 4: Confirm no stray references to the old funnel**

```bash
grep -rn "SelectPlanForm\|Continue with Free" app/src app/tests
```

Expected: no output.

- [ ] **Step 5: Report**

Summarise for the user: what shipped, what was verified with real command output, anything skipped (e.g. the Stripe round trip if test keys were unavailable), and the three human-only rollout steps. Do not claim the wall is live — it ships behind `TRIAL_WALL_ENABLED=false`.
