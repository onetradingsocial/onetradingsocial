# Stripe Billing & Tier Entitlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stripe subscription billing (Trader, Pro) to the Next.js/Supabase app with tier-based feature entitlements gating the four features that exist today.

**Architecture:** Stripe is the source of truth; a webhook mirrors subscription state into a Supabase `subscriptions` table. A pure `entitlements.ts` module (mirroring `admin.ts`) resolves tier → feature access; a `server/entitlements.ts` gate reads the mirror. Hosted Stripe Checkout + Billing Portal handle all money UI. Build in test mode; go live by swapping env only.

**Tech Stack:** Next.js 15 App Router (RSC + route handlers), Supabase (`@supabase/ssr` + service-role client), `stripe` Node SDK, vitest (unit), Playwright (e2e).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-25-stripe-billing-design.md`.
- All work in **Stripe test mode**. Secrets are server-only — never `NEXT_PUBLIC_`.
- `subscriptions` table: **no client write policy**; only the service-role webhook writes (mirrors `lesson_completions`).
- Reads use `getSessionUser`/`getClaims`; **mutations & route handlers use `getUser()`** (house rule, see `lib/supabase/server.ts`).
- `getTier` **fails closed to `'free'`** on any error — never grant paid access on failure.
- Tier ranks: `free 0, trader 1, pro 2`. Effective tier = highest tier among subs with `status in ('active','trialing')`.
- `JOURNAL_FREE_LIMIT = 30`. Free downgrade **hides, never deletes** trades.
- Migration `0009_billing` applied to Supabase Cloud manually by the user (dashboard SQL editor / `supabase db push`), as in prior phases.
- Tests run from `app/`: `npm test` (vitest), `npm run test:e2e` (Playwright). Warm the dev server before e2e. Never `npm run build` while dev server is up.
- Commit per task. Branch: `phase8-stripe-billing` (already created).

---

### Task 1: Stripe SDK + server client singleton

**Files:**
- Modify: `app/package.json` (add `stripe` dep)
- Create: `app/src/lib/stripe.ts`

**Interfaces:**
- Produces: `getStripe(): Stripe` — lazy server-only singleton.

- [ ] **Step 1: Install the SDK**

Run (from `app/`): `npm install stripe`
Expected: `stripe` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Create the client singleton**

Create `app/src/lib/stripe.ts`:

```ts
import 'server-only'
import Stripe from 'stripe'

let _stripe: Stripe | null = null

/** Lazy server-only Stripe client. API version omitted -> uses the account
 *  default pinned in the Stripe dashboard. */
export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
    _stripe = new Stripe(key)
  }
  return _stripe
}
```

- [ ] **Step 3: Typecheck**

Run (from `app/`): `npx tsc --noEmit`
Expected: no errors referencing `stripe.ts`.

- [ ] **Step 4: Commit**

```bash
git add app/package.json app/package-lock.json app/src/lib/stripe.ts
git commit -m "feat(billing): add stripe SDK + server client singleton"
```

---

### Task 2: Migration `0009_billing`

**Files:**
- Create: `app/supabase/migrations/0009_billing.sql`

**Interfaces:**
- Produces: `profiles.stripe_customer_id`, `courses.min_tier`, table `public.subscriptions` (RLS: owner select, service-role-only writes).

- [ ] **Step 1: Write the migration**

Create `app/supabase/migrations/0009_billing.sql`:

```sql
-- Phase 8: Stripe billing. Stripe customer id, learning tier gate, and the
-- subscription mirror (written ONLY by the webhook via the service role).

alter table public.profiles
  add column if not exists stripe_customer_id text unique;

alter table public.courses
  add column if not exists min_tier text not null default 'free';
-- 'free' | 'trader' | 'pro'

