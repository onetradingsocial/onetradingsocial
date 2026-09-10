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

## Blocker 1 (disputed) — the Node pin

`.nvmrc` pins **22.11.0**. Machines here run 22.19.0.

The pin was justified by a claim that newer Node breaks the dev server's
streaming SSR — the response dying with
`controller[kState].transformAlgorithm is not a function` just before React's
`$RC` reveal script, so hard page loads hang on the Suspense skeleton.

**That has never been reproduced as version-dependent, and has been contradicted
twice.**

- `docs/qa-sweep-2026-08-21.md` retracts it. The "page stuck on its skeleton"
  observation came from a preview tab that is permanently
  `visibilityState: "hidden"`. Chrome runs no `requestAnimationFrame` in a
  hidden tab, and React 19.2 defers the Suspense reveal through rAF — so every
  page emitting `$RC(` looks frozen in that harness while the HTML it produced
  is byte-perfect and already carries a working reveal call.
- Re-checked on Node **v22.19.0** during the B0 audit follow-up. `/login`,
  `/signup`, `/demo` and `/leaderboard` each return 200 with a complete
  `</html>` and a `$RC` reveal. Playwright's own headless Chromium renders
  `/signup`, fills it and submits it without trouble — the dev server logs the
  resulting `POST /signup 200`.

So the preflight reports a Node mismatch as a **warning**, not a blocker.

Two things follow:

1. **Nothing needs a Node downgrade to run this suite today.** If you do hit a
   hard page load hanging on a skeleton, check the dev server's stdout for
   `transformAlgorithm` before blaming Playwright — and if you find it, say so
   in this file, because nobody has yet.
2. **The pin is actively harmful for the rest of the toolchain.** 22.11.0 cannot
   run vitest at all (`ERR_REQUIRE_ESM`; `require(esm)` landed in 22.12). Raising
   `.nvmrc` to at least 22.12 is an open item from the 2026-08-21 sweep and
   still open.

There is no version manager installed on the current machine (no nvm, fnm,
volta, nodenv, nvs or asdf), and the only real Node on disk is
`C:\Program Files\nodejs` at v22.19.0. Even if the pin were a genuine
requirement, satisfying it needs an install nobody has done.

---

## Blocker 2 — "Confirm email" is ON for the dev Supabase project

**This is the one that actually stops the suite, and it cannot be fixed from
inside this repo.**

`app/.env.local` points at the dev project `sixixwutvrguqemqzvvw`
(*TradingSocial-Dev*), which is correct — the production project is
`jmpanzrjxflovdfwcbye` and the suite must never touch it.

But that dev project has **Confirm email** switched **ON**. Its own GoTrue
config says so:

```
GET https://<project>.supabase.co/auth/v1/settings   ->   "mailer_autoconfirm": false
```

Two consequences, and the second is the one people miss:

1. **Every `auth.signUp()` also tries to send a confirmation email.** Supabase's
   built-in SMTP allows only a couple of messages per hour per project, so
   signups start coming back `email rate limit exceeded` almost immediately and
   then stay that way for the rest of the hour. `friendlyAuthError()` maps that
   to *"Too many attempts right now. Please wait a minute and try again."*, the
   browser stays on `/signup`, and the spec times out waiting for `/welcome`.
   No account is created. The newest user in the dev project dates from
   2026-08-21, which is roughly when this started.

2. **Raising the email rate limit would not fix it.** With confirmation ON,
   `signUp()` returns no session even when it succeeds. The user is never logged
   in, so the funnel never leaves `/signup` and `/welcome` is still never
   reached. Confirmation has to be **off**, which is also how production is
   configured — `seed-users.md`: *"email confirmation is OFF — accounts work
   immediately"*.

### Owner action

Supabase dashboard, **dev project `sixixwutvrguqemqzvvw` only**:

> Authentication → Sign In / Providers → Email → turn **off** "Confirm email"

Then keep `AUTH_EMAIL_CONFIRMATION` in `app/.env.local` at `off`, matching it.
`.env.example` is explicit that the dashboard toggle and that variable are
flipped in the same change, never one without the other; the preflight warns
when they disagree.

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
