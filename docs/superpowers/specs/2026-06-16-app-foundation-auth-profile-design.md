# TradingSocial App — Phase 0+1: Foundation, Auth & Profile

**Date:** 2026-06-16
**Status:** Approved (design)
**Scope:** First slice of the Bubble.io → self-hosted migration. Stands up the Next.js app at `/app/`, authentication, onboarding, and the public trader profile. All later features (journal, social, leaderboard, XP, learning hub, ops) are separate specs.

---

## 1. Context & Goals

TradingSocial is a social trading-journal platform currently built in Bubble.io. We are migrating to a self-hosted stack and rebuilding the MVP fresh (no Bubble data migration).

**Confirmed decisions:**
- **Data:** Fresh start. No migration of users/trades from Bubble.
- **Infra:** Managed cloud — Next.js on Vercel, Supabase Cloud (Postgres + Auth), Cloudflare R2 (file storage).
- **Coexistence:** Existing static marketing site keeps owning the root domain. The Next.js app serves only `/app/*`.
- **Phasing:** Foundation first. This spec = Phase 0 (scaffold/infra) + Phase 1 (auth + onboarding + profile).

**Phase goal:** A visitor can sign up (email/password or Google), complete onboarding, land in the app, and have a public profile page reachable at `/app/<username>`.

---

## 2. Overall Migration Decomposition (reference)

Each phase is its own spec → plan → build cycle.

- **Phase 0 — Foundation/infra** (this spec)
- **Phase 1 — Auth + Onboarding + Profile** (this spec)
- **Phase 2 — Journal** — trade CRUD, metrics, mistake/strategy tags, public/private, R2 screenshots, personal stats dashboard.
- **Phase 3 — Social** — follow, newsfeed (the logged-in "home" dashboard).
- **Phase 4 — Leaderboard** — 3–5 categories.
- **Phase 5 — XP system** — earn rules, levels, badges.
- **Phase 6 — Learning Hub** — 3 starter courses, lessons, quizzes, progress.
- **Phase 7 — Ops** — admin dashboard, feedback, bug reporting, analytics, legal pages.

---

## 3. Architecture

### 3.1 App shell
- **Next.js (App Router) + TypeScript + Tailwind CSS**, located in the existing `app/` directory of this repo.
- `next.config` sets `basePath: '/app'` so every route is served under `/app/*`.
- Deployed as its **own Vercel project** (e.g. `tradingsocial-app`), separate from the static marketing site.
- Design tokens (colors, type, spacing) extracted from the Bubble page exports already placed in `app/` (`TradingSocial *.html`). Those exports are visual reference only — not ported markup.

### 3.2 Routing the subpath
The static marketing site owns the root domain (`tradingsocial.io`). Its `vercel.json` gets a rewrite so the subpath proxies to the app deployment:

```json
{ "source": "/app/:path*", "destination": "https://<app-deployment-host>/app/:path*" }
```

Result: one URL surface, two deployments. (Alternative considered: single unified Next app serving marketing too — rejected for this phase to avoid rewriting the working marketing site.)

### 3.3 Auth integration
- **Supabase Auth** via `@supabase/ssr` — cookie-based sessions usable from server components.
- A **Next.js middleware** refreshes the Supabase session on each request and enforces guards (see §6).
- Three Supabase client factories: browser client, server client (reads cookies), and a service-role client (server-only, never exposed) for privileged operations.

### 3.4 File storage
- Cloudflare **R2** via the S3-compatible API (AWS S3 SDK). Used in this phase only for **avatar uploads**.
- Upload path: client requests a **presigned PUT URL** from a server route handler; uploads directly to R2; the resulting public object URL is saved to `profiles.avatar_url`.

---

## 4. Data Model (Supabase / Postgres)

### 4.1 `auth.users`
Managed by Supabase. Holds email, password hash, OAuth identities.

### 4.2 `public.profiles`
One row per user.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | FK → `auth.users.id`, on delete cascade |
| `username` | citext UNIQUE NOT NULL | case-insensitive; format-validated; reserved list enforced |
| `display_name` | text | optional friendly name |
| `bio` | text | optional |
| `avatar_url` | text | R2 public URL, nullable |
| `experience_level` | enum `experience_level` | `beginner` \| `intermediate` \| `advanced` |
| `main_markets` | text[] | subset of forex/crypto/stocks/indices/commodities |
| `trading_styles` | text[] | subset of the style list (scalper, day trader, swing, position, investor, algo, SMC/ICT, technical, fundamental, momentum, mean reversion, trend following) |
| `goal` | text | free text or preset; from onboarding |
| `is_public` | boolean NOT NULL DEFAULT true | visibility |
| `onboarding_completed` | boolean NOT NULL DEFAULT false | gates the app |
| `xp` | integer NOT NULL DEFAULT 0 | placeholder; wired in Phase 5 |
| `level` | integer NOT NULL DEFAULT 1 | placeholder; wired in Phase 5 |
| `created_at` | timestamptz DEFAULT now() | |
| `updated_at` | timestamptz DEFAULT now() | trigger-maintained |

Enums created via migration. `main_markets` / `trading_styles` kept as `text[]` (validated app-side) for flexibility; can be normalized later if needed.

### 4.3 `handle_new_user` trigger
A `security definer` function fires on `auth.users` INSERT and creates the matching `profiles` row, pulling `username` from the signup metadata when present (email/password signup). For Google signups, no username exists yet → row is created with a temporary placeholder and `onboarding_completed = false`; onboarding step 0 forces username selection.