create table if not exists public.subscriptions (
  id text primary key,                         -- Stripe subscription id
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null,                        -- active, trialing, past_due, canceled, ...
  tier text not null,                          -- 'trader' | 'pro'
  price_id text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions(user_id);

alter table public.subscriptions enable row level security;
-- Owner reads own subscription; NO insert/update/delete policy -> service role only.
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();
```

- [ ] **Step 2: Apply to Supabase Cloud**

The user applies it (dashboard SQL editor or `supabase db push`). Verify: in the SQL editor, `select id, status, tier from public.subscriptions limit 1;` returns no error (empty result OK), and `select min_tier from public.courses limit 1;` returns `free`.

- [ ] **Step 3: Commit**

```bash
git add app/supabase/migrations/0009_billing.sql
git commit -m "feat(billing): migration 0009 - stripe_customer_id, courses.min_tier, subscriptions"
```

---

### Task 3: Pure entitlements module

**Files:**
- Create: `app/src/lib/entitlements.ts`
- Test: `app/tests/unit/entitlements.test.ts`

**Interfaces:**
- Produces:
  - `type Tier = 'free' | 'trader' | 'pro'`, `type Interval = 'monthly' | 'annual'`
  - `TIER_RANK: Record<Tier, number>`, `JOURNAL_FREE_LIMIT = 30`
  - `tierFromSubscriptions(subs: { tier: string; status: string }[]): Tier`
  - `type PlanEnv` and `planForPrice(priceId, env): { tier; interval } | null`, `priceForPlan(tier, interval, env): string | null`
  - `type Feature`, `FEATURE_MIN_TIER: Record<Feature, Tier>`, `can(tier: Tier, feature: Feature): boolean`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/entitlements.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  TIER_RANK, JOURNAL_FREE_LIMIT, tierFromSubscriptions,
  planForPrice, priceForPlan, can, type PlanEnv,
} from '@/lib/entitlements'

const ENV: PlanEnv = {
  STRIPE_PRICE_TRADER_MONTHLY: 'price_tm',
  STRIPE_PRICE_TRADER_ANNUAL: 'price_ta',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pm',
  STRIPE_PRICE_PRO_ANNUAL: 'price_pa',
}

describe('tierFromSubscriptions', () => {
  it('returns free with no active subs', () => {
    expect(tierFromSubscriptions([])).toBe('free')
    expect(tierFromSubscriptions([{ tier: 'pro', status: 'canceled' }])).toBe('free')
    expect(tierFromSubscriptions([{ tier: 'trader', status: 'past_due' }])).toBe('free')
  })
  it('counts active and trialing', () => {
    expect(tierFromSubscriptions([{ tier: 'trader', status: 'active' }])).toBe('trader')
    expect(tierFromSubscriptions([{ tier: 'pro', status: 'trialing' }])).toBe('pro')
  })
  it('picks the highest active tier', () => {
    expect(tierFromSubscriptions([
      { tier: 'trader', status: 'active' },
      { tier: 'pro', status: 'active' },
    ])).toBe('pro')
  })
  it('ignores unknown tier strings', () => {
    expect(tierFromSubscriptions([{ tier: 'gold', status: 'active' }])).toBe('free')
  })
})

describe('planForPrice / priceForPlan', () => {
  it('resolves a known price', () => {
    expect(planForPrice('price_pa', ENV)).toEqual({ tier: 'pro', interval: 'annual' })
    expect(planForPrice('price_tm', ENV)).toEqual({ tier: 'trader', interval: 'monthly' })
  })
  it('returns null for an unknown price', () => {
    expect(planForPrice('price_x', ENV)).toBeNull()
  })
  it('round-trips plan -> price', () => {
    expect(priceForPlan('trader', 'annual', ENV)).toBe('price_ta')
    expect(priceForPlan('pro', 'monthly', ENV)).toBe('price_pm')
    expect(priceForPlan('free', 'monthly', ENV)).toBeNull()
  })
})

describe('can', () => {
  it('gates by rank', () => {
    expect(can('free', 'journal_unlimited')).toBe(false)
    expect(can('trader', 'journal_unlimited')).toBe(true)
    expect(can('trader', 'advanced_stats')).toBe(true)
    expect(can('free', 'advanced_stats')).toBe(false)
    expect(can('trader', 'pro_badge')).toBe(false)
    expect(can('pro', 'pro_badge')).toBe(true)
    expect(can('trader', 'learning_intermediate')).toBe(true)
    expect(can('free', 'learning_intermediate')).toBe(false)
    expect(can('pro', 'premium_courses')).toBe(true)
    expect(can('trader', 'premium_courses')).toBe(false)
  })
})

describe('constants', () => {
  it('ranks and limit', () => {
    expect(TIER_RANK).toEqual({ free: 0, trader: 1, pro: 2 })
    expect(JOURNAL_FREE_LIMIT).toBe(30)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run (from `app/`): `npm test -- entitlements`
Expected: FAIL — cannot resolve `@/lib/entitlements`.

- [ ] **Step 3: Implement the module**

Create `app/src/lib/entitlements.ts`:

```ts
export type Tier = 'free' | 'trader' | 'pro'
export type Interval = 'monthly' | 'annual'

export const TIER_RANK: Record<Tier, number> = { free: 0, trader: 1, pro: 2 }
export const JOURNAL_FREE_LIMIT = 30

const ACTIVE_STATUSES = new Set(['active', 'trialing'])

function isTier(t: string): t is Tier {
  return t === 'free' || t === 'trader' || t === 'pro'
}

/** Effective tier = highest-ranked tier among active/trialing subs, else free. */
export function tierFromSubscriptions(subs: { tier: string; status: string }[]): Tier {
  let best: Tier = 'free'
  for (const s of subs) {
    if (!ACTIVE_STATUSES.has(s.status)) continue
    if (isTier(s.tier) && TIER_RANK[s.tier] > TIER_RANK[best]) best = s.tier
  }
  return best
}

export type PlanEnv = {
  STRIPE_PRICE_TRADER_MONTHLY?: string
  STRIPE_PRICE_TRADER_ANNUAL?: string
  STRIPE_PRICE_PRO_MONTHLY?: string
  STRIPE_PRICE_PRO_ANNUAL?: string
}

type Plan = { tier: Tier; interval: Interval }

function priceMap(env: PlanEnv): Array<[string | undefined, Plan]> {
  return [
    [env.STRIPE_PRICE_TRADER_MONTHLY, { tier: 'trader', interval: 'monthly' }],
    [env.STRIPE_PRICE_TRADER_ANNUAL, { tier: 'trader', interval: 'annual' }],
    [env.STRIPE_PRICE_PRO_MONTHLY, { tier: 'pro', interval: 'monthly' }],
    [env.STRIPE_PRICE_PRO_ANNUAL, { tier: 'pro', interval: 'annual' }],
  ]
}

export function planForPrice(priceId: string, env: PlanEnv): Plan | null {
  for (const [id, plan] of priceMap(env)) if (id && id === priceId) return plan
  return null
}

export function priceForPlan(tier: Tier, interval: Interval, env: PlanEnv): string | null {
  for (const [id, plan] of priceMap(env)) {
    if (id && plan.tier === tier && plan.interval === interval) return id
  }
  return null
}

export type Feature =
  | 'journal_unlimited' | 'advanced_stats' | 'pro_badge'
  | 'learning_intermediate' | 'premium_courses'
  | 'saved_traders' | 'creator_profile' | 'strategy_tracking' | 'mistake_tagging'
  | 'risk_tracking' | 'private_notes' | 'custom_templates' | 'export_journal'
  | 'weekly_review' | 'strategy_breakdown' | 'advanced_reporting' | 'monthly_report'
  | 'ai_insights' | 'advanced_leaderboard_filters' | 'leaderboard_placement'
  | 'premium_challenges' | 'xp_boosts' | 'priority_support' | 'early_access'

/** Full pricing-matrix gate. Features not yet built are still mapped so the
 *  gate is ready when the feature ships. */
export const FEATURE_MIN_TIER: Record<Feature, Tier> = {
  // Enforced in v1 (features that exist):
  journal_unlimited: 'trader',
  advanced_stats: 'trader',
  learning_intermediate: 'trader',
  premium_courses: 'pro',
  pro_badge: 'pro',
  // Wired, enforced when built:
  saved_traders: 'trader',
  strategy_tracking: 'trader',
  mistake_tagging: 'trader',
  risk_tracking: 'trader',
  private_notes: 'trader',
  weekly_review: 'trader',
  advanced_leaderboard_filters: 'trader',
  xp_boosts: 'trader',
  export_journal: 'trader',
  creator_profile: 'pro',
  custom_templates: 'pro',
  strategy_breakdown: 'pro',
  advanced_reporting: 'pro',
  monthly_report: 'pro',
  ai_insights: 'pro',
  leaderboard_placement: 'pro',
  premium_challenges: 'pro',
  priority_support: 'pro',
  early_access: 'pro',
}

export function can(tier: Tier, feature: Feature): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURE_MIN_TIER[feature]]
}
```

- [ ] **Step 4: Run tests — verify pass**

Run (from `app/`): `npm test -- entitlements`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/entitlements.ts app/tests/unit/entitlements.test.ts
git commit -m "feat(billing): pure entitlements module (tier resolution + feature map)"
```

