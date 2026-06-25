# Stripe Billing & Tier Entitlements — Design

**Date:** 2026-06-25
**Status:** Approved, pending implementation plan
**Scope:** Phase 8 — paid subscriptions (Trader, Pro Trader) + tier-based feature entitlements for the TradingSocial app.

## 1. Goal

Add Stripe subscription billing to the migrated Next.js/Supabase app and gate
app features by plan tier per the marketing pricing page (`/pricing`).

Three tiers already advertised:

| Tier  | Monthly | Annual         |
|-------|---------|----------------|
| Free  | $0      | $0             |
| Trader| $30/mo  | $300/yr ($25/mo) |
| Pro   | $50/mo  | $500/yr ($42/mo) |

Free needs no Stripe object — it is the absence of an active paid subscription.

Build entirely against **Stripe test mode**. Flip to live keys at launch with
zero code change (env-var swap only).

## 2. Non-goals (v1)

- No dev/prod database split (single Supabase project, decided 2026-06-25).
- No building of not-yet-existing paid features (strategy tracking, mistake
  tagging, reports, AI insights, etc.). Their entitlements are wired in the
  feature map but enforced only when the feature ships.
- No proration UI, no coupons/promo codes, no usage-based billing, no tax
  automation beyond Stripe defaults.
- Marketing `pricing.html` CTAs stay as the signup funnel (`/signup`); they are
  not wired directly to Checkout.

## 3. Feature gate matrix — reality check

Pricing table lists ~30 line items. They split two ways.

### 3a. Real & enforceable in v1 (features that exist today)

| Gate | Free | Trader+ | Where enforced |
|------|------|---------|----------------|
| Journal history | last 30 trades | unlimited | `journal/page.tsx` trades query + `RecentTrades` + profile trade list |
| Advanced stats (win rate · R:R · profit factor) + "Full" dashboard | hidden/Basic | shown | `StatCards` / journal dashboard blocks |
| Learning hub access | beginner only | intermediate (Trader), +premium (Pro) | `learn` routes, gated by `courses.min_tier` |
| Pro badge on profile + nav | — | Pro only (cosmetic) | profile header + nav |

Downgrade behavior (per pricing FAQ): data is **never deleted** — trades beyond
the Free cap are **hidden**, restored on re-upgrade. The 30-cap is a
read/render limit, not a delete.

### 3b. Wired-but-not-enforced (features not built yet)

strategy tracking, multi-strategy, mistake tagging (`mistakeTags` currently
hardcoded `[]`), risk management tracking, private journal notes, custom
templates, export/downloadable reports, weekly performance review, strategy
performance breakdown, advanced reporting, monthly trader report, AI journal
insights, advanced leaderboard filters, leaderboard placement options, premium
challenges, save/favourite traders, creator-style profile, premium courses &
psychology modules, XP boosts for learning streaks, priority/early access &
support (operational, not code).

These get entries in `FEATURE_MIN_TIER` so `can(tier, feature)` is ready, but
there is no UI to gate until each feature is built. Gating goes in with the
feature.

## 4. Architecture

Tier source of truth = **Stripe**, mirrored into Supabase by webhook
(approach A). `getTier()` reads the local mirror — fast, offline-resilient,
keeps full subscription metadata (status, period end, cancel-at-period-end).

Mirrors the existing admin pattern: a pure module (`entitlements.ts`, like
`admin.ts`) + a server gate module (`server/entitlements.ts`, like
`server/admin.ts`).

```
Stripe (test mode)
  │  4 prices: trader_monthly, trader_annual, pro_monthly, pro_annual
  ▼
POST /api/billing/checkout ──► Stripe Checkout (hosted) ──► success redirect
  │                                                              │
  └─ ensure customer (create + store profiles.stripe_customer_id)│
                                                                 ▼
POST /api/stripe/webhook  ◄──────────────── checkout.session.completed,
  │  verify sig on raw body                  customer.subscription.*
  │  service-role client
  ▼
public.subscriptions (mirror)
  ▲
  │ getTier(userId) = highest-ranked active sub tier, else 'free'
  │
  ├─ journal history cap / advanced stats / learn routes / Pro badge
  └─ /settings/billing (current plan, upgrade, manage)

POST /api/billing/portal ──► Stripe Billing Portal (upgrade/downgrade/cancel/card)
```

