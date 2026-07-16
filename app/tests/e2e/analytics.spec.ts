// app/tests/e2e/analytics.spec.ts
import { test, expect, type Page } from '@playwright/test'

async function signUpAndOnboard(page: Page, prefix: string, domain: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36)
  const username = `${prefix}_${stamp}`.slice(0, 20)
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@${domain}`)
  await page.fill('input[name="password"]', 'password123')
  await page.locator('label.fl-terms .fl-check').click()
  await expect(page.locator('input[name="terms"]')).toBeChecked()
  await page.click('button:has-text("Join the Beta")')
  // Select-plan step — default selection is Free; continue with it
  await expect(page).toHaveURL(/\/select-plan/, { timeout: 15000 })
  await page.click('button:has-text("Continue with Free")')
  // Onboarding multi-step flow (5 steps + reveal)
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
  await expect(page).toHaveURL('/', { timeout: 15000 })
  return username
}

test('admin sees the analytics dashboard sections', async ({ page }) => {
  await signUpAndOnboard(page, 'an', 'admin.tradingsocial.test')
  await page.goto('/admin/analytics')
  await expect(page.getByRole('heading', { name: 'Growth' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Engagement' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ops' })).toBeVisible()
  await expect(page.getByText('Total users')).toBeVisible()
})
