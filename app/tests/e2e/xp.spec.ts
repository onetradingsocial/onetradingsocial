import { test, expect, type Page } from '@playwright/test'

async function signUpAndOnboard(page: Page, prefix: string) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const username = `${prefix}_${stamp}`
  await page.goto('/app/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@tradingsocial.io`)
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

// Set the account balance, then log one public winning trade -> grants XP (base + daily quests).
async function setupAndLogWin(page: Page, balance: string) {
  await page.goto('/app/settings')
  await page.fill('input[name="account_balance"]', balance)
  await page.click('button:has-text("Save account")')

  await page.goto('/app/journal')
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

  await page.goto('/app/achievements')
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

  await page.goto('/app/leaderboard')
  await page.click('.lb-seg:has-text("XP")')
  await expect(page).toHaveURL(/cat=xp/)
  await expect(page.locator('.lb-panel')).toBeVisible()

  // The trader earned XP this week -> they appear on the XP board (search by handle).
  await page.locator('.lb-tsearch input').fill(user)
  const row = page.locator('.lb-table tbody tr').first()
  await expect(row).toContainText(user)
  await expect(row).toContainText(/Lvl \d+/)
})
