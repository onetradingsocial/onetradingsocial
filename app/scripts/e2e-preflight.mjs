#!/usr/bin/env node
/**
 * Playwright e2e preflight.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every e2e spec but one begins by creating a real account through the real
 * signup form. When the environment cannot support that, Playwright does not
 * say so: it reports `expect(page).toHaveURL(/\/welcome/)` timing out on
 * `/signup`, 58 times, and the actual cause — a one-line GoTrue error visible
 * only in the dev server's stdout — never reaches the test report. Two full
 * days of the audit wave were spent reading that symptom as a click timeout.
 *
 * So this script checks the environment *before* the browser starts and names
 * the blocker. It is wired to `pretest:e2e`, so `npm run test:e2e` runs it
 * automatically and refuses to start when a BLOCK is present.
 *
 * IT NEVER SKIPS OR RELAXES A TEST. A blocker exits non-zero and the suite does
 * not run; a warning prints and the suite runs unchanged.
 *
 * Usage:  node scripts/e2e-preflight.mjs        (from app/)
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The production Supabase project. The e2e suite writes real auth users, so
 *  pointing it here would put test accounts in front of real customers.
 *  `.env.example` already says "NEVER set these against the production
 *  project"; this turns that sentence into a check. */
const PRODUCTION_REF = 'jmpanzrjxflovdfwcbye'

const blocks = []
const warns = []
const notes = []
const block = (title, detail) => blocks.push({ title, detail })
const warn = (title, detail) => warns.push({ title, detail })
const note = (line) => notes.push(line)

/**
 * Same contract as tests/e2e/utils/db.ts: Playwright does not load `.env.local`
 * the way Next.js does, so parse it here and let real process env win.
 */
function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(APP_DIR, '.env.local'), 'utf8')
    const out = {}
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
    return out
  } catch {
    return {}
  }
}

// ── 1. Node version ─────────────────────────────────────────────────────────
//
// `.nvmrc` pins 22.23.2, and the reason is real. Node 22.x from before the
// 2026-03 backport of nodejs/node#62040 has a stream/web TransformStream race
// that throws `controller[kState].transformAlgorithm is not a function` when a
// pending write runs after cancel/close (nodejs/node#62036). On 22.19.0 it
// crashed local signup submits three of three on 2026-09-11, before the request
// reached Supabase.
//
// An earlier version of this comment called the failure disproven because page
// loads and a few signup POSTs passed on 22.19.0. That was wrong: it is a race,
// and passing runs cannot rule a race out. See tests/e2e/README.md.
//
// Still a warning rather than a hard stop, because a mismatch is usually a
// NEWER Node, which is fine. Treat any older 22.x as suspect.
function checkNode() {
  let pinned = null
  try {
    pinned = readFileSync(resolve(APP_DIR, '.nvmrc'), 'utf8').trim()
  } catch {
    return
  }
  const running = process.versions.node
  if (running === pinned) return
  warn(
    `Node ${running} does not match the .nvmrc pin (${pinned})`,
    [
      'A newer Node is fine. An OLDER 22.x may predate the fix for a Node',
      'web-streams race (nodejs/node#62036) that crashes form submits with',
      '`transformAlgorithm is not a function` — seen on 22.19.0.',
      'If a submit shows "Something went wrong", check the dev server stdout',
      'for `transformAlgorithm` before blaming the test.',
      'See tests/e2e/README.md, "Node version".',
    ].join('\n    '),
  )
}

// ── 2. Environment ──────────────────────────────────────────────────────────
function checkEnv(env) {
  const required = [
    ['NEXT_PUBLIC_SUPABASE_URL', 'the Supabase project the dev server talks to'],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'the browser-side key; signup goes through it'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'tests/e2e/utils/db.ts cleanup, and trial/admin fixtures'],
    ['NEXT_PUBLIC_SITE_URL', 'auth redirect origin; must be http://localhost:3000 for e2e'],
  ]
  for (const [key, why] of required) {
    if (!env[key]) block(`${key} is not set`, `Needed for: ${why}.\n    Set it in app/.env.local (gitignored) or in the environment.`)
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (url.includes(PRODUCTION_REF)) {
    block(
      'NEXT_PUBLIC_SUPABASE_URL points at the PRODUCTION Supabase project',
      [
        `Project ref ${PRODUCTION_REF}.`,
        'The suite creates real auth users and real posts on every run. Point it',
        'at the dev project instead. Refusing to run.',
      ].join('\n    '),
    )
  }

  const site = env.NEXT_PUBLIC_SITE_URL ?? ''
  if (site && !site.includes('localhost')) {
    warn(
      `NEXT_PUBLIC_SITE_URL is ${site}, not localhost`,
      'Playwright drives http://localhost:3000. Auth email links and OAuth\n    callbacks will point somewhere else.',
    )
  }
  return url
}