---

### Task 4: Server entitlement gate

**Files:**
- Create: `app/src/lib/server/entitlements.ts`

**Interfaces:**
- Consumes: `tierFromSubscriptions`, `Tier` from `@/lib/entitlements`.
- Produces:
  - `getTier(supabase, userId): Promise<Tier>` (fails closed to `'free'`)
  - `getSubscription(supabase, userId): Promise<CurrentSub | null>`
  - `type CurrentSub = { tier: Tier; status: string; priceId: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean }`

- [ ] **Step 1: Implement the gate**

Create `app/src/lib/server/entitlements.ts`:

```ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { tierFromSubscriptions, TIER_RANK, type Tier } from '@/lib/entitlements'

/** Effective tier from the local mirror. Fails closed to 'free' on any error. */
export async function getTier(supabase: SupabaseClient, userId: string): Promise<Tier> {
  const { data, error } = await supabase
    .from('subscriptions').select('tier, status').eq('user_id', userId)
  if (error || !data) return 'free'
  return tierFromSubscriptions(data)
}

export type CurrentSub = {
  tier: Tier
  status: string
  priceId: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

/** The highest-ranked subscription row for billing UI (renewal/cancel display). */
export async function getSubscription(
  supabase: SupabaseClient, userId: string,
): Promise<CurrentSub | null> {
  const { data } = await supabase
    .from('subscriptions')
    .select('tier, status, price_id, current_period_end, cancel_at_period_end')
    .eq('user_id', userId)
  if (!data || data.length === 0) return null
  const best = [...data].sort(
    (a, b) => (TIER_RANK[b.tier as Tier] ?? -1) - (TIER_RANK[a.tier as Tier] ?? -1),
  )[0]
  return {
    tier: best.tier as Tier,
    status: best.status,
    priceId: best.price_id,
    currentPeriodEnd: best.current_period_end,
    cancelAtPeriodEnd: best.cancel_at_period_end,
  }
}
```

- [ ] **Step 2: Typecheck**

