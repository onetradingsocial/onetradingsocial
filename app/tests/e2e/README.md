# Running the Playwright suite

```bash
cd app
npm run test:e2e          # or: npx playwright test [file]
npm run e2e:preflight     # just the environment check, no browser
```

Both entry points run `scripts/e2e-preflight.mjs` first — it is wired as
Playwright's `globalSetup`, not as an npm hook, so `npx playwright test` cannot
walk around it. It aborts the run while a **BLOCK** is outstanding. That is
deliberate. Read the next section before you consider removing it.

---

## Why the preflight exists

57 of the 58 tests open `/signup` and create a real account through the real
form before they assert anything. When the environment cannot support that,
Playwright does not say so. It says this, 57 times:

```
Error: expect(page).toHaveURL(expected) failed
  Expected pattern: /\/welcome/
  Received string:  "http://localhost:3000/signup"
```

That is a browser timeout describing a server-side refusal. The actual cause is
one line of dev-server stdout that never reaches the test report:

```
[signUp] {"err":{"message":"email rate limit exceeded"}}
```

The suite has been read as "flaky", as "a click timeout", and as a Node
streaming-SSR bug. It was none of those. The preflight's whole job is to put the
real sentence in front of you before the browser starts.

---

## Node version, and the dev-server crash

`.nvmrc` pins **22.23.2**: current 22.x, the same major Vercel runs, and able to
run vitest (22.11.0 could not; `require(esm)` landed in 22.12). **It does not fix
the crash below** — an earlier revision of this file said it did, and that was
wrong.

**The `transformAlgorithm` failure is real.** This file used to say it had never
been reproduced, and asked whoever found it to say so here. On 2026-09-11, under
`next dev`, server-action submits crashed with

```
TypeError: controller[kState].transformAlgorithm is not a function
```

— signup 3 of 3 on Node 22.19.0, and onboarding 3 of 3 on 22.23.2, each before
the action wrote anything.

It is a Node bug: a race in `stream/web`'s TransformStream where a write lands
after cancel has cleared the algorithm (nodejs/node#62036). The fix,
nodejs/node#62040, is confirmed only in **v24.15.0** and **v25.8.1**. The
official reproduction still fails on 22.23.2. A summary claiming a 22.x backport
was taken on trust and turned out to be wrong; test the version, don't read
about it.

**It only triggers under the dev server.** On the same Node 22.23.2,
`next build && next start` completed the same onboarding cleanly, and production
(Vercel, Node 22) completed onboarding 104 of 104 over 60 days. Whatever the dev
server does extra with its streams is what exposes the race.

So, for anything that submits a form:

- run the production build locally — `npm run build && npm run start` — which is
  also the closest thing to what users get, or
- run `next dev` on Node ≥ 24.15, accepting that it no longer matches Vercel's
  major.

This matters for the suite too: if Playwright's `webServer` runs `next dev` on
Node 22, server-action specs can fail on this race rather than on the app.

**Why it was once marked disproven:** it is a race. Passing runs cannot rule a
race out — only the Node version, or a verified reproduction, can.

The hidden-tab observation in `docs/qa-sweep-2026-08-21.md` is still correct on
its own terms — a permanently hidden preview tab does make `$RC` pages look
frozen — but it explained a different symptom, not this error.

---

## Blocker — the suite does not yet handle email confirmation

`app/.env.local` points at the dev project `sixixwutvrguqemqzvvw`
(*TradingSocial-Dev*), which is correct — the production project is
`jmpanzrjxflovdfwcbye` and the suite must never touch it.

**Confirmation is ON in dev, on purpose.** On 2026-09-10 the owner chose to
support email confirmation rather than turn it off, and dev now sends through
custom SMTP (Resend, `accounts@tradingsocial.io`). Runbook:
`docs/auth-email-smtp.md`. Do not "fix" the suite by turning it off.

This section used to say the fix was to turn confirmation off, and blamed the
built-in mailer's rate limit. The real reason dev signups had failed since
2026-08-21 was harder: Supabase's built-in mailer **refuses any address that is
not a member of the organization's team** (*"Email address not authorized"*).
Custom SMTP removes both limits.

What still stops the suite: with confirmation on, `signUp()` returns no
session, so specs that expect to land on `/welcome` after signup never will.
The preflight still aborts on this, correctly.

**Open item:** specs that merely need a signed-in user should create and confirm
it through the admin API (`auth.admin.createUser` with `email_confirm: true`)
rather than the signup form. `auth.spec.ts` is the exception — it tests the real
signup flow and should assert the `/check-email` step instead of `/welcome`.

Nobody but the project owner can do this. It is a dashboard setting on a hosted
project, not a file in this repository.

---

## The admin specs skip unless you seed an admin

`admin.spec.ts` and `analytics.spec.ts` self-skip when `E2E_ADMIN_EMAIL` is
unset (see `utils/admin.ts` — they can no longer mint an admin by signing up,
which is the point of audit item 18 F1). That is 9 of the 58 tests and the whole
`/admin` surface.

Skipping is by design, but a skip is invisible in the line reporter and "the
suite is green" has meant "admin never ran" before, so the preflight says it out
loud every time.

### Owner action

1. Create an admin account on the **dev** project.
2. Add its **exact** address to `ADMIN_EMAILS` on the dev server —
   `parseAdminEmails()` takes exact addresses only, a bare `@domain` entry is
   dropped at parse time.
3. Set `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` in `app/.env.local`.

Never point these at production.

`seed-users.md` (gitignored) documents seeded accounts on
`jmpanzrjxflovdfwcbye`, the **production** project — those accounts do not exist
in the dev project the app actually talks to, so that file is not a shortcut
here. Same trap as the 2026-08-21 sweep recorded.

---

## Environment the suite needs

| Variable | Why |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the project the dev server talks to. **Must not be the production ref** — the preflight blocks on it, because the suite writes real auth users and real posts. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | signup goes through it |
| `SUPABASE_SERVICE_ROLE_KEY` | `utils/db.ts` cleanup, and the trial / welcome-popup fixtures |
| `NEXT_PUBLIC_SITE_URL` | must be `http://localhost:3000` |
| `AUTH_EMAIL_CONFIRMATION` | must mirror the dashboard toggle (see Blocker 2) |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` | optional; without them 9 tests skip |

Playwright does **not** load `.env.local` the way Next.js does. `utils/db.ts`
and the preflight each parse it themselves, with real process env taking
precedence.

---

## What the preflight will not do

It will not skip a test, relax an assertion, widen a timeout, or pass a run with
no tests. A blocker exits non-zero and Playwright never starts; a warning prints
and the suite runs exactly as written. A suite that goes green because it
stopped checking is worse than one that does not run.
