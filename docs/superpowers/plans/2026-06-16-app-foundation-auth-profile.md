# App Foundation, Auth & Profile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the TradingSocial Next.js app at `/app/` with Supabase auth (email/password + Google), onboarding, and a public trader profile page — the foundation for all later phases.

**Architecture:** A standalone Next.js (App Router) project living in the repo's `app/` directory with `basePath: '/app'`, deployed as a second Vercel project from the same repo. Supabase Cloud provides Postgres + Auth (cookie sessions via `@supabase/ssr`); Cloudflare R2 stores avatars. The existing static marketing site keeps the root domain and rewrites `/app/*` to the app deployment.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Tailwind CSS, `@supabase/ssr` + `@supabase/supabase-js`, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (R2), Vitest (unit), Playwright (e2e).

---

## Conventions

- **basePath:** All in-app route paths in code are written WITHOUT the `/app` prefix (e.g. `redirect('/login')`). Next.js prepends `/app` automatically. In middleware, `request.nextUrl.pathname` is the path WITHOUT basePath.
- **Supabase cookie rule:** Use ONLY `getAll`/`setAll`. Never `get`/`set`/`remove`. Never import `@supabase/auth-helpers-nextjs`.
- **Commands run from `app/`** unless stated. The app project's Vercel Root Directory is `app/`.
- **Commit after every task.** Conventional Commit messages.

---

## File Structure

```
app/                                  # Next.js project root (Vercel Root Directory)
  package.json
  next.config.ts                      # basePath '/app'
  tsconfig.json
  postcss.config.mjs
  tailwind.config.ts
  vitest.config.ts
  playwright.config.ts
  .env.local                          # local secrets (gitignored)
  .env.example                        # documented placeholders (committed)
  middleware.ts                       # session refresh + route guards
  src/
    lib/
      supabase/
        client.ts                     # browser client
        server.ts                     # server client (RSC/actions)
        service.ts                    # service-role client (server-only)
      r2.ts                           # R2 S3 client + presign helper
      username.ts                     # validation + reserved list (pure, unit-tested)
      profile.ts                      # profile types + onboarding->row mapping
    app/                              # App Router routes
      layout.tsx                      # root layout + Tailwind
      globals.css
      page.tsx                        # /app  placeholder home (authed)
      login/page.tsx                  # /app/login
      signup/page.tsx                 # /app/signup
      onboarding/page.tsx             # /app/onboarding (client wizard)
      settings/page.tsx               # /app/settings
      auth/
        callback/route.ts             # OAuth code exchange
        signout/route.ts              # logout
      actions/
        auth.ts                       # signUp/signIn server actions
        profile.ts                    # saveOnboarding/updateProfile actions
        avatar.ts                     # presign server action
      [username]/page.tsx             # public profile (catch-all after static)
  supabase/
    migrations/
      0001_profiles.sql               # enums, profiles, trigger, RLS
  tests/
    unit/username.test.ts
    unit/profile.test.ts
    e2e/auth.spec.ts
vercel.json                           # (repo root) marketing rewrite to /app/*
```

---

## Task 1: Scaffold Next.js app

**Files:**
- Create: `app/package.json`, `app/next.config.ts`, `app/tsconfig.json`, `app/postcss.config.mjs`, `app/tailwind.config.ts`, `app/src/app/layout.tsx`, `app/src/app/globals.css`, `app/src/app/page.tsx`, `app/.gitignore`, `app/.env.example`

- [ ] **Step 1: Initialize project and install deps**

The `app/` dir contains reference `.html` exports — leave them; they are not part of the build. Run from repo root:

```bash
cd app
npm init -y
npm install next@15 react@19 react-dom@19 @supabase/ssr @supabase/supabase-js @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm install -D typescript @types/node @types/react @types/react-dom tailwindcss @tailwindcss/postcss postcss vitest @vitejs/plugin-react @playwright/test
```

- [ ] **Step 2: Write `app/package.json` scripts**

Replace the `scripts` block:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 3: Write `app/next.config.ts`**

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  basePath: '/app',
  reactStrictMode: true,
}

export default nextConfig
```

- [ ] **Step 4: Write `app/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Write Tailwind config + PostCSS**

`app/postcss.config.mjs`:

