import { expect, type Page } from '@playwright/test'
import { SEEDED_PASSWORD } from './creds'

/**
 * Sign in as the e2e admin. Audit item 18, F1.
 *
 * The admin specs used to *sign up* a fresh account under a `.test` domain and
 * get admin from a domain-suffix wildcard in `ADMIN_EMAILS`. That wildcard was
 * the P0: `.test` is an RFC 6761 reserved TLD, so every address under it is
 * permanently unclaimed, and with open signup and email confirmation off it was
 * a registerable admin credential for anyone on the internet. `parseAdminEmails`
 * now accepts exact addresses only (commit `1c6ebce`), so there is no longer any
 * way to mint an admin by signing up — which is exactly the point, and which is
 * why these specs have to log in to a pre-seeded account instead.
 *
 * Two env vars, neither committed, both DEV-only:
 *
 *   E2E_ADMIN_EMAIL     the seeded admin's address. Must also appear verbatim
 *                       in `ADMIN_EMAILS` on the dev server.
 *   E2E_ADMIN_PASSWORD  optional; defaults to the seeded-account password.
 *
 * Unset means the admin specs cannot run. They `skip` rather than fail: a
 * missing local env var is a setup gap, not a regression, and a red suite that
 * is red for setup reasons stops being read.
 */
export function adminCreds(): { email: string; password: string } | null {
  const email = process.env.E2E_ADMIN_EMAIL
  if (!email) return null
  return { email, password: process.env.E2E_ADMIN_PASSWORD ?? SEEDED_PASSWORD }
}

export async function signInAsAdmin(page: Page, creds: { email: string; password: string }): Promise<void> {
  await page.goto('/login')
  await page.fill('input[name="email"]', creds.email)
  await page.fill('input[name="password"]', creds.password)
  await page.click('button:has-text("Log in")')
  // Landing anywhere inside the app is enough; the spec navigates from here.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 })
}
