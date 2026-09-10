import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  /**
   * Environment check, run before any spec. See tests/e2e/README.md.
   *
   * 57 of the 58 tests begin by creating a real account through the real signup
   * form, so anything that stops a signup stops the suite — and Playwright
   * reports that as 57 identical `toHaveURL(/\/welcome/)` timeouts on
   * `/signup`, with the actual GoTrue error visible only in the dev server's
   * stdout. The preflight reads the project's own auth settings first and names
   * the cause. It aborts the run; it never skips a spec.
   */
  globalSetup: './tests/e2e/global-setup.ts',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:3000' },
})
