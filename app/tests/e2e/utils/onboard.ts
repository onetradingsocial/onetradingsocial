import { expect, type Page } from '@playwright/test'
import { SIGNUP_PASSWORD } from './creds'

/** Walks the full signup funnel: /signup -> /welcome (trial) -> /onboarding -> /.
 *  Returns the generated username.
 *
 *  Shared by specs that need a freshly-onboarded user. Deliberately does NOT
 *  dismiss the post-onboarding welcome popup — callers that want it gone should
 *  call dismissWelcome() from ./welcome afterwards. The specs that assert on the
 *  popup need it left up. */
export async function signUpAndOnboard(page: Page, prefix = 'e2e'): Promise<string> {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36)
  const username = `${prefix}_${stamp}`.slice(0, 20)

  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@tradingsocial.io`)
  await page.fill('input[name="password"]', SIGNUP_PASSWORD)
  await page.locator('label.fl-terms .fl-check').click()
  await expect(page.locator('input[name="terms"]')).toBeChecked()
  await page.click('button:has-text("Join the Beta")')

  // Trial welcome step.
  //
  // We take the DECLINE route on purpose. The primary button now opens Stripe
  // Checkout, which a browser test cannot complete, so "Continue on Free" is
  // the only path through signup that stays in the app — the decline route
  // terms §7 requires happens to be what makes this helper possible at all.
  //
  // ⚠ Declining does NOT currently mean the user lands on Free. While
  // LOCAL_TRIAL_DISABLED is unset and migration 0077 unapplied, the chokepoint
  // in lib/server/trial-start.ts still stamps a local trial on the first
  // authenticated render, so these users are still Pro — which is why the specs
  // that assert "Pro Trader" after signup continue to pass.
  //
  // THAT CHANGES ON LAUNCH DAY. Once the local trial is disarmed, a user who
  // declines really is Free, and every spec asserting a Pro tier after signup
  // (trial.spec.ts, welcome-popup.spec.ts) has to grant the tier explicitly
  // instead of inheriting it. See docs/stripe-trial-transfer-2026-09-15.md.
  await expect(page).toHaveURL(/\/welcome/, { timeout: 15000 })
  await page.click('button:has-text("Continue on Free")')

  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 })
  await page.click('button:has-text("Build my identity")')
  await page.click('button:has-text("Forex")')
  await page.click('button:has-text("Continue")')
  await page.click('button:has-text("Beginner")')
  await page.click('button:has-text("Continue")')
  await page.click('button:has-text("Build consistency")')
  await page.click('button:has-text("Continue")')
  await page.click('button:has-text("Public")')
  await page.click('button:has-text("Continue")')
  await page.click('button:has-text("Log trades manually")')
  await page.click('button:has-text("Create my profile")')
  await page.click('button:has-text("Enter TradingSocial")')

  // saveOnboarding redirects to /?signup=1&cid=..., so match the root with or
  // without a query string.
  await expect(page).toHaveURL(/\/(\?.*)?$/, { timeout: 15000 })
  return username
}
