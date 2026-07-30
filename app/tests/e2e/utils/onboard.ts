import { expect, type Page } from '@playwright/test'

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
  await page.fill('input[name="password"]', 'password123')
  await page.locator('label.fl-terms .fl-check').click()
  await expect(page.locator('input[name="terms"]')).toBeChecked()
  await page.click('button:has-text("Join the Beta")')

  // Trial welcome step — 14 days of Pro, no card.
  await expect(page).toHaveURL(/\/welcome/, { timeout: 15000 })
  await page.click('button:has-text("Start my trial")')

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
