import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * Runs scripts/e2e-preflight.mjs before any spec, and aborts the whole run when
 * it reports a blocker.
 *
 * It lives here rather than only in an npm `pretest:e2e` hook because the way
 * this suite is actually invoked — by a person debugging one spec, or by an
 * agent — is `npx playwright test <file>`, which never goes through npm's
 * lifecycle scripts. The check has to sit where every entry point passes.
 *
 * Throwing here fails the run loudly with the preflight's own output. It does
 * NOT skip anything: no spec is filtered, no assertion is relaxed, no timeout
 * is widened. Either the environment can run the suite as written, or the run
 * stops and names what is missing.
 */
export default function globalSetup(): void {
  if (process.env.E2E_SKIP_PREFLIGHT === '1') {
    // Escape hatch for working ON the preflight itself. Deliberately not
    // documented in the README as a way to get a red suite to start: every
    // blocker it reports is an environment fault that the specs will hit
    // anyway, three minutes later, as an unreadable browser timeout.
    return
  }

  const script = resolve(__dirname, '../../scripts/e2e-preflight.mjs')
  const res = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    cwd: resolve(__dirname, '../..'),
  })

  if (res.status !== 0) {
    throw new Error(
      'e2e preflight failed — see the BLOCK entries above and app/tests/e2e/README.md. ' +
        'Playwright was not started, because it would report these as browser timeouts.',
    )
  }
}
