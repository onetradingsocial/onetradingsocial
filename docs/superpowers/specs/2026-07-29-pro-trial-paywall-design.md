# 14-day Pro trial + end-of-trial paywall modal — Design

**Date:** 2026-07-29
**Status:** Approved design, pending implementation plan

## Goal

Give every user 14 days of **Pro** for free, with **no card and no Stripe customer**. When the 14
days are up, a **blocking modal** appears that the user must answer: subscribe to Trader/Pro, or
continue on the Free tier.

Requirements captured during brainstorming:

- **The Free tier survives.** It stays on the pricing page and stays a real place to live. The wall
  is a forced decision point, not a lockout.
- The modal has **no logout button**. Its actions are: subscribe to **Trader**, subscribe to
  **Pro**, or **Continue on Free**.
- The modal is **not escapable** — no Escape key, no backdrop click, no close button. It must be
  answered.
- **"Continue on Free" is final.** Once chosen, the modal never appears again.
- Eligibility: **new signups and existing free users**. Existing users' 14 days start the day this
  ships.
- The signup funnel's plan-picker step is **replaced by a trial welcome screen** — no checkout, no
  card, at signup.
- During the trial: a **nav chip countdown** plus a **reminder banner in the final 3 days**.
- The wall blocks **everywhere in the app once logged in**, except `/settings/billing`, which must
  stay reachable so "Subscribe" has somewhere to land and the Stripe return trip works.

## Background (current state)

- Effective tier funnels through one function: `getTier()` in `app/src/lib/server/entitlements.ts`.
  It (1) returns `pro` for `ADMIN_EMAILS` addresses, (2) reads `profiles.comp_tier` (admin comp
  grant) and the `subscriptions` Stripe mirror in parallel, and (3) returns
  `higherTier(comp, stripe)`.
- Pure tier helpers live in `app/src/lib/entitlements.ts`: `TIER_RANK`, `tierFromSubscriptions()`,
  `higherTier()`, `normalizeCompTier()`, `can()`.
- `app/src/app/layout.tsx` calls `getTier()` for every authenticated request and renders
  `<TradeModalProvider>`, `<AppNav />`, `{children}`, `<HelpWidget />`.
- `app/src/app/_components/AppNav.tsx` separately calls `getTier()` and renders either a `PRO` badge
  or an `Upgrade` button (`AppNav.tsx:55`).
- Signup funnel: **Sign up → `/select-plan` → `/onboarding`**. `middleware.ts` gates
  `FUNNEL_PATHS = ['/onboarding', '/select-plan']` on `onboarding_completed`.
  `app/src/app/select-plan/SelectPlanForm.tsx` is a 3-card plan picker that either routes to
  `/onboarding` (Free) or opens Stripe checkout with `flow: 'onboarding'`.
- `POST /api/billing/checkout` creates a Stripe customer, persists `profiles.stripe_customer_id`,
  and builds a checkout session. `flow` is currently `'onboarding' | 'referral'`.
- `POST /api/stripe/webhook` upserts the `subscriptions` mirror in `upsertFromSubscription()` and
  calls `markReferralPaid()` when status is `active`/`trialing`.