Run (from `app/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/entitlements.ts
git commit -m "feat(billing): server entitlement gate (getTier fails closed, getSubscription)"
```

---

### Task 5: Webhook event → row mapper (pure) + webhook route

**Files:**
- Create: `app/src/lib/billing-webhook.ts`
- Test: `app/tests/unit/billing-webhook.test.ts`
- Create: `app/src/app/api/stripe/webhook/route.ts`

**Interfaces:**
- Consumes: `planForPrice`, `PlanEnv`, `Tier` from `@/lib/entitlements`; `getStripe` from `@/lib/stripe`; `createServiceClient` from `@/lib/supabase/service`.
- Produces:
  - `subscriptionRow(sub, env): { id; status; tier; price_id; current_period_end; cancel_at_period_end } | null` — pure mapper from a minimal Stripe subscription shape.
  - `POST` handler at `/api/stripe/webhook`.

- [ ] **Step 1: Write the failing test for the pure mapper**

Create `app/tests/unit/billing-webhook.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { subscriptionRow } from '@/lib/billing-webhook'
import type { PlanEnv } from '@/lib/entitlements'

const ENV: PlanEnv = {
  STRIPE_PRICE_TRADER_MONTHLY: 'price_tm',
  STRIPE_PRICE_PRO_ANNUAL: 'price_pa',
}

const sub = (priceId: string, over: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  status: 'active',
  cancel_at_period_end: false,
  current_period_end: 1_700_000_000,
  items: { data: [{ price: { id: priceId } }] },
  ...over,
})

describe('subscriptionRow', () => {
  it('maps an active trader monthly subscription', () => {
    expect(subscriptionRow(sub('price_tm'), ENV)).toEqual({
      id: 'sub_1',
      status: 'active',
      tier: 'trader',
      price_id: 'price_tm',
      current_period_end: '2023-11-14T22:13:20.000Z',
      cancel_at_period_end: false,
    })
  })
  it('carries status and cancel flag', () => {
    const row = subscriptionRow(sub('price_pa', { status: 'past_due', cancel_at_period_end: true }), ENV)
    expect(row?.tier).toBe('pro')
    expect(row?.status).toBe('past_due')
    expect(row?.cancel_at_period_end).toBe(true)
  })
  it('returns null for an unknown price (do not 500 the webhook)', () => {
    expect(subscriptionRow(sub('price_unknown'), ENV)).toBeNull()
  })
  it('handles a null current_period_end', () => {
    expect(subscriptionRow(sub('price_tm', { current_period_end: null }), ENV)?.current_period_end).toBeNull()
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run (from `app/`): `npm test -- billing-webhook`
Expected: FAIL — cannot resolve `@/lib/billing-webhook`.

- [ ] **Step 3: Implement the pure mapper**

Create `app/src/lib/billing-webhook.ts`:

```ts
import { planForPrice, type PlanEnv, type Tier } from '@/lib/entitlements'

type StripeSubLike = {
  id: string
  status: string
  cancel_at_period_end: boolean
  current_period_end: number | null
  items: { data: Array<{ price: { id: string } }> }
}

export type SubscriptionRow = {
  id: string
  status: string
  tier: Tier
  price_id: string
  current_period_end: string | null
  cancel_at_period_end: boolean
}

/** Pure map from a Stripe subscription to a mirror row. Null when the price is
 *  not one of ours (caller should ack 200 and skip, not error). */
export function subscriptionRow(sub: StripeSubLike, env: PlanEnv): SubscriptionRow | null {
  const priceId = sub.items?.data?.[0]?.price?.id
  if (!priceId) return null
  const plan = planForPrice(priceId, env)
  if (!plan) return null
  return {
    id: sub.id,
    status: sub.status,
    tier: plan.tier,
    price_id: priceId,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
    cancel_at_period_end: sub.cancel_at_period_end,
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

Run (from `app/`): `npm test -- billing-webhook`
Expected: PASS.

- [ ] **Step 5: Implement the webhook route**

Create `app/src/app/api/stripe/webhook/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/service'
import { subscriptionRow } from '@/lib/billing-webhook'

export const runtime = 'nodejs'

// Resolve our user id from the Stripe customer (via stored stripe_customer_id),
// falling back to the customer's metadata.user_id.
async function resolveUserId(
  svc: ReturnType<typeof createServiceClient>,
  stripe: Stripe,
  customerId: string,
): Promise<string | null> {
  const { data } = await svc
    .from('profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle()
  if (data?.id) return data.id
  const customer = await stripe.customers.retrieve(customerId)
  if (customer && !customer.deleted && customer.metadata?.user_id) return customer.metadata.user_id
  return null
}

async function upsertFromSubscription(
  svc: ReturnType<typeof createServiceClient>,
  stripe: Stripe,
  sub: Stripe.Subscription,
) {
  const row = subscriptionRow(sub as never, process.env)
  if (!row) return // unknown price -> ack, skip
  const userId = await resolveUserId(svc, stripe, sub.customer as string)
  if (!userId) return
  await svc.from('subscriptions').upsert({ ...row, user_id: userId }, { onConflict: 'id' })
}

export async function POST(request: NextRequest) {
  const stripe = getStripe()
  const sig = request.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!sig || !secret) return NextResponse.json({ error: 'bad request' }, { status: 400 })

  const body = await request.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret)
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }

  const svc = createServiceClient()
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string)
          await upsertFromSubscription(svc, stripe, sub)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertFromSubscription(svc, stripe, event.data.object as Stripe.Subscription)
        break
      }
      default:
        break // ignore unhandled types
    }
  } catch (err) {
    console.error('[stripe webhook] handler error', err)
    return NextResponse.json({ error: 'handler error' }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}
```

- [ ] **Step 6: Typecheck**

Run (from `app/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/billing-webhook.ts app/tests/unit/billing-webhook.test.ts app/src/app/api/stripe/webhook/route.ts
git commit -m "feat(billing): stripe webhook + pure subscription-row mapper"
```

---

### Task 6: Checkout route

**Files:**
- Create: `app/src/app/api/billing/checkout/route.ts`

**Interfaces:**
- Consumes: `getStripe`; `createClient` from `@/lib/supabase/server`; `priceForPlan`, types from `@/lib/entitlements`.
- Produces: `POST /api/billing/checkout` body `{ tier: 'trader'|'pro', interval: 'monthly'|'annual' }` → `{ url }`.

- [ ] **Step 1: Implement the route**

Create `app/src/app/api/billing/checkout/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'
import { priceForPlan, type Tier, type Interval } from '@/lib/entitlements'

export const runtime = 'nodejs'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { tier, interval } = (await request.json().catch(() => ({}))) as {
    tier?: Tier; interval?: Interval
  }
  if ((tier !== 'trader' && tier !== 'pro') || (interval !== 'monthly' && interval !== 'annual')) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  const price = priceForPlan(tier, interval, process.env)
  if (!price) return NextResponse.json({ error: 'price not configured' }, { status: 500 })

  const stripe = getStripe()

  // Ensure a Stripe customer, store its id on the profile.
  const { data: prof } = await supabase
    .from('profiles').select('stripe_customer_id').eq('id', user.id).single()
  let customerId = prof?.stripe_customer_id as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { user_id: user.id },
    })
    customerId = customer.id
    await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id)
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    success_url: `${SITE}/settings/billing?status=success`,
    cancel_url: `${SITE}/settings/billing?status=cancelled`,
  })
  if (!session.url) return NextResponse.json({ error: 'no session url' }, { status: 500 })
  return NextResponse.json({ url: session.url })
}
```

- [ ] **Step 2: Typecheck**

Run (from `app/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/billing/checkout/route.ts
git commit -m "feat(billing): checkout route (ensure customer + subscription session)"
```

---

### Task 7: Billing portal route

**Files:**
- Create: `app/src/app/api/billing/portal/route.ts`

**Interfaces:**
- Consumes: `getStripe`; `createClient` from `@/lib/supabase/server`.
- Produces: `POST /api/billing/portal` → `{ url }`.

- [ ] **Step 1: Implement the route**

Create `app/src/app/api/billing/portal/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: prof } = await supabase
    .from('profiles').select('stripe_customer_id').eq('id', user.id).single()
  const customerId = prof?.stripe_customer_id as string | null
  if (!customerId) return NextResponse.json({ error: 'no customer' }, { status: 400 })

  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${SITE}/settings/billing`,
  })
  return NextResponse.json({ url: session.url })
}
```

- [ ] **Step 2: Typecheck**

Run (from `app/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/billing/portal/route.ts
git commit -m "feat(billing): customer billing portal route"
```

---

### Task 8: Billing page + client actions button

**Files:**
- Create: `app/src/app/settings/billing/page.tsx`
- Create: `app/src/app/settings/billing/BillingActions.tsx` (client)
- Modify: `app/src/app/settings/page.tsx` (add a link to `/settings/billing`)

**Interfaces:**
- Consumes: `getTier`, `getSubscription` from `@/lib/server/entitlements`; `createClient`, `getSessionUser` from `@/lib/supabase/server`.

- [ ] **Step 1: Implement the client actions component**

Create `app/src/app/settings/billing/BillingActions.tsx`:

```tsx
'use client'
import { useState } from 'react'

async function post(url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) { alert('Something went wrong. Please try again.'); return }
  const { url: redirect } = await res.json()
  if (redirect) window.location.href = redirect
}

export function UpgradeButtons() {
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly')
  const [busy, setBusy] = useState(false)
  const go = async (tier: 'trader' | 'pro') => {
    setBusy(true)
    await post('/api/billing/checkout', { tier, interval })
    setBusy(false)
  }
  return (
    <div className="grid gap-4">
      <div className="ts-billing-toggle">
        <button type="button" className={interval === 'monthly' ? 'active' : ''} onClick={() => setInterval('monthly')}>Monthly</button>
        <button type="button" className={interval === 'annual' ? 'active' : ''} onClick={() => setInterval('annual')}>Annual (2 months free)</button>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => go('trader')}>
          Upgrade to Trader — {interval === 'monthly' ? '$30/mo' : '$300/yr'}
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => go('pro')}>
          Go Pro — {interval === 'monthly' ? '$50/mo' : '$500/yr'}
        </button>
      </div>
    </div>
  )
}

