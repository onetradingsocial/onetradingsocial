import { test, expect } from '@playwright/test'

async function signUpAndOnboard(page: import('@playwright/test').Page) {
  const stamp = Date.now()
  const username = `j_${stamp}`
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `j_${stamp}@tradingsocial.io`)
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

test('log a closed trade and see it in the journal with computed R', async ({ page }) => {
  await signUpAndOnboard(page)
  await page.goto('/journal')
  await page.locator('button:has-text("Log trade")').first().click()
  await page.click('button:has-text("Detailed")')

  await page.fill('input[name="entry_price"]', '1.0856')
  await page.fill('input[name="stop_price"]', '1.0806')
  await page.fill('input[name="target_price"]', '1.0936')
  await page.fill('input[name="exit_price"]', '1.0936') // closes immediately, +1.6R win
  await page.click('button:has-text("Save trade")')

  // Row appears with computed R (+1.6R) and instrument
  await expect(page.locator('table.ts-table')).toContainText('EUR/USD')
  await expect(page.locator('table.ts-table')).toContainText('+1.6R')
})

test('quick mode logs a stop-less trade in seconds', async ({ page }) => {
  await signUpAndOnboard(page)
  await page.goto('/journal')
  await page.locator('button:has-text("Log trade")').first().click()
  // Quick is the default mode: entry, exit, lots — no stop required.
  await page.fill('input[name="entry_price"]', '1.0850')
  await page.fill('input[name="exit_price"]', '1.0900')
  await page.fill('input[name="lots"]', '0.5')
  await page.click('button:has-text("Save trade")')
  await expect(page.locator('table.ts-table')).toContainText('EUR/USD')
  // Verification badge travels with the manual trade.
  await expect(page.locator('table.ts-table .v-badge').first()).toContainText('Self-reported')
})

test('log an open trade then close it', async ({ page }) => {
  await signUpAndOnboard(page)
  await page.goto('/journal')
  await page.locator('button:has-text("Log trade")').first().click()
  await page.click('button:has-text("Detailed")')
  await page.fill('input[name="entry_price"]', '1.1000')
  await page.fill('input[name="stop_price"]', '1.0950')
  await page.fill('input[name="target_price"]', '1.1100')
  await page.click('button:has-text("Save trade")') // no exit -> open

  await expect(page.locator('.ts-badge--open')).toBeVisible()
  await page.click('button:has-text("Close")')
  await page.fill('.ts-modal input.ts-input', '1.1100')
  await page.click('.ts-modal button:has-text("Close trade")')
  await expect(page.locator('table.ts-table')).toContainText('+2.0R')
})