- `ReferralModal.tsx` is the house modal pattern: `createPortal` to `document.body` (necessary — the
  nav's `backdrop-filter` would otherwise become the containing block and clip a fixed backdrop),
  body scroll lock, Escape handler, backdrop-click close, close button.
- `profiles` already has `is_internal` (used by `layout.tsx` for analytics traffic filtering) and
  `created_at`.
- Next migration number: **0041** (latest applied is `0040_admin_users_filters.sql`).

## Design

### 1. Data model — migration `0041_pro_trial.sql`

Two nullable timestamps on `profiles`:

```sql
alter table public.profiles
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ack_at     timestamptz;

comment on column public.profiles.trial_started_at is
  '14-day free Pro trial start. NULL = never on a trial (never walled).';
comment on column public.profiles.trial_ack_at is
  'When the user answered the end-of-trial modal (Continue on Free, or first paid subscription).';
```

`trial_started_at` is stamped at signup by extending the existing `handle_new_user()` trigger:

```sql
insert into public.profiles (id, username, trial_started_at)
values (new.id, uname, now())
on conflict (id) do nothing;
```

`trial_ack_at` is set in exactly two places: the `ackTrial()` server action ("Continue on Free"),
and the Stripe webhook when a subscription first becomes `active`/`trialing`. The webhook write is
what stops a subscriber who later churns from being re-walled — they already made their decision.

**Backfill**, in the same migration:

```sql
update public.profiles p set trial_started_at = now()
where p.trial_started_at is null
  and coalesce(p.is_internal, false) = false
  and not exists (
    select 1 from public.subscriptions s
    where s.user_id = p.id and s.status in ('active', 'trialing')
  );
```

Existing subscribers and internal/seed accounts stay `NULL`, so they are never walled — including
later, if a subscriber churns. This keeps the 10 seeded demo users and the 3-hourly seed-activity
routine working untouched.

RLS: both columns are covered by the existing `profiles` select policy. They are read server-side
only; no new policy is needed. Neither column is user-writable — `ackTrial()` writes via the service
client.

### 2. Trial resolution — `app/src/lib/entitlements.ts`

Pure, no I/O, injected `now` so it is fully unit-testable:

```ts
export const TRIAL_DAYS = 14
export type TrialState = 'none' | 'active' | 'expired' | 'resolved'

export function trialState(
  startedAt: string | null | undefined,
  ackAt: string | null | undefined,
  now: Date,
): TrialState

export function trialDaysLeft(startedAt: string | null | undefined, now: Date): number
```

| State      | Meaning                                                    | Effect                       |
|------------|------------------------------------------------------------|------------------------------|
| `none`     | `trial_started_at` is null                                  | No trial, no wall, ever      |
| `active`   | `now < startedAt + 14 days`                                 | Grants `pro`, shows nav chip |
| `expired`  | past 14 days, `trial_ack_at` null                           | Shows the wall               |
| `resolved` | `trial_ack_at` set                                          | Normal user, no wall         |

`resolved` is checked before `expired`. `trialDaysLeft` returns a ceiling'd whole number of days,
clamped at 0.

### 3. `getTier()` — `app/src/lib/server/entitlements.ts`

The two new columns join the `profiles` select `getTier()` already makes, so this costs **zero extra
queries**:

```ts
svc.from('profiles')
   .select('comp_tier, trial_started_at, trial_ack_at')
   .eq('id', userId).maybeSingle()
```

```ts
const trialTier: Tier =
  trialState(prof?.trial_started_at, prof?.trial_ack_at, new Date()) === 'active' ? 'pro' : 'free'
return higherTier(normalizeCompTier(prof?.comp_tier), higherTier(stripeTier, trialTier))
```

Folding through `higherTier()` means a paying Trader is never dragged down, and an admin or
comp-granted Pro is unaffected. It also means a trial user who subscribes to **Trader** on day 3
keeps Pro until day 14 — a deliberate small gift rather than a downgrade-on-payment.

### 4. The gate — `getTrialGate()`

New function in `app/src/lib/server/entitlements.ts`:

```ts
export type TrialGate = { state: TrialState; daysLeft: number; showWall: boolean }
export async function getTrialGate(
  supabase: SupabaseClient, userId: string, tier: Tier,
): Promise<TrialGate>
```

`showWall = TRIAL_WALL_ENABLED && state === 'expired' && tier === 'free'`.

The `tier === 'free'` clause is what exempts admins, comp-granted users, and active subscribers —
no special-casing anywhere. `tier` is passed in from the caller's existing `getTier()` result rather
than recomputed.

`TRIAL_WALL_ENABLED` is an env var (`process.env.TRIAL_WALL_ENABLED === 'true'`) read server-side. A
blocking modal is precisely the feature that needs a kill switch that does not require a deploy. It
must be set in Vercel (prod + preview) and in `.env.local` as part of rollout.

**Fail-open by design:** a null `trial_started_at`, a failed profile read, or an unset env var all
resolve to no wall. A bug in this code path must never lock out the userbase.

### 5. The modal — `app/src/app/_components/TrialGateModal.tsx`

`layout.tsx` already computes `tier` per authenticated request; it calls `getTrialGate()` and
renders `<TrialGateModal gate={gate} />` alongside `<HelpWidget />`.

Client component, portalled to `document.body` (same reason as `ReferralModal`). It deliberately
**omits** the three escape hatches `ReferralModal` has:

- no `keydown` Escape handler
- no backdrop `onMouseDown` close
- no close button

It keeps the body scroll lock, adds a focus trap (focus moves to the modal on mount; Tab cycles
within it), `role="dialog"`, `aria-modal="true"`, and an `aria-labelledby` pointing at the heading.

Content:

- Heading: "Your 14 days of Pro have ended."
- Sub: what they had, and what stays on Free (journal history capped at the last 30 trades, basic
  stats, feed, leaderboard).
- Monthly/annual toggle plus **Trader** and **Pro** cards, reusing the plan data and `fl-*` visual
  language from `SelectPlanForm.tsx`. Each card's button `POST`s to `/api/billing/checkout` with
  `{ tier, interval, flow: 'trial_end' }` and redirects to the returned session URL.
- A quiet text button **"Continue on Free"** → `ackTrial()` server action → `router.refresh()`.

Errors from either action render **inline inside the modal** and leave it up. No `alert()`.

**Rendering it server-side on every authed page is the enforcement mechanism.** Deleting the DOM
node in devtools just brings it back on the next navigation, since `showWall` is recomputed per
request. Being explicit: this is a persuasion wall, not a security boundary. Actual feature access
is enforced by `getTier()` at every call site, which is where it belongs and which is unchanged.

**Exception:** `/settings/billing` renders without the wall, so "Subscribe" has a landing page and
the Stripe success/cancel return trip works. Since the root layout has no access to the pathname,
the check lives inside `TrialGateModal` itself — it is already a client component, so it calls
`usePathname()` and returns `null` on `/settings/billing`. No middleware change is needed for this.

Logged-out visitors never see the modal: `layout.tsx` only computes the gate when there is a user.
Funnel routes (`/welcome`, `/onboarding`) need no exception either — a walled user has
`onboarding_completed = true`, so `middleware.ts` already redirects them away from those paths.

### 6. Checkout + webhook wiring

`POST /api/billing/checkout` gains `'trial_end'` to the `flow` union:

- `successUrl`: `${SITE}/settings/billing?status=success&tier=${tier}&interval=${interval}` (same as
  the default flow, so the existing Meta `Subscribe` pixel on the billing page fires unchanged).
- `cancelUrl`: `${SITE}/settings/billing?status=cancelled`.
- No `trial_period_days`, no `payment_method_collection` override — a normal paid subscription.
- The annual beta coupon applies exactly as it does for the default flow.

The existing `flow: 'onboarding'` branch is left in place: dead once the funnel changes, but harmless
and it keeps any in-flight checkout session's cancel URL working.

`upsertFromSubscription()` in the webhook, inside the existing `status === 'active' || 'trialing'`
branch, also stamps the acknowledgement:

```ts
await svc.from('profiles')
  .update({ trial_ack_at: new Date().toISOString() })
  .eq('id', userId).is('trial_ack_at', null)
```

The `.is('trial_ack_at', null)` guard keeps it idempotent across webhook retries. Best-effort, in the
same try/catch style as `markReferralPaid()` — bookkeeping must never fail the webhook.

### 7. `ackTrial()` server action

New action in `app/src/app/actions/profile.ts` (or a new `trial.ts` if that file is already large):

```ts
export async function ackTrial(): Promise<{ ok: true } | { ok: false; error: string }>
```

Uses `getUser()` (a mutation, per the project's auth read-vs-write rule), writes
`trial_ack_at = now()` via the service client guarded on `is('trial_ack_at', null)`, and
`revalidatePath('/', 'layout')`. It takes no arguments — the user can only acknowledge their own
trial, so there is nothing to forge.

### 8. Signup funnel — `/select-plan` → `/welcome`

New route `app/src/app/welcome/page.tsx` + `TrialWelcome.tsx`, reusing the `fl-*` card and step-bar
styles so the existing 3-step progress bar survives — step 2 is relabelled **Trial**.

Content: "Your 14 days of Pro start now", the Pro feature list, **"No card required"** in the fine
print, and a single **Continue** button routing to `/onboarding`. No plan cards, no checkout.

- `app/src/app/select-plan/page.tsx` becomes a permanent redirect to `/welcome`, so stale tabs and
  the old `flow: 'onboarding'` cancel URL still land somewhere sane.
- `FUNNEL_PATHS` in `middleware.ts` becomes `['/onboarding', '/select-plan', '/welcome']`.
- `SelectPlanForm.tsx` is deleted; its `PLANS` array moves to a shared
  `app/src/lib/plans.ts` so `TrialWelcome`, `TrialGateModal`, and the billing page all read one
  source of plan copy.

### 9. Trial visibility during the 14 days

**Nav chip.** `AppNav.tsx` calls `getTrialGate()` (it already calls `getTier()`). When
`state === 'active'`, the `PRO` badge / `Upgrade` button slot at `AppNav.tsx:55` instead renders
`PRO TRIAL · {n}d left`, linking to `/settings/billing`. One honest indicator, rather than a `PRO`
badge that implies they are paying.

**Final-3-days banner.** `<TrialEndingBanner daysLeft={n} />`, a dismissible strip under the nav,
rendered when `state === 'active' && daysLeft <= 3`. Dismissal is stored in `localStorage` under
`ts_trial_nudge_{daysLeft}`, so it shows once on each of the last three days rather than once ever.

**Accepted knock-on:** during the trial `getTier()` returns `pro`, so `pro_badge` is live and other
users see a PRO badge on the trial user's public profile for 14 days. This is intentional — it is a
real entitlement and it is part of what makes the trial feel worth keeping.

### 10. Days-left and clocks

All trial arithmetic happens **server-side**. `daysLeft` is computed in `getTrialGate()` and passed
to client components as a number. A skewed client clock cannot extend a trial, and there is no
hydration mismatch from `new Date()` running on both sides.

## Testing

**Unit** — extend `app/tests/unit/entitlements.test.ts`:

- `trialState`: null start → `none`; day 0 and day 13.9 → `active`; exactly 14 days and beyond →
  `expired`; `trial_ack_at` set → `resolved` regardless of elapsed time.
- `trialDaysLeft`: 14 at start, 1 on the final day, 0 once expired, never negative.
- `getTier` folding: trial + no sub → `pro`; trial + Trader sub → `pro`; expired trial + no sub →
  `free`; expired trial + comp Trader → `trader`; admin → `pro` regardless.
- `getTrialGate`: `showWall` true only for `expired` + `free` + flag enabled; false for each of the
  three failing individually.

**Component** — `TrialGateModal`:

- Escape keydown does not dismiss it.
- Backdrop `mousedown` does not dismiss it.
- No element with an accessible name of "Close" exists.
- A failed `ackTrial()` leaves the modal mounted and shows an inline error.

**E2E** — extend `app/tests/e2e/billing.spec.ts`:

- A user with `trial_started_at` 15 days ago and null `trial_ack_at` sees the wall on `/`,
  `/journal`, and `/leaderboard`, and does **not** see it on `/settings/billing`.
- Clicking "Continue on Free" clears the wall, and it is still gone after a reload.
- A user with an active subscription and an expired trial never sees the wall.

## Rollout

1. Apply `0041_pro_trial.sql` to **dev** first; confirm the backfill skipped internal + subscribed
   accounts.
2. Set `TRIAL_WALL_ENABLED=false` in Vercel (prod + preview) and `.env.local` **before** deploying,
   so the trial and funnel ship without the wall going live.
3. Deploy. Verify the welcome screen, nav chip, and that trial users resolve to Pro.
4. Apply `0041` to **prod**.
5. Flip `TRIAL_WALL_ENABLED=true` once the first cohort is genuinely 14 days in.

## Out of scope

- Email reminders during or at the end of the trial.
- Extending or re-issuing a trial from the admin panel (`comp_tier` already covers ad-hoc grants).
- Any change to what the Free tier includes.
- Any change to the referral free-Pro flow, which keeps its own Stripe-trial mechanism.