## 5. Data model — migration `0009_billing`

```sql
-- 1. Stripe customer id on profile (1:1, nullable until first checkout)
alter table public.profiles
  add column if not exists stripe_customer_id text unique;

-- 2. Tier gate for learning content
alter table public.courses
  add column if not exists min_tier text not null default 'free';
-- 'free' | 'trader' | 'pro'

-- 3. Subscription mirror (written ONLY by webhook via service role)
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
-- Owner may read own subscription; NO insert/update/delete policy -> only
-- service role (webhook) writes. Mirrors lesson_completions.
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();
```

Migration applied to Supabase Cloud manually (dashboard SQL editor /
`supabase db push`), consistent with prior phases.

**Effective tier rule:** a user's tier = highest-ranked tier among their
subscriptions whose `status in ('active','trialing')`, else `'free'`.
`past_due` is treated as **not entitled** in v1 (simple; revisit with a grace
window later).

## 6. Stripe configuration (manual, test mode)

Create in Stripe dashboard (test mode):
- Product **Trader** → price `trader_monthly` ($30/mo), price `trader_annual` ($300/yr)
- Product **Pro Trader** → price `pro_monthly` ($50/mo), price `pro_annual` ($500/yr)

Map the 4 price IDs into env. A reverse map `PRICE_TO_PLAN` in
`entitlements.ts` resolves `price_id -> { tier, interval }` — the webhook uses
it to set `subscriptions.tier`.

### Env vars (app Vercel project + `.env.local`)

| Var | Example | Notes |
|-----|---------|-------|
| `STRIPE_SECRET_KEY` | `sk_test_...` | server only |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | per webhook endpoint |
| `STRIPE_PRICE_TRADER_MONTHLY` | `price_...` | |
| `STRIPE_PRICE_TRADER_ANNUAL` | `price_...` | |
| `STRIPE_PRICE_PRO_MONTHLY` | `price_...` | |
| `STRIPE_PRICE_PRO_ANNUAL` | `price_...` | |

No publishable key needed — Checkout & Portal use server-created hosted
sessions; the client only follows the returned `url`.

## 7. Code modules

### 7a. `lib/entitlements.ts` (pure, unit-tested)
- `export type Tier = 'free' | 'trader' | 'pro'`
- `TIER_RANK: Record<Tier, number>` (free 0, trader 1, pro 2)
- `PRICE_TO_PLAN`: maps the 4 env price IDs → `{ tier, interval }`
  (reads `process.env`; pure given env)
- `tierFromStatuses(subs)`: highest active/trialing tier, else `free`
- `FEATURE_MIN_TIER: Record<Feature, Tier>` — full pricing matrix (3a + 3b)
- `can(tier, feature): boolean` = `TIER_RANK[tier] >= TIER_RANK[FEATURE_MIN_TIER[feature]]`
- `JOURNAL_FREE_LIMIT = 30`

### 7b. `lib/server/entitlements.ts` (`server-only`)
- `getTier(supabase, userId): Promise<Tier>` — query `subscriptions`, apply
  `tierFromStatuses`
- `requireTier(supabase, userId, min): Promise<void>` — `notFound()`/redirect
  if below `min` (for gated routes)
- `getSubscription(supabase, userId)` — current row for the billing page

### 7c. Stripe client `lib/stripe.ts`
- Lazy singleton `stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)`, pinned
  API version. Server-only.

### 7d. Routes
- `POST /api/billing/checkout` — body `{ tier, interval }`. Auth via
  `getUser()`. Ensure customer: if `profiles.stripe_customer_id` null, create
  Stripe customer (email + `metadata.user_id`), store id. Create Checkout
  Session: `mode: 'subscription'`, `customer`, `line_items: [{ price, qty 1 }]`,
  `success_url=/settings/billing?status=success`, `cancel_url=/settings/billing`,
  `client_reference_id=user.id`. Return `{ url }`.
- `POST /api/billing/portal` — Billing Portal session for the customer,
  `return_url=/settings/billing`. Return `{ url }`.