```js
export default { plugins: { '@tailwindcss/postcss': {} } }
```

`app/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
} satisfies Config
```

`app/src/app/globals.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 6: Write root layout and placeholder home**

`app/src/app/layout.tsx`:

```tsx
import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'TradingSocial' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

`app/src/app/page.tsx` (temporary; real home is Phase 3):

```tsx
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">TradingSocial</h1>
      <p className="mt-2 text-gray-600">You are logged in. Newsfeed coming soon.</p>
    </main>
  )
}
```

- [ ] **Step 7: Write `app/.gitignore` and `app/.env.example`**

`app/.gitignore`:

```
node_modules
.next
.env.local
playwright-report
test-results
```

`app/.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=
```

- [ ] **Step 8: Verify build runs**

Run: `npm run build`
Expected: build succeeds, route `/app` compiled. (No Supabase calls yet.)

- [ ] **Step 9: Commit**

```bash
git add app/package.json app/package-lock.json app/next.config.ts app/tsconfig.json app/postcss.config.mjs app/tailwind.config.ts app/src app/.gitignore app/.env.example
git commit -m "feat(app): scaffold Next.js app at /app with Tailwind"
```

---

## Task 2: Username validation + reserved list (TDD)

**Files:**
- Create: `app/src/lib/username.ts`
- Test: `app/tests/unit/username.test.ts`, `app/vitest.config.ts`

- [ ] **Step 1: Write `app/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
})
```

- [ ] **Step 2: Write the failing test**

`app/tests/unit/username.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateUsername, RESERVED_USERNAMES } from '@/lib/username'

describe('validateUsername', () => {
  it('accepts a valid username', () => {
    expect(validateUsername('alex_07')).toEqual({ ok: true })
  })
  it('rejects too short', () => {
    expect(validateUsername('ab')).toEqual({ ok: false, error: 'Username must be 3-20 characters.' })
  })
  it('rejects too long', () => {
    expect(validateUsername('a'.repeat(21))).toEqual({ ok: false, error: 'Username must be 3-20 characters.' })
  })
  it('rejects invalid characters', () => {
    expect(validateUsername('bad name!')).toEqual({ ok: false, error: 'Use letters, numbers, and underscores only.' })
  })
  it('rejects reserved names case-insensitively', () => {
    expect(validateUsername('Login')).toEqual({ ok: false, error: 'That username is reserved.' })
  })
  it('reserved list includes route names', () => {
    expect(RESERVED_USERNAMES).toContain('settings')
    expect(RESERVED_USERNAMES).toContain('onboarding')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `@/lib/username` not found.

- [ ] **Step 4: Implement `app/src/lib/username.ts`**

```ts
export const RESERVED_USERNAMES = [
  'app', 'login', 'signup', 'logout', 'signout', 'onboarding', 'settings',
  'auth', 'api', 'admin', 'journal', 'leaderboard', 'feed', 'home',
  'profile', 'u', 'static', '_next', 'assets', 'favicon',
] as const

export type UsernameResult = { ok: true } | { ok: false; error: string }

const USERNAME_RE = /^[a-zA-Z0-9_]+$/

