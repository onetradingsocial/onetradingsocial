import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * `.env.local`, merged under the real environment.
 *
 * Playwright does not load `.env.local` the way Next.js does — the test runner
 * is a separate process from the dev server, so a variable that works fine in
 * the app is simply absent in a spec.
 *
 * That had already been worked around twice, separately: `utils/db.ts` parsed
 * the file for the service-role credentials, and `scripts/e2e-preflight.mjs`
 * parsed it again for its own checks. `utils/admin.ts` did NOT, so
 * `E2E_ADMIN_EMAIL` read as undefined however carefully it was set — and
 * because the admin specs `skip` on a missing credential rather than fail, the
 * result was 9 tests and the whole /admin surface quietly not running, with a
 * green-looking report.
 *
 * One loader, used everywhere, so the next variable added to `.env.local` does
 * not have to rediscover this.
 *
 * Real environment wins over the file, so CI and one-off overrides behave the
 * way anyone would expect.
 */
export function loadEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    const out: Record<string, string> = {}
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) continue
      out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
    return out
  } catch {
    return {}
  }
}

/** The environment a spec should read: `.env.local` beneath the real env. */
export function e2eEnv(): Record<string, string | undefined> {
  return { ...loadEnvLocal(), ...process.env }
}