- `POST /api/stripe/webhook` — read **raw body** (`await req.text()`), verify
  with `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)`.
  Handle:
  - `checkout.session.completed` — retrieve subscription, upsert mirror.
  - `customer.subscription.created | updated | deleted` — upsert/mark mirror;
    `deleted` sets `status='canceled'`.
  Resolve `user_id` from `customer` (lookup `profiles.stripe_customer_id`) or
  `client_reference_id`. Idempotent: upsert keyed on subscription `id`. Uses
  service-role client (`lib/supabase/service.ts`). Route opts out of body
  parsing / runs on Node runtime so the raw body signature verifies.

### 7e. UI — `/settings/billing`
- Server component: `getTier` + `getSubscription`.
- Shows current plan, renewal date / "cancels on" when
  `cancel_at_period_end`.
- Free users: Trader & Pro upgrade cards with monthly/annual toggle → POST to
  checkout, redirect to `url`.
- Paid users: "Manage billing" → POST portal, redirect (handles upgrade,
  downgrade, cancel, card update — covers pricing FAQ "change or cancel
  anytime").
- Link into it from `/settings` and (optionally) a nav "Upgrade" pill for Free
  users.

### 7f. Enforcement points
- **Journal history cap**: in `journal/page.tsx` and profile trade list, if
  tier is free, slice/limit to `JOURNAL_FREE_LIMIT` most-recent and render a
  "Showing last 30 — upgrade to see your full history (nothing is deleted)"
  nudge. Stats that need full history still compute server-side; only the
  *list* is capped (matches "history" wording, not "stats").
  *(Open question resolved: cap the visible trade list, not the analytics —
  advanced analytics is separately gated below.)*
- **Advanced stats**: gate the advanced `StatCards`/dashboard blocks behind
  `can(tier, 'advanced_stats')`; Free sees Basic set + upgrade nudge.
- **Learning**: `learn` route + lesson loader check
  `TIER_RANK[tier] >= TIER_RANK[course.min_tier]`; locked courses show an
  upgrade card instead of content. Admin course editor gets a `min_tier`
  selector.
- **Pro badge**: profile header + nav read tier, render badge when `pro`.

## 8. Error handling
- Checkout/portal routes: 401 if unauthenticated, 400 on bad tier/interval,
  500 with logged Stripe error otherwise; client shows a toast and stays put.
- Webhook: 400 on signature failure (Stripe retries); 200 after successful
  upsert; unhandled event types → 200 ignore. All writes idempotent so Stripe
  retries are safe.
- Missing/unknown `price_id` in webhook → log + 200 (don't 500-loop Stripe);
  surfaced via logs.
- `getTier` on DB error → default `free` (fail closed: never grant paid access
  on error).

## 9. Testing
- **vitest**: `entitlements.test.ts` — `can()` matrix, `tierFromStatuses`
  (active/trialing/past_due/canceled/mixed), `PRICE_TO_PLAN` resolution,
  free-limit constant. Webhook tier-mapping unit (pure mapper extracted from
  the route).
- **e2e (Playwright)**: signup → `/settings/billing` → Checkout with test card
  `4242 4242 4242 4242` → success → tier reflects Trader; portal opens; Free
  user sees 30-cap nudge + locked intermediate course. Use Stripe test mode;
  warm dev server before e2e (cold-compile busts 5s timeouts, per house rule).
- **Local webhooks**: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
  to exercise the mirror without deploying.
- Fail-closed assertion: simulate DB error path → tier resolves `free`.

## 10. Security notes
- Webhook signature verified on raw body before any DB write; service-role
  client used only inside the verified handler.
- `subscriptions` has no client write policy — users cannot self-grant a tier
  (same guarantee as `lesson_completions` / XP).
- Secret key + webhook secret server-only; never `NEXT_PUBLIC_`.
- `getTier` fails closed to `free`.
- Stripe customer creation stores `metadata.user_id` so webhook can always
  resolve the owner even if `client_reference_id` is absent.

## 11. Rollout
1. Apply migration `0009_billing` to Supabase Cloud.
2. Create test-mode products/prices; set env vars in `.env.local` + Vercel app
   project; add webhook endpoint in Stripe (test) → copy `whsec_`.
3. Build + test (vitest + e2e + `stripe listen`).
4. Merge to `main`; push (explicit user auth per house rule).
5. At launch: create live-mode products, swap to `sk_live`/live price IDs +
   live webhook secret in Vercel production env. No code change.

## 12. Open questions
None blocking. Deferred: `past_due` grace window, annual proration messaging,
promo codes — all post-v1.
