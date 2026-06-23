// app/tests/e2e/analytics.spec.ts
import { test, expect, type Page } from '@playwright/test'

async function signUpAndOnboard(page: Page, prefix: string, domain: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36)
  const username = `${prefix}_${stamp}`.slice(0, 20)
  await page.goto('/app/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@${domain}`)
  await page.fill('input[name="password"]', 'password123')
  await page.check('input[name="terms"]')
  await page.click('button:has-text("Join the Beta")')
  await expect(page).toHaveURL(/\/app\/onboarding/)
  await page.locator('label.ts-chip', { hasText: 'forex' }).click()
  await page.fill('input[name="goal"]', 'Be consistent')
  await page.click('button:has-text("Finish")')
  await expect(page).toHaveURL(/\/app$/)
  return username
}

test('admin sees the analytics dashboard sections', async ({ page }) => {
  await signUpAndOnboard(page, 'an', 'admin.tradingsocial.test')
  await page.goto('/app/admin/analytics')
  await expect(page.getByRole('heading', { name: 'Growth' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Engagement' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ops' })).toBeVisible()
  await expect(page.getByText('Total users')).toBeVisible()
})