### 4.4 Reserved usernames
A constant list (in code, mirrored by a DB check or unique seed) blocks usernames that collide with routes or are abusive: `app, login, signup, logout, onboarding, settings, auth, api, admin, journal, leaderboard, feed, home, profile, u, static, _next, assets`. Validation runs at signup and at any username change.

---

## 5. Auth & Onboarding Flow

### 5.1 Signup (kept short per launch doc)
Fields: **username, email, password** (+ **Google** button), **terms & financial-disclaimer** checkbox (required). Nothing else — experience/markets/style/goal/visibility are collected in onboarding to avoid a long form.

- Email/password: create user with username in metadata → trigger creates profile → session established → redirect to `/app/onboarding`.
- **Immediate access** (no email-confirmation gate). A "verify your email" nag is shown until confirmed; full email-verification enforcement is deferred.

### 5.2 Google OAuth
- Google credentials already exist; configured in the Supabase dashboard (not in app env).
- Flow: Google button → Supabase OAuth → redirect to `/app/auth/callback` (route handler exchanges the code for a session) → if `onboarding_completed = false`, redirect to `/app/onboarding`.

### 5.3 Onboarding
Steps (single multi-step page):
0. **Username** — only if missing (Google signups); validated against format + reserved list + uniqueness.
1. **What do you trade?** → `main_markets`.
2. **Experience level?** → `experience_level`.
3. **Main goal?** → `goal`.
4. **Trading style(s)?** → `trading_styles` (optional, multi-select).
5. **Public or private profile?** → `is_public` (default public).
6. *(Optional)* avatar upload → R2.

On completion: set `onboarding_completed = true`, redirect to `/app`.

### 5.4 Login / logout
- `/app/login` — email/password + Google. On success → `/app` (or `/app/onboarding` if incomplete).
- Logout clears the Supabase session cookie.

---

## 6. Routes & Guards

| Route | Purpose | Access |
|---|---|---|
| `/app` | Placeholder home / landing after login (real newsfeed = Phase 3) | authed |
| `/app/login` | Login | public; redirect to `/app` if authed |
| `/app/signup` | Signup | public; redirect to `/app` if authed |
| `/app/auth/callback` | OAuth code exchange | public |
| `/app/onboarding` | Onboarding wizard | authed |
| `/app/settings` | Edit profile (display name, bio, markets, styles, goal, visibility, avatar) | authed, own profile |
| `/app/[username]` | Public profile page | public if `is_public`, else 404 |

**Middleware guards:**
- Unauthed access to authed routes → redirect to `/app/login`.
- Authed user with `onboarding_completed = false` accessing anything but `/app/onboarding` (or `/app/auth/*`) → redirect to `/app/onboarding`.
- `/app/[username]` is matched **after** all static routes; the reserved-username list prevents collisions.

---

## 7. Security (RLS)

RLS enabled on `profiles`:
- **SELECT:** allowed when `is_public = true` OR `auth.uid() = id`.
- **UPDATE:** allowed only when `auth.uid() = id`. Username changes additionally re-validated (format + reserved) at the app layer.
- **INSERT:** via the `handle_new_user` trigger only (no direct client insert).
- **DELETE:** not exposed to clients in this phase.

Consequences:
- A private profile returns **404** to anonymous users and other users (page treats RLS-empty result as not-found, not "forbidden", to avoid leaking existence).
- Service-role key is server-only and never shipped to the browser.

Other:
- Terms/disclaimer acceptance recorded at signup.
- Presigned R2 URLs are short-lived and scoped to a single object key derived from the user id.

---

## 8. Public Profile Page (the "trader resume")

Phase-1 content, with clearly-marked placeholders for later phases:
- **Now:** username, display name, avatar, bio, experience level, main markets, trading styles, join date.
- **Placeholder → Phase 5:** XP / level (shows 0 / Level 1).
- **Placeholder → Phase 3:** followers / following counts (show 0).
- **Placeholder → Phase 2:** journal stats block ("No trades logged yet").

Private profile (viewed by non-owner) → 404.

---

## 9. Error Handling

- Form validation (client + server): required fields, email format, password strength, username format, terms unchecked.
- **Duplicate username/email** → friendly inline error.
- **OAuth callback failure** → redirect to `/app/login?error=oauth`.
- **RLS denial / private profile** → 404 page.
- **R2 upload failure** → onboarding/settings surfaces a retryable error; avatar is optional so flow can continue.

---

## 10. Environment & Secrets

App env (Vercel project):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser-safe.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only.
- R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`.

Google OAuth client ID/secret live in the **Supabase dashboard**, not in app env.

---

## 11. Testing

New test stack for the app (separate from the marketing site's Jest):
- **Vitest (unit):** username validation (format + reserved list), profile field mapping from onboarding, RLS-result → 404 logic.
- **Playwright (e2e):** signup → onboarding → profile happy path; login; logout; private-profile hidden from anon (404); onboarding redirect guard.

---

## 12. Out of Scope (this phase)

Trades / journal, follow / newsfeed, leaderboard, real XP earning, courses, admin / feedback / bug-reporting / analytics, full email-verification enforcement, messaging. Each is a later phase.

---

## 13. Deliverables Checklist

- [ ] Next.js + Tailwind scaffold in `app/` with `basePath: '/app'`.
- [ ] Root `vercel.json` rewrite for `/app/:path*`.
- [ ] Supabase project + migrations: `profiles`, enums, trigger, RLS.
- [ ] Supabase client factories (browser/server/service) + session middleware.
- [ ] Signup, login, logout, Google OAuth callback.
- [ ] Onboarding wizard.
- [ ] Settings (profile edit) + R2 avatar upload.
- [ ] Public profile page at `/app/[username]` with placeholders.
- [ ] Reserved-username enforcement.
- [ ] Vitest + Playwright suites.