export function ManageButton() {
  const [busy, setBusy] = useState(false)
  return (
    <button className="btn btn-ghost" disabled={busy}
      onClick={async () => { setBusy(true); await post('/api/billing/portal'); setBusy(false) }}>
      Manage billing
    </button>
  )
}
```

- [ ] **Step 2: Implement the billing page**

Create `app/src/app/settings/billing/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { getTier, getSubscription } from '@/lib/server/entitlements'
import { UpgradeButtons, ManageButton } from './BillingActions'

const PLAN_LABEL = { free: 'Free', trader: 'Trader', pro: 'Pro Trader' } as const

export default async function BillingPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const tier = await getTier(supabase, user.id)
  const sub = await getSubscription(supabase, user.id)
  const renews = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString()
    : null

  return (
    <main className="ts-page" style={{ maxWidth: 620 }}>
      <p className="eyebrow">Account</p>
      <h1 className="ts-h1 mt-3">Billing</h1>
      <p className="ts-sub">Current plan: <b>{PLAN_LABEL[tier]}</b></p>

      <section className="ts-card mt-7">
        {tier === 'free' ? (
          <>
            <h2 className="ts-h2">Upgrade</h2>
            <p className="ts-sub mb-5">Unlock unlimited journal history, advanced stats and the full learning hub.</p>
            <UpgradeButtons />
          </>
        ) : (
          <>
            <h2 className="ts-h2">Your subscription</h2>
            <p className="ts-sub mb-2">{PLAN_LABEL[tier]} · status {sub?.status}</p>
            {sub?.cancelAtPeriodEnd && renews && (
              <p className="ts-sub mb-2">Cancels on {renews} — access continues until then.</p>
            )}
            {!sub?.cancelAtPeriodEnd && renews && (
              <p className="ts-sub mb-4">Renews {renews}.</p>
            )}
            <ManageButton />
          </>
        )}
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Link from settings**

In `app/src/app/settings/page.tsx`, add a billing card before the Session section (after the "Trading account" `</section>`):

```tsx
      <section className="ts-card mt-5">
        <h2 className="ts-h2">Billing & plan</h2>
        <p className="ts-sub mb-4">View your plan, upgrade, or manage your subscription.</p>
        <a className="btn btn-ghost" href="/settings/billing">Manage plan</a>
      </section>
```

- [ ] **Step 4: Add the toggle CSS**

In `app/src/app/globals.css`, append:

```css
.ts-billing-toggle { display: inline-flex; gap: 4px; background: var(--faintest); border-radius: 10px; padding: 4px; }
.ts-billing-toggle button { border: 0; background: transparent; padding: 6px 14px; border-radius: 8px; font: inherit; color: var(--faint); cursor: pointer; }
.ts-billing-toggle button.active { background: var(--card, #fff); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
```

- [ ] **Step 5: Typecheck + run the page**

Run (from `app/`): `npx tsc --noEmit`
Expected: no errors. With the dev server up, `/settings/billing` renders "Current plan: Free" + upgrade buttons.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/settings/billing/ app/src/app/settings/page.tsx app/src/app/globals.css
git commit -m "feat(billing): /settings/billing page + upgrade/manage actions"
```

---

### Task 9: Enforce journal history cap (Free = 30)

**Files:**
- Modify: `app/src/app/journal/page.tsx`

**Interfaces:**
- Consumes: `getTier` from `@/lib/server/entitlements`; `JOURNAL_FREE_LIMIT`, `can` from `@/lib/entitlements`.

- [ ] **Step 1: Gate the visible trade list**

In `app/src/app/journal/page.tsx`, after `const user = await getSessionUser(...)` block and the trades query, compute tier and cap the list passed to `RecentTrades` (analytics still use the full set). Add imports at top:

```tsx
import { getTier } from '@/lib/server/entitlements'
import { JOURNAL_FREE_LIMIT, can } from '@/lib/entitlements'
```

After `const trades = (all ?? []) as JTrade[]`:

```tsx
  const tier = await getTier(supabase, user.id)
  const unlimited = can(tier, 'journal_unlimited')
  const visibleTrades = unlimited ? trades : trades.slice(0, JOURNAL_FREE_LIMIT)
  const hiddenCount = trades.length - visibleTrades.length
```

Change the Recent Trades block to use `visibleTrades` and add a nudge:

```tsx
      <div className="mt-5">
        <RecentTrades trades={visibleTrades} monthNet={sums.monthNet} />
        {hiddenCount > 0 && (
          <div className="ts-banner mt-3">
            Showing your last {JOURNAL_FREE_LIMIT} trades. {hiddenCount} older{' '}
            {hiddenCount === 1 ? 'trade is' : 'trades are'} hidden on Free — nothing is deleted.{' '}
            <a href="/settings/billing" style={{ color: 'var(--violet-br)', fontWeight: 700 }}>Upgrade</a>{' '}
            to see your full history.
          </div>
        )}
      </div>
```

- [ ] **Step 2: Typecheck**

Run (from `app/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/journal/page.tsx
git commit -m "feat(billing): cap journal history to 30 on Free (hide, not delete)"
```

---

### Task 10: Gate advanced stats on the dashboard

**Files:**
- Modify: `app/src/app/journal/page.tsx`
- Modify: `app/src/app/journal/_components/StatCards.tsx`

**Interfaces:**
- Consumes: `can`, `tier` (already computed in Task 9).

- [ ] **Step 1: Inspect StatCards to find the advanced metrics**

Read `app/src/app/journal/_components/StatCards.tsx`. Identify the cards showing win rate, R:R, and profit factor (the "advanced stats" per the pricing page). Add an `advanced: boolean` prop; when `false`, render those specific cards as a locked tile linking to `/settings/billing` instead of the value.

- [ ] **Step 2: Pass the flag from the page**

In `app/src/app/journal/page.tsx`, update the StatCards usage:

```tsx
        <StatCards metrics={metrics} allTime={sums.allTime} monthNet={sums.monthNet} monthLabel={monthLabel} weekTrades={sums.weekTrades} advanced={can(tier, 'advanced_stats')} />
```

- [ ] **Step 3: Implement the lock in StatCards**

In `StatCards.tsx`, add `advanced` to the props type (default `true` for callers that don't pass it), and wrap the win-rate / R:R / profit-factor card values:

```tsx
// when !advanced, render this in place of the metric value:
<a href="/settings/billing" className="ts-stat-locked">🔒 Trader</a>
```

Add CSS to `globals.css`:

```css
.ts-stat-locked { font-size: 13px; font-weight: 700; color: var(--violet-br); text-decoration: none; }
```

- [ ] **Step 4: Typecheck**

Run (from `app/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/journal/page.tsx app/src/app/journal/_components/StatCards.tsx app/src/app/globals.css
git commit -m "feat(billing): gate advanced stats (win rate/R:R/profit factor) behind Trader"
```

---

### Task 11: Gate learning hub by `min_tier` + admin selector

**Files:**
- Modify: `app/src/lib/server/learning.ts` (carry `min_tier`)
- Modify: `app/src/app/learn/page.tsx` (lock courses above tier)
- Modify: `app/src/app/learn/[course]/[lesson]/page.tsx` (block locked lesson access)
- Modify: admin course editor (`app/src/app/admin/courses/[courseId]/page.tsx` + its action) to set `min_tier`

**Interfaces:**
- Consumes: `getTier`; `TIER_RANK`, `type Tier` from `@/lib/entitlements`.

- [ ] **Step 1: Carry `min_tier` through the course reads**

In `app/src/lib/server/learning.ts`:
- Add `minTier: string` to `CourseCard`; select `min_tier` in `getCourses` and map it (`minTier: c.min_tier ?? 'free'`).
- In `getLessonForViewer`, also select the course's `min_tier` and return it on `LessonView` as `minTier: string`.

- [ ] **Step 2: Lock courses on the learn index**

In `app/src/app/learn/page.tsx`, fetch tier and mark locked courses:

```tsx
import { getTier } from '@/lib/server/entitlements'
import { TIER_RANK, type Tier } from '@/lib/entitlements'
// ...
const tier = await getTier(supabase, user.id)
// for each course card, locked = TIER_RANK[tier] < TIER_RANK[(c.minTier as Tier) ?? 'free']
```

Render locked course cards with a "🔒 Trader" / "🔒 Pro" badge linking to `/settings/billing` instead of the normal course link.

- [ ] **Step 3: Block locked lesson access server-side**

In `app/src/app/learn/[course]/[lesson]/page.tsx`, after loading the lesson and resolving tier:

```tsx
import { getTier } from '@/lib/server/entitlements'
import { TIER_RANK, type Tier } from '@/lib/entitlements'
// ...
const tier = await getTier(supabase, user.id)
if (TIER_RANK[tier] < TIER_RANK[(lesson.minTier as Tier) ?? 'free']) {
  redirect('/settings/billing')
}
```

- [ ] **Step 4: Admin `min_tier` selector**

In the admin course editor page + its update action (`app/src/app/admin/courses/[courseId]/page.tsx` and the corresponding `actions`), add a `min_tier` `<select>` (free/trader/pro) to the course form and persist `min_tier` in the update (validate value ∈ {free,trader,pro}).

- [ ] **Step 5: Typecheck**

Run (from `app/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/server/learning.ts app/src/app/learn app/src/app/admin/courses
git commit -m "feat(billing): gate learning hub courses by min_tier + admin selector"
```

---

### Task 12: Pro badge on profile + nav

**Files:**
- Modify: `app/src/app/[username]/page.tsx` (public profile header)
- Modify: the nav/brand component (locate via `app/src/app/_components/`)

**Interfaces:**
- Consumes: `getTier`; `can` (`'pro_badge'`).

- [ ] **Step 1: Compute viewed user's tier on the profile**

In `app/src/app/[username]/page.tsx`, after resolving the profile's user id, compute `const proBadge = can(await getTier(supabase, profileUserId), 'pro_badge')` and render a "PRO" pill next to the display name when true. (Note: `subscriptions` RLS is owner-only select — for cross-viewer profiles, read the badge via the service client or add a public `is_pro` projection. Use the service client read here to avoid RLS issues, returning only the boolean.)

- [ ] **Step 2: Nav badge for the signed-in Pro user**

In the nav component, when the signed-in user's tier is `pro`, render a small "PRO" chip; for `free`, render an "Upgrade" pill linking to `/settings/billing`.

- [ ] **Step 3: Add badge CSS**

In `globals.css`:

```css
.ts-pro-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: 0.04em; color: #fff; background: var(--brand-grad); }
```

- [ ] **Step 4: Typecheck**

Run (from `app/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/[username]/page.tsx app/src/app/_components app/src/app/globals.css
git commit -m "feat(billing): Pro badge on profile + nav upgrade pill"
```

---

### Task 13: End-to-end billing test

**Files:**
- Create: `app/tests/e2e/billing.spec.ts`

**Interfaces:**
- Consumes: the full flow. Requires test-mode env vars set and `stripe listen` forwarding to the dev server.

- [ ] **Step 1: Write the e2e spec**

Create `app/tests/e2e/billing.spec.ts` (follow the existing e2e signup helper pattern; usernames ≤ 20 chars; routes are at root — `/signup`, `/settings/billing`, NOT `/app/*`):

```ts
import { test, expect } from '@playwright/test'

// Assumes Stripe test mode + `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
test('free user sees billing page and journal cap nudge', async ({ page }) => {
  // signup helper (mirror existing specs) -> lands authenticated
  // ... create account ...
  await page.goto('/settings/billing')
  await expect(page.getByText('Current plan:')).toContainText('Free')
  await expect(page.getByRole('button', { name: /Upgrade to Trader/ })).toBeVisible()
})

test('checkout with test card upgrades to Trader', async ({ page }) => {
  // ... signup ...
  await page.goto('/settings/billing')
  await page.getByRole('button', { name: /Upgrade to Trader/ }).click()
  // Stripe-hosted checkout:
  await page.fill('input[name="cardNumber"]', '4242424242424242')
  await page.fill('input[name="cardExpiry"]', '12 / 34')
  await page.fill('input[name="cardCvc"]', '123')
  // fill name/postal as required, submit
  await page.getByTestId('hosted-payment-submit-button').click()
  await page.waitForURL(/\/settings\/billing\?status=success/)
  // webhook lands async; reload until tier flips
  await expect(async () => {
    await page.reload()
    await expect(page.getByText('Current plan:')).toContainText('Trader')
  }).toPass({ timeout: 15_000 })
})
```

- [ ] **Step 2: Run e2e (warm server first)**

Run (from `app/`): start dev server, run `stripe listen --forward-to localhost:3000/api/stripe/webhook` in another shell, then `npm run test:e2e -- billing`.
Expected: both tests PASS. (Stripe-hosted field selectors may need adjustment to the current Checkout DOM — fix selectors until green.)

- [ ] **Step 3: Commit**

```bash
git add app/tests/e2e/billing.spec.ts
git commit -m "test(billing): e2e checkout + cap nudge"
```

---

## Self-Review

**Spec coverage:**
- §5 data model → Task 2 ✓
- §6 Stripe config / env → Tasks 1, 6 (env consumed), documented in plan header ✓
- §7a entitlements.ts → Task 3 ✓; §7b server/entitlements → Task 4 ✓; §7c stripe.ts → Task 1 ✓
- §7d checkout/portal/webhook → Tasks 6, 7, 5 ✓
- §7e /settings/billing → Task 8 ✓
- §7f enforcement: journal cap → Task 9; advanced stats → Task 10; learning → Task 11; Pro badge → Task 12 ✓
- §8 error handling → checkout/portal 401/400/500 (T6/7), webhook 400/200/fail-closed getTier (T4/5) ✓
- §9 testing → Tasks 3,5 unit; Task 13 e2e ✓
- §10 security → service-role-only writes (T2 RLS), fail-closed (T4), server-only secrets (T1) ✓
- §11 rollout → header + Task 2 apply step ✓

**Placeholder scan:** Tasks 10, 11, 12 reference components whose internals are read at execution time (StatCards cards, nav component, admin course form) rather than pasted verbatim — these are "inspect then modify existing UI" steps with the exact change specified; acceptable since the surrounding files exist and the edit is precisely described. All pure-logic and route tasks have complete code.

**Type consistency:** `Tier`, `Interval`, `PlanEnv`, `planForPrice`/`priceForPlan`, `tierFromSubscriptions`, `subscriptionRow`, `getTier`/`getSubscription`/`CurrentSub` names match across Tasks 3–12. Webhook passes `process.env` as `PlanEnv` (structural match). ✓
