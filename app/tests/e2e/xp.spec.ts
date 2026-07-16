import { test, expect, type Page } from '@playwright/test'

async function signUpAndOnboard(page: Page, prefix: string) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const username = `${prefix}_${stamp}`
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@tradingsocial.io`)
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

// Set the account balance, then log one public winning trade -> grants XP (base + daily quests).
async function setupAndLogWin(page: Page, balance: string) {
  await page.goto('/settings')
  await page.fill('input[name="account_balance"]', balance)
  await page.click('button:has-text("Save account")')

  await page.goto('/journal')
  await page.locator('button:has-text("Log trade")').first().click()
  await page.fill('input[name="risk_percent"]', '1')
  await page.fill('input[name="entry_price"]', '1.0856')
  await page.fill('input[name="stop_price"]', '1.0806')
  await page.fill('input[name="target_price"]', '1.0936')
  await page.fill('input[name="exit_price"]', '1.0936') // closes as a win
  await page.click('button:has-text("Save trade")')
  await expect(page.locator('table.ts-table')).toContainText('EUR/USD')
}

test('achievements page shows level, quests, and badges after a trade', async ({ page }) => {
  await signUpAndOnboard(page, 'xp_ach')
  await setupAndLogWin(page, '10000')

  await page.goto('/achievements')
  await expect(page.getByRole('heading', { name: 'Achievements' })).toBeVisible()
  // Closed one trade today -> XP earned, daily quests complete, First Trade badge earned.
  await expect(page.getByText(/XP total/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Daily quests' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Weekly quests' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Badges' })).toBeVisible()
  await expect(page.locator('.badge.earned').first()).toBeVisible()
})

test('leaderboard XP tab switches and renders the XP board with the trader', async ({ page }) => {
  const user = await signUpAndOnboard(page, 'xp_lb')
  await setupAndLogWin(page, '5000')

  await page.goto('/leaderboard')
  await page.click('.lb-seg:has-text("XP")')
  await expect(page).toHaveURL(/cat=xp/)
  await expect(page.locator('.lb-panel')).toBeVisible()

  // The trader earned XP this week -> they appear on the XP board (search by handle).
  await page.locator('.lb-tsearch input').fill(user)
  const row = page.locator('.lb-table tbody tr').first()
  await expect(row).toContainText(user)
  await expect(row).toContainText(/Lvl \d+/)
})
