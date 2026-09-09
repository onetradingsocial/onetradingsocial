import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Structural guard for the e2e preflight (audit follow-up B0).
 *
 * The Playwright suite cannot start a single spec unless the Supabase project
 * it points at will accept a scripted signup, and when it will not, Playwright
 * reports that as 57 identical `toHaveURL(/\/welcome/)` timeouts on `/signup`.
 * The cause — `email rate limit exceeded`, because "Confirm email" is ON —
 * appears only in the dev server's stdout and never in the test report. That
 * misreading cost this project one audit wave, during which the suite was
 * variously blamed on a click timeout and on the Node version.
 *
 * `scripts/e2e-preflight.mjs` reads the project's own `/auth/v1/settings` and
 * names the blocker before the browser starts. This test guards the *wiring*,
 * not the checks: the failure mode is somebody moving the script, renaming
 * `globalSetup`, or "simplifying" the config, after which the suite silently
 * goes back to producing unreadable timeouts. None of that would fail any other
 * test in this repo.
 *
 * It reads source text rather than importing, for the same reason
 * `admin-gate.test.ts` does: the config and the setup module are loaded by
 * Playwright's own runner, not by vitest.
 */

const APP = process.cwd()
const PREFLIGHT = join(APP, 'scripts', 'e2e-preflight.mjs')

describe('e2e preflight wiring', () => {
  it('the preflight script exists', () => {
    expect(existsSync(PREFLIGHT)).toBe(true)
  })

  it('playwright.config.ts runs it via globalSetup, so `npx playwright test` cannot bypass it', () => {
    const cfg = readFileSync(join(APP, 'playwright.config.ts'), 'utf8')
    expect(cfg).toMatch(/globalSetup\s*:/)
    expect(cfg).toMatch(/global-setup/)
  })

  it('global-setup.ts aborts the run when the preflight exits non-zero', () => {
    const setup = readFileSync(join(APP, 'tests', 'e2e', 'global-setup.ts'), 'utf8')
    // It must point at the script that actually exists...
    expect(setup).toMatch(/e2e-preflight\.mjs/)
    // ...and it must THROW rather than warn. A preflight that only prints is
    // exactly the situation this whole mechanism exists to end.
    expect(setup).toMatch(/throw new Error/)
  })

  it('refuses to run the suite against the production Supabase project', () => {
    // The suite creates real auth users and real posts on every spec. The
    // production ref must stay named in the guard: `.env.example` says "NEVER
    // set these against the production project", and this is that sentence
    // made executable.
    const src = readFileSync(PREFLIGHT, 'utf8')
    expect(src).toContain('jmpanzrjxflovdfwcbye')
    expect(src).toMatch(/PRODUCTION_REF/)
  })

  it('checks the one setting that actually blocks signup', () => {
    const src = readFileSync(PREFLIGHT, 'utf8')
    expect(src).toContain('/auth/v1/settings')
    expect(src).toContain('mailer_autoconfirm')
  })

  it('never turns a blocker into a skipped or relaxed test', () => {
    const src = readFileSync(PREFLIGHT, 'utf8')
    const setup = readFileSync(join(APP, 'tests', 'e2e', 'global-setup.ts'), 'utf8')
    for (const text of [src, setup]) {
      expect(text).not.toMatch(/test\.skip|testIgnore|grepInvert|--pass-with-no-tests/)
    }
  })

  it('the script is syntactically valid so it cannot fail as a mystery exit code', () => {
    // `node --check` parses without executing: no network, no env, no Supabase.
    expect(() => execFileSync(process.execPath, ['--check', PREFLIGHT])).not.toThrow()
  })
})
