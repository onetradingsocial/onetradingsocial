// app/tests/e2e/settings.spec.ts
import { test, expect, type Page } from '@playwright/test'

const DOMAIN = 'settings.tradingsocial.test'

async function signUpAndOnboard(page: Page, prefix: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36)
  const username = `${prefix}_${stamp}`.slice(0, 20)
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@${DOMAIN}`)
  await page.fill('input[name="password"]', 'password123')
  await page.locator('label.fl-terms .fl-check').click()
  await expect(page.locator('input[name="terms"]')).toBeChecked()
  await page.click('button:has-text("Join the Beta")')
  // Select-plan step — default selection is Free; continue with it
  await expect(page).toHaveURL(/\/select-plan/, { timeout: 15000 })
  await page.click('button:has-text("Continue with Free")')
  // Onboarding multi-step flow (4 steps + reveal)
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 })
  // Step 0 — welcome → "Build my identity"
  await page.click('button:has-text("Build my identity")')
  // Step 1 — markets → pick Forex, then Continue
  await page.click('button:has-text("Forex")')
  await page.click('button:has-text("Continue")')
  // Step 2 — experience → pick Beginner, then Continue
  await page.click('button:has-text("Beginner")')
  await page.click('button:has-text("Continue")')
  // Step 3 — goal → pick Build consistency, then Continue
  await page.click('button:has-text("Build consistency")')
  await page.click('button:has-text("Continue")')
  // Step 4 — visibility → pick Public, then "Create my profile"
  await page.click('button:has-text("Public")')
  await page.click('button:has-text("Create my profile")')
  // Step 5 — reveal → "Enter TradingSocial"
  await page.click('button:has-text("Enter TradingSocial")')
  await expect(page).toHaveURL('/', { timeout: 15000 })
  return { username }
}

test('edits profile bio + display name and persists on the public profile', async ({ page }) => {
  const { username } = await signUpAndOnboard(page, 'set')
  await page.goto('/settings')

  await page.fill('input[name="display_name"]', 'Edited Name')
  await page.fill('textarea[name="bio"]', 'Scalping NAS100 since dawn.')
  // toggle a market chip on
  await page.getByText('crypto', { exact: true }).click()
  await page.getByRole('button', { name: /save changes/i }).click()
  await expect(page.getByText('Saved.')).toBeVisible()

  await page.goto(`/${username}`)
  await expect(page.getByText('Scalping NAS100 since dawn.')).toBeVisible()
  await expect(page.getByText('Edited Name')).toBeVisible()
})

test('free account cannot select Private', async ({ page }) => {
  await signUpAndOnboard(page, 'setp')
  await page.goto('/settings')
  const privateRadio = page.locator('input[name="is_public"][value="private"]')
  await expect(privateRadio).toBeDisabled()
  await expect(page.getByText(/paid perk/i)).toBeVisible()
})