// ── 3. The project's own auth settings ──────────────────────────────────────
//
// This is the check that would have saved the wave. GoTrue publishes its
// configuration unauthenticated at /auth/v1/settings, so we can read the two
// fields that decide whether a scripted signup can work at all, without
// creating an account and without an admin key.
async function checkAuthSettings(url, env) {
  if (!url || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return

  let settings
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/settings`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      block(`Supabase auth is not reachable (HTTP ${res.status})`, `GET ${url}/auth/v1/settings.\n    Check the project is not paused and the anon key matches it.`)
      return
    }
    settings = await res.json()
  } catch (err) {
    block('Could not reach the Supabase auth endpoint', `${String(err?.message ?? err)}\n    GET ${url}/auth/v1/settings`)
    return
  }

  if (settings.disable_signup === true) {
    block(
      'Sign-ups are disabled on this Supabase project',
      'Every spec but analytics.spec.ts starts by signing up. Enable sign-ups\n    in Authentication -> Sign In / Providers.',
    )
  }

  // mailer_autoconfirm === true means "Confirm email" is OFF.
  //
  // With it ON, every auth.signUp() also tries to SEND a confirmation email.
  // Supabase's built-in SMTP allows a couple of messages per hour per project,
  // so the third signup of a run — and then every signup for the rest of the
  // hour — comes back `email rate limit exceeded`. The app maps that through
  // friendlyAuthError() to "Too many attempts right now", the browser stays on
  // /signup, and the spec times out waiting for /welcome.
  //
  // Raising the email rate limit is NOT the fix. Even under a raised limit,
  // signUp() with confirmation ON returns no session, so the user is never
  // logged in and /welcome is still never reached. Confirmation has to be OFF,
  // which is also how the production project is configured (seed-users.md:
  // "email confirmation is OFF — accounts work immediately").
  if (settings.mailer_autoconfirm === false) {
    block(
      '"Confirm email" is ON for this Supabase project — the suite cannot sign up',
      [
        'This is the blocker that presents as 57 identical Playwright timeouts',
        'on `expect(page).toHaveURL(/\\/welcome/)`. The real error is in the dev',
        'server stdout: [signUp] {"err":{"message":"email rate limit exceeded"}}.',
        '',
        '    Owner action, Supabase dashboard, DEV PROJECT ONLY:',
        '      Authentication -> Sign In / Providers -> Email',
        '        -> turn OFF "Confirm email"',
        '',
        '    Raising the email rate limit is not enough: with confirmation ON,',
        '    signUp() returns no session, so the funnel never leaves /signup.',
        '    See tests/e2e/README.md, "Blocker 2".',
      ].join('\n    '),
    )
  } else if (settings.mailer_autoconfirm === true) {
    note('Supabase "Confirm email" is OFF — signup funnel can run.')
  }

  // The app mirrors the dashboard toggle in its own env var and the two must
  // agree; .env.example is explicit that they are flipped in the same change.
  const appFlag = (env.AUTH_EMAIL_CONFIRMATION ?? '').toLowerCase() === 'on'
  if (typeof settings.mailer_autoconfirm === 'boolean') {
    const projectConfirms = settings.mailer_autoconfirm === false
    if (appFlag !== projectConfirms) {
      warn(
        'AUTH_EMAIL_CONFIRMATION disagrees with the Supabase project',
        [
          `AUTH_EMAIL_CONFIRMATION=${appFlag ? 'on' : 'off'} but the project has`,
          `"Confirm email" ${projectConfirms ? 'ON' : 'OFF'}.`,
          'A signUp that returns no session is ambiguous — "confirm your inbox"',
          'vs "that address is already registered" — and the app picks its copy',
          'from this flag. Flip both together (see .env.example).',
        ].join('\n    '),
      )
    }
  }
}

// ── 4. Admin specs ──────────────────────────────────────────────────────────
//
// Not a blocker: admin.spec.ts and analytics.spec.ts skip themselves when
// E2E_ADMIN_EMAIL is unset, by design (tests/e2e/utils/admin.ts). But a skip is
// invisible in a line reporter, and "the suite is green" has meant "the admin
// specs never ran" more than once, so it is said out loud here.
function checkAdmin(env) {
  if (env.E2E_ADMIN_EMAIL) {
    if (!env.ADMIN_EMAILS?.split(',').map((s) => s.trim().toLowerCase()).includes(env.E2E_ADMIN_EMAIL.trim().toLowerCase())) {
      block(
        'E2E_ADMIN_EMAIL is not listed in ADMIN_EMAILS',
        [
          'parseAdminEmails() takes exact addresses only (audit item 18 F1), so',
          'this account will sign in and then 404 on every /admin route.',
          'Add the exact address to ADMIN_EMAILS on the dev server.',
        ].join('\n    '),
      )
    }
    return
  }
  warn(
    'E2E_ADMIN_EMAIL is not set — the admin specs will SKIP, not run',
    [
      'admin.spec.ts and analytics.spec.ts self-skip without it. That is 9 of',
      'the 58 tests, and the whole /admin surface, silently unverified.',
      '',
      '    Owner action: create a seeded admin account on the DEV project, add',
      '    its exact address to ADMIN_EMAILS, then set E2E_ADMIN_EMAIL and',
      '    E2E_ADMIN_PASSWORD in app/.env.local. Never point these at prod.',
    ].join('\n    '),
  )
}

// ── report ──────────────────────────────────────────────────────────────────
function report() {
  const bar = '─'.repeat(72)
  console.log(`\n${bar}\ne2e preflight\n${bar}`)
  for (const line of notes) console.log(`  ok    ${line}`)
  for (const { title, detail } of warns) console.log(`\n  WARN  ${title}\n    ${detail}`)
  for (const { title, detail } of blocks) console.log(`\n  BLOCK ${title}\n    ${detail}`)
  console.log(`\n${bar}`)

  if (blocks.length === 0) {
    console.log(`${warns.length} warning(s), no blockers. Starting Playwright.\n`)
    return 0
  }
  console.log(
    `${blocks.length} blocker(s). NOT starting Playwright — it would report\n` +
      `these as browser timeouts and bury the cause.\n\n` +
      `Nothing in the repo can fix a blocker above; each one needs the project\n` +
      `owner. Details and the exact dashboard steps: app/tests/e2e/README.md\n`,
  )
  return 1
}

const env = { ...loadEnvLocal(), ...process.env }
checkNode()
const url = checkEnv(env)
await checkAuthSettings(url, env)
checkAdmin(env)
process.exit(report())
