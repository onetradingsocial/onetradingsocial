import { test, expect } from '@playwright/test'

async function signUpAndOnboard(page: import('@playwright/test').Page) {
  const stamp = Date.now()
  const username = `j_${stamp}`
  await page.goto('/app/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `j_${stamp}@tradingsocial.io`)
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

test('log a closed trade and see it in the journal with computed R', async ({ page }) => {
  await signUpAndOnboard(page)
  await page.goto('/app/journal')
  await page.click('button:has-text("Log trade")')

  await page.fill('input[name="entry_price"]', '1.0856')
  await page.fill('input[name="stop_price"]', '1.0806')
  await page.fill('input[name="target_price"]', '1.0936')
  await page.fill('input[name="exit_price"]', '1.0936') // closes immediately, +1.6R win
  await page.click('button:has-text("Save trade")')

  // Row appears, marked win
  await expect(page.locator('table.ts-table')).toContainText('EUR/USD')
  await expect(page.locator('.ts-badge--win')).toBeVisible()
  await expect(page.locator('table.ts-table')).toContainText('1.60R')
})

test('log an open trade then close it', async ({ page }) => {
  await signUpAndOnboard(page)
  await page.goto('/app/journal')
  await page.click('button:has-text("Log trade")')
  await page.fill('input[name="entry_price"]', '1.1000')
  await page.fill('input[name="stop_price"]', '1.0950')
  await page.fill('input[name="target_price"]', '1.1100')
  await page.click('button:has-text("Save trade")') // no exit -> open

  await expect(page.locator('.ts-badge--open')).toBeVisible()
  await page.click('button:has-text("Close")')
  await page.fill('.ts-modal input.ts-input', '1.1100')
  await page.click('.ts-modal button:has-text("Close trade")')
  await expect(page.locator('.ts-badge--win')).toBeVisible()
})