export function validateUsername(raw: string): UsernameResult {
  const name = raw.trim()
  if (name.length < 3 || name.length > 20) {
    return { ok: false, error: 'Username must be 3-20 characters.' }
  }
  if (!USERNAME_RE.test(name)) {
    return { ok: false, error: 'Use letters, numbers, and underscores only.' }
  }
  if ((RESERVED_USERNAMES as readonly string[]).includes(name.toLowerCase())) {
    return { ok: false, error: 'That username is reserved.' }
  }
  return { ok: true }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/username.ts app/tests/unit/username.test.ts app/vitest.config.ts
git commit -m "feat(app): username validation with reserved list"
```

---

## Task 3: Profile types + onboarding mapping (TDD)

**Files:**
- Create: `app/src/lib/profile.ts`
- Test: `app/tests/unit/profile.test.ts`

- [ ] **Step 1: Write the failing test**

`app/tests/unit/profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { onboardingToRow, EXPERIENCE_LEVELS, MARKETS, TRADING_STYLES } from '@/lib/profile'

describe('onboardingToRow', () => {
  it('maps onboarding answers to a profile update row', () => {
    const row = onboardingToRow({
      username: 'alex',
      experience_level: 'beginner',
      main_markets: ['forex', 'crypto'],
      trading_styles: ['scalper'],
      goal: 'Get consistent',
      is_public: true,
    })
    expect(row).toEqual({
      username: 'alex',
      experience_level: 'beginner',
      main_markets: ['forex', 'crypto'],
      trading_styles: ['scalper'],
      goal: 'Get consistent',
      is_public: true,
      onboarding_completed: true,
    })
  })

  it('exposes the option lists from the spec', () => {
    expect(EXPERIENCE_LEVELS).toEqual(['beginner', 'intermediate', 'advanced'])
    expect(MARKETS).toContain('indices')
    expect(TRADING_STYLES).toContain('swing trader')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `@/lib/profile` not found.

- [ ] **Step 3: Implement `app/src/lib/profile.ts`**

```ts
export const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const
export const MARKETS = ['forex', 'crypto', 'stocks', 'indices', 'commodities'] as const
export const TRADING_STYLES = [
  'scalper', 'day trader', 'swing trader', 'position trader', 'investor',
  'algorithmic trader', 'SMC / ICT', 'technical analysis', 'fundamental analysis',
  'momentum', 'mean reversion', 'trend following',
] as const

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]

export type OnboardingInput = {
  username: string
  experience_level: ExperienceLevel
  main_markets: string[]
  trading_styles: string[]
  goal: string
  is_public: boolean
}

export type ProfileUpdate = OnboardingInput & { onboarding_completed: true }

export function onboardingToRow(input: OnboardingInput): ProfileUpdate {
  return { ...input, onboarding_completed: true }
}

export type Profile = {
  id: string
  username: string
  display_name: string | null
  bio: string | null
  avatar_url: string | null
  experience_level: ExperienceLevel | null
  main_markets: string[] | null
  trading_styles: string[] | null
  goal: string | null
  is_public: boolean
  onboarding_completed: boolean
  xp: number
  level: number
  created_at: string
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/profile.ts app/tests/unit/profile.test.ts
git commit -m "feat(app): profile types and onboarding mapping"
```

---

## Task 4: Supabase clients

**Files:**
- Create: `app/src/lib/supabase/client.ts`, `app/src/lib/supabase/server.ts`, `app/src/lib/supabase/service.ts`

- [ ] **Step 1: Browser client — `app/src/lib/supabase/client.ts`**

```ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

- [ ] **Step 2: Server client — `app/src/lib/supabase/server.ts`**

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component; session refresh handled by middleware.
          }
        },
      },
    },
  )
}
```

- [ ] **Step 3: Service-role client — `app/src/lib/supabase/service.ts`**

```ts
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Server-only. Never import into a client component.
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/supabase
git commit -m "feat(app): supabase browser/server/service clients"
```

---

## Task 5: Database migration (profiles, enums, trigger, RLS)

**Files:**
- Create: `app/supabase/migrations/0001_profiles.sql`

- [ ] **Step 1: Write the migration**

`app/supabase/migrations/0001_profiles.sql`:

```sql
-- Extensions
create extension if not exists citext;

-- Enums
do $$ begin
  create type experience_level as enum ('beginner', 'intermediate', 'advanced');
exception when duplicate_object then null; end $$;

-- Profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext unique not null,
  display_name text,
  bio text,
  avatar_url text,
  experience_level experience_level,
  main_markets text[] not null default '{}',
  trading_styles text[] not null default '{}',
  goal text,
  is_public boolean not null default true,
  onboarding_completed boolean not null default false,
  xp integer not null default 0,
  level integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uname text;
begin
  uname := coalesce(
    new.raw_user_meta_data->>'username',
    'user_' || substr(new.id::text, 1, 8)
  );
  insert into public.profiles (id, username)
  values (new.id, uname)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (is_public = true or auth.uid() = id);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- No client INSERT/DELETE policy: inserts happen via the security-definer trigger.
```

- [ ] **Step 2: Apply the migration**

In the Supabase dashboard → SQL Editor, paste and run `0001_profiles.sql` against the project. (Or `supabase db push` if the CLI is linked.)
Expected: `profiles` table exists; trigger `on_auth_user_created` listed under `auth.users`.

- [ ] **Step 3: Manually verify trigger + RLS**

In SQL Editor:
```sql
select tgname from pg_trigger where tgrelid = 'auth.users'::regclass;
select polname, cmd from pg_policies where tablename = 'profiles';
```
Expected: `on_auth_user_created` present; `profiles_select` + `profiles_update` policies present.

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0001_profiles.sql
git commit -m "feat(app): profiles schema, signup trigger, and RLS"
```

---

## Task 6: Middleware (session refresh + guards)

**Files:**
- Create: `app/middleware.ts`

- [ ] **Step 1: Write `app/middleware.ts`**

Note: with `basePath: '/app'`, `request.nextUrl.pathname` here is WITHOUT the `/app` prefix. Redirect paths are also written without it.

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup', '/auth']

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname

  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p))
  // Protected app routes that require a session. The single-segment catch-all
  // (e.g. /alex) is a PUBLIC profile page, so it is deliberately NOT protected here.
  const isProtected =
    path === '/' || path.startsWith('/settings') || path.startsWith('/onboarding')

  // Unauthed on a protected page -> login. Public profiles + auth pages stay open.
  if (!user && isProtected) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Authed but onboarding incomplete -> force onboarding (except onboarding/auth itself).
  if (user && !path.startsWith('/onboarding') && !path.startsWith('/auth')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('onboarding_completed')
      .eq('id', user.id)
      .single()
    if (profile && !profile.onboarding_completed) {
      const url = request.nextUrl.clone()
      url.pathname = '/onboarding'
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

- [ ] **Step 2: Verify dev server boots**

Set real values in `app/.env.local` (copy from `.env.example`). Run: `npm run dev`
Visit `http://localhost:3000/app` → redirected to `/app/login` (no session).
Expected: redirect works, no console errors.

- [ ] **Step 3: Commit**

```bash
git add app/middleware.ts
git commit -m "feat(app): auth middleware with session refresh and onboarding guard"
```

---

## Task 7: Signup + login server actions

**Files:**
- Create: `app/src/app/actions/auth.ts`

- [ ] **Step 1: Write `app/src/app/actions/auth.ts`**

```ts
'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { validateUsername } from '@/lib/username'

export type ActionState = { error?: string }

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const username = String(formData.get('username') ?? '')
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const terms = formData.get('terms')

  if (!terms) return { error: 'You must accept the terms and disclaimer.' }
  const v = validateUsername(username)
  if (!v.ok) return { error: v.error }
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  })
  if (error) return { error: error.message }

  redirect('/onboarding')
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }

  redirect('/')
}
```

Note: if the chosen username is already taken, `signUp` succeeds at the auth layer but the `handle_new_user` trigger hits the `username` unique constraint. The DB-level conflict surfaces as a failed profile insert; the user lands in onboarding where Task 9's username step re-validates and lets them pick an available name. (A pre-check `select` against `profiles` can be added later as UX polish.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/actions/auth.ts
git commit -m "feat(app): signUp and signIn server actions"
```

---

## Task 8: Signup & login pages + Google OAuth + logout

**Files:**
- Create: `app/src/app/signup/page.tsx`, `app/src/app/login/page.tsx`, `app/src/app/auth/callback/route.ts`, `app/src/app/auth/signout/route.ts`
- Create: `app/src/app/_components/GoogleButton.tsx`

- [ ] **Step 1: Google OAuth button — `app/src/app/_components/GoogleButton.tsx`**

```tsx
'use client'

import { createClient } from '@/lib/supabase/client'

export function GoogleButton() {
  async function signInWithGoogle() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app/auth/callback` },
    })
  }
  return (
    <button
      type="button"
      onClick={signInWithGoogle}
      className="w-full rounded border border-gray-300 py-2 font-medium hover:bg-gray-50"
    >
      Continue with Google
    </button>
  )
}
```

- [ ] **Step 2: Signup page — `app/src/app/signup/page.tsx`**

```tsx
'use client'

import { useActionState } from 'react'
import { signUp, type ActionState } from '@/app/actions/auth'
import { GoogleButton } from '@/app/_components/GoogleButton'

const initial: ActionState = {}

export default function SignupPage() {
  const [state, action, pending] = useActionState(signUp, initial)
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-bold">Create your free profile</h1>
      <form action={action} className="mt-6 space-y-4">
        <input name="username" placeholder="Username" required
          className="w-full rounded border border-gray-300 px-3 py-2" />
        <input name="email" type="email" placeholder="Email" required
          className="w-full rounded border border-gray-300 px-3 py-2" />
        <input name="password" type="password" placeholder="Password (min 8)" required
          className="w-full rounded border border-gray-300 px-3 py-2" />
        <label className="flex items-start gap-2 text-sm text-gray-600">
          <input type="checkbox" name="terms" className="mt-1" />
          I agree to the Terms and financial disclaimer. TradingSocial is an education and
          performance-tracking platform and does not provide financial advice.
        </label>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending}
          className="w-full rounded bg-black py-2 font-medium text-white disabled:opacity-50">
          {pending ? 'Creating…' : 'Join the Beta'}
        </button>
      </form>
      <div className="my-4 text-center text-sm text-gray-400">or</div>
      <GoogleButton />
      <p className="mt-6 text-center text-sm text-gray-600">
        Already have an account? <a href="/app/login" className="underline">Log in</a>
      </p>
    </main>
  )
}
```

- [ ] **Step 3: Login page — `app/src/app/login/page.tsx`**

```tsx
'use client'

import { useActionState } from 'react'
import { signIn, type ActionState } from '@/app/actions/auth'
import { GoogleButton } from '@/app/_components/GoogleButton'

const initial: ActionState = {}

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial)
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-bold">Log in</h1>
      <form action={action} className="mt-6 space-y-4">
        <input name="email" type="email" placeholder="Email" required
          className="w-full rounded border border-gray-300 px-3 py-2" />
        <input name="password" type="password" placeholder="Password" required
          className="w-full rounded border border-gray-300 px-3 py-2" />
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending}
          className="w-full rounded bg-black py-2 font-medium text-white disabled:opacity-50">
          {pending ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <div className="my-4 text-center text-sm text-gray-400">or</div>
      <GoogleButton />
      <p className="mt-6 text-center text-sm text-gray-600">
        New here? <a href="/app/signup" className="underline">Create a profile</a>
      </p>
    </main>
  )
}
```

- [ ] **Step 4: OAuth callback — `app/src/app/auth/callback/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${origin}/app/login?error=oauth`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/app/login?error=oauth`)
  }
  // New Google users have onboarding_completed=false; middleware sends them to onboarding.
  return NextResponse.redirect(`${origin}/app`)
}
```

- [ ] **Step 5: Logout — `app/src/app/auth/signout/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(`${new URL(request.url).origin}/app/login`, { status: 303 })
}
```

- [ ] **Step 6: Configure Supabase redirect URLs**

In Supabase dashboard → Authentication → URL Configuration, add to **Redirect URLs**:
`http://localhost:3000/app/auth/callback` and `https://tradingsocial.io/app/auth/callback`.
Google provider: already configured with existing client ID/secret.

- [ ] **Step 7: Manual smoke test**

Run `npm run dev`. Sign up with email/password → lands on `/app/onboarding` (page added in Task 9; for now expect a 404 — that is fine). Confirm a row appears in `profiles` (Supabase Table Editor).
Expected: new `auth.users` row + matching `profiles` row with the chosen username.

- [ ] **Step 8: Commit**

```bash
git add app/src/app/signup app/src/app/login app/src/app/auth app/src/app/_components
git commit -m "feat(app): signup/login pages, Google OAuth callback, logout"
```

---

## Task 9: Onboarding wizard

**Files:**
- Create: `app/src/app/actions/profile.ts`, `app/src/app/onboarding/page.tsx`

- [ ] **Step 1: Onboarding save action — `app/src/app/actions/profile.ts`**

```ts
'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { validateUsername } from '@/lib/username'
import { onboardingToRow, type OnboardingInput, type ExperienceLevel } from '@/lib/profile'

export type ProfileState = { error?: string }

export async function saveOnboarding(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const username = String(formData.get('username') ?? '')
  const v = validateUsername(username)
  if (!v.ok) return { error: v.error }

  const input: OnboardingInput = {
    username,
    experience_level: String(formData.get('experience_level') ?? 'beginner') as ExperienceLevel,
    main_markets: formData.getAll('main_markets').map(String),
    trading_styles: formData.getAll('trading_styles').map(String),
    goal: String(formData.get('goal') ?? ''),
    is_public: formData.get('is_public') === 'public',
  }

  const { error } = await supabase
    .from('profiles')
    .update(onboardingToRow(input))
    .eq('id', user.id)

  if (error) {
    if (error.code === '23505') return { error: 'That username is already taken.' }
    return { error: error.message }
  }
  redirect('/')
}
```

- [ ] **Step 2: Onboarding page — `app/src/app/onboarding/page.tsx`**

Loads the current username so existing email signups keep theirs; Google users get the placeholder pre-filled to overwrite.

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EXPERIENCE_LEVELS, MARKETS, TRADING_STYLES } from '@/lib/profile'
import { saveOnboarding } from '@/app/actions/profile'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles').select('username').eq('id', user.id).single()

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-bold">Build your trader identity</h1>
      <form action={saveOnboarding} className="mt-6 space-y-6">
        <div>
          <label className="block text-sm font-medium">Username</label>
          <input name="username" defaultValue={profile?.username ?? ''} required
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2" />
        </div>

        <fieldset>
          <legend className="text-sm font-medium">What do you trade?</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {MARKETS.map((m) => (
              <label key={m} className="flex items-center gap-1 text-sm capitalize">
                <input type="checkbox" name="main_markets" value={m} /> {m}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="block text-sm font-medium">Experience level</label>
          <select name="experience_level" className="mt-1 w-full rounded border border-gray-300 px-3 py-2 capitalize">
            {EXPERIENCE_LEVELS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Trading style (optional)</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {TRADING_STYLES.map((s) => (
              <label key={s} className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="trading_styles" value={s} /> {s}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="block text-sm font-medium">What is your main goal?</label>
          <input name="goal" className="mt-1 w-full rounded border border-gray-300 px-3 py-2" />
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Profile visibility</legend>
          <label className="mr-4 text-sm"><input type="radio" name="is_public" value="public" defaultChecked /> Public</label>
          <label className="text-sm"><input type="radio" name="is_public" value="private" /> Private</label>
        </fieldset>

        <button className="w-full rounded bg-black py-2 font-medium text-white">Finish</button>
      </form>
    </main>
  )
}
```

- [ ] **Step 3: Manual test**

Sign up → complete onboarding → redirected to `/app`. `profiles` row shows `onboarding_completed = true` and the chosen fields.
Expected: subsequent visits to `/app` no longer redirect to onboarding.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/actions/profile.ts app/src/app/onboarding
git commit -m "feat(app): onboarding wizard and save action"
```

---

## Task 10: R2 avatar upload + settings page

**Files:**
- Create: `app/src/lib/r2.ts`, `app/src/app/actions/avatar.ts`, `app/src/app/settings/page.tsx`, `app/src/app/_components/AvatarUploader.tsx`

- [ ] **Step 1: R2 client + presign — `app/src/lib/r2.ts`**

```ts
import { S3Client } from '@aws-sdk/client-s3'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

export async function presignAvatarUpload(userId: string, contentType: string) {
  const ext = contentType === 'image/png' ? 'png' : 'jpg'
  const key = `avatars/${userId}.${ext}`
  const url = await getSignedUrl(
    r2Client(),
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, ContentType: contentType }),
    { expiresIn: 60 },
  )
  return { url, publicUrl: `${process.env.R2_PUBLIC_BASE_URL}/${key}` }
}
```

- [ ] **Step 2: Presign action — `app/src/app/actions/avatar.ts`**

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { presignAvatarUpload } from '@/lib/r2'

export async function getAvatarUploadUrl(contentType: string) {
  if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
    return { error: 'Only PNG or JPEG allowed.' as const }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' as const }
  return presignAvatarUpload(user.id, contentType)
}

export async function saveAvatarUrl(publicUrl: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' as const }
  await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id)
  return { ok: true as const }
}
```

- [ ] **Step 3: Avatar uploader (client) — `app/src/app/_components/AvatarUploader.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { getAvatarUploadUrl, saveAvatarUrl } from '@/app/actions/avatar'

export function AvatarUploader({ current }: { current: string | null }) {
  const [url, setUrl] = useState(current)
  const [status, setStatus] = useState<string>('')

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('Uploading…')
    const signed = await getAvatarUploadUrl(file.type)
    if ('error' in signed) { setStatus(signed.error); return }
    const put = await fetch(signed.url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
    if (!put.ok) { setStatus('Upload failed. Try again.'); return }
    await saveAvatarUrl(signed.publicUrl)
    setUrl(signed.publicUrl)
    setStatus('Saved.')
  }

  return (
    <div className="space-y-2">
      {url && <img src={url} alt="avatar" className="h-20 w-20 rounded-full object-cover" />}
      <input type="file" accept="image/png,image/jpeg" onChange={onChange} />
      {status && <p className="text-sm text-gray-500">{status}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Settings page — `app/src/app/settings/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AvatarUploader } from '@/app/_components/AvatarUploader'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles').select('avatar_url, username').eq('id', user.id).single()

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-gray-600">@{profile?.username}</p>
      <section className="mt-6">
        <h2 className="text-sm font-medium">Avatar</h2>
        <div className="mt-2"><AvatarUploader current={profile?.avatar_url ?? null} /></div>
      </section>
      <form action="/app/auth/signout" method="post" className="mt-8">
        <button className="rounded border border-gray-300 px-4 py-2 text-sm">Log out</button>
      </form>
    </main>
  )
}
```

- [ ] **Step 5: Configure R2 CORS**

In Cloudflare R2 bucket settings, add a CORS rule allowing `PUT` from `http://localhost:3000` and `https://tradingsocial.io` with header `Content-Type`. Make the bucket (or a public dev domain) readable so `R2_PUBLIC_BASE_URL` resolves.

- [ ] **Step 6: Manual test**

On `/app/settings`, upload a PNG → preview updates, `profiles.avatar_url` populated.
Expected: object exists in R2; URL loads.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/r2.ts app/src/app/actions/avatar.ts app/src/app/settings app/src/app/_components/AvatarUploader.tsx
git commit -m "feat(app): R2 avatar upload and settings page"
```

---

## Task 11: Public profile page

**Files:**
- Create: `app/src/app/[username]/page.tsx`

- [ ] **Step 1: Write the profile page — `app/src/app/[username]/page.tsx`**

Static routes (`login`, `signup`, `settings`, `onboarding`, `auth`) take precedence over this dynamic segment. RLS makes a private profile return no row → render `notFound()`.

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RESERVED_USERNAMES } from '@/lib/username'

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  if ((RESERVED_USERNAMES as readonly string[]).includes(username.toLowerCase())) notFound()

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('username, display_name, bio, avatar_url, experience_level, main_markets, trading_styles, xp, level, created_at')
    .ilike('username', username)
    .maybeSingle()

  // RLS hides private profiles from non-owners -> no row -> 404 (no existence leak).
  if (!profile) notFound()

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="flex items-center gap-4">
        {profile.avatar_url && (
          <img src={profile.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover" />
        )}
        <div>
          <h1 className="text-2xl font-bold">{profile.display_name ?? profile.username}</h1>
          <p className="text-gray-500">@{profile.username}</p>
        </div>
      </header>

      {profile.bio && <p className="mt-4 text-gray-700">{profile.bio}</p>}

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-gray-500">Experience</dt><dd className="capitalize">{profile.experience_level ?? '—'}</dd></div>
        <div><dt className="text-gray-500">Markets</dt><dd>{profile.main_markets?.join(', ') || '—'}</dd></div>
        <div><dt className="text-gray-500">Styles</dt><dd>{profile.trading_styles?.join(', ') || '—'}</dd></div>
        <div><dt className="text-gray-500">Member since</dt><dd>{new Date(profile.created_at).toLocaleDateString()}</dd></div>
      </dl>

      {/* Placeholders for later phases */}
      <section className="mt-6 rounded border border-gray-200 p-4 text-sm text-gray-500">
        <div>XP: {profile.xp} · Level {profile.level} <span className="text-gray-400">(coming soon)</span></div>
        <div className="mt-1">Followers 0 · Following 0 <span className="text-gray-400">(Phase 3)</span></div>
        <div className="mt-1">No trades logged yet <span className="text-gray-400">(Phase 2)</span></div>
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Manual test**

Public profile: `http://localhost:3000/app/<your-username>` renders. Set `is_public=false` in Table Editor, open in a logged-out browser → 404.
Expected: public renders, private 404s for non-owner.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/[username]
git commit -m "feat(app): public profile page with RLS-based 404 for private"
```

---

## Task 12: Marketing-site rewrite to the app deployment

**Files:**
- Modify: `vercel.json` (repo root)

- [ ] **Step 1: Read current `vercel.json`**

Run: `cat ../vercel.json` (from `app/`) — note existing `rewrites`/`headers`.

- [ ] **Step 2: Add the `/app` rewrite**

Add to the root `vercel.json` `rewrites` array (replace `<app-project-host>` with the app project's production domain, e.g. `tradingsocial-app.vercel.app`):

```json
{ "source": "/app/:path*", "destination": "https://<app-project-host>/app/:path*" }
```

This rule must be evaluated before any catch-all marketing rewrite. Keep it first in the array.

- [ ] **Step 3: Vercel project setup (manual, one-time)**

1. Create a second Vercel project from this same GitHub repo.
2. Set its **Root Directory** to `app/`.
3. Add env vars from `app/.env.example` (real values) to that project.
4. Note its production domain → put it in the rewrite `destination` above.
5. The marketing project keeps the `tradingsocial.io` domain.

- [ ] **Step 4: Commit**

```bash
cd ..
git add vercel.json
git commit -m "feat: rewrite /app/* to the Next.js app deployment"
cd app
```

---

## Task 13: Playwright e2e

**Files:**
- Create: `app/playwright.config.ts`, `app/tests/e2e/auth.spec.ts`

- [ ] **Step 1: Playwright config — `app/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/app/login',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:3000' },
})
```

- [ ] **Step 2: E2E test — `app/tests/e2e/auth.spec.ts`**

Uses a unique email per run so signups don't collide. Requires `app/.env.local` pointing at a Supabase project where email confirmation is OFF (immediate access).

```ts
import { test, expect } from '@playwright/test'

const stamp = Date.now()
const username = `e2e_${stamp}`
const email = `e2e_${stamp}@example.com`
const password = 'password123'

test('signup -> onboarding -> profile, then logout', async ({ page }) => {
  await page.goto('/app/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.check('input[name="terms"]')
  await page.click('button:has-text("Join the Beta")')

  // Onboarding
  await expect(page).toHaveURL(/\/app\/onboarding/)
  await page.check('input[name="main_markets"][value="forex"]')
  await page.fill('input[name="goal"]', 'Get consistent')
  await page.click('button:has-text("Finish")')

  // Landed in app
  await expect(page).toHaveURL(/\/app$/)

  // Public profile renders
  await page.goto(`/app/${username}`)
  await expect(page.locator('text=@' + username)).toBeVisible()
})

test('unauthed protected route redirects to login', async ({ page }) => {
  await page.context().clearCookies()
  await page.goto('/app/settings')
  await expect(page).toHaveURL(/\/app\/login/)
})

test('reserved username is rejected at signup', async ({ page }) => {
  await page.goto('/app/signup')
  await page.fill('input[name="username"]', 'login')
  await page.fill('input[name="email"]', `r_${Date.now()}@example.com`)
  await page.fill('input[name="password"]', 'password123')
  await page.check('input[name="terms"]')
  await page.click('button:has-text("Join the Beta")')
  await expect(page.locator('text=That username is reserved.')).toBeVisible()
})
```

- [ ] **Step 3: Install browsers and run**

Run: `npx playwright install --with-deps chromium && npm run test:e2e`
Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/playwright.config.ts app/tests/e2e/auth.spec.ts
git commit -m "test(app): e2e auth, onboarding, guard, and reserved-username flows"
```

---

## Final Verification

- [ ] `cd app && npm test` → unit tests pass.
- [ ] `cd app && npm run test:e2e` → e2e tests pass.
- [ ] `cd app && npm run build` → production build succeeds.
- [ ] Manual: signup, Google login, onboarding, avatar upload, public profile, private-profile 404, logout all work against the Supabase project.
- [ ] Root `vercel.json` rewrite points at the live app deployment host.
```
