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

async function logout(page: Page) {
  await page.goto('/settings')
  await page.click('button:has-text("Log out")')
  await expect(page).toHaveURL(/\/login/)
}

// Sets the account balance (so money P&L computes) then logs one public winning trade
// risking `riskPercent`. With the same +R outcome, a larger balance => larger P&L.
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

test('two traders ranked by P&L on the leaderboard', async ({ page }) => {
  const userHigh = await signUpAndOnboard(page, 'lb_hi')
  await setupAndLogWin(page, '10000') // bigger balance -> bigger P&L
  await logout(page)

  const userLow = await signUpAndOnboard(page, 'lb_lo')
  await setupAndLogWin(page, '2000')  // smaller balance -> smaller P&L

  await page.goto('/leaderboard')

  // Search each trader (the board is paginated and shared across runs), then read
  // the rank cell of their row. Higher P&L must earn a smaller rank number.
  const search = page.locator('.lb-tsearch input')
  const rankOf = async (user: string) => {
    await search.fill(user)
    const row = page.locator('.lb-table tbody tr').first()
    await expect(row).toContainText(user)
    return parseInt((await row.locator('.lb-rk').innerText()).trim(), 10)
  }
  const hiRank = await rankOf(userHigh)
  const loRank = await rankOf(userLow)
  expect(hiRank).toBeLessThan(loRank)

  // Period switch still renders a board.
  await search.fill('')
  await page.click('.lb-seg:has-text("All time")')
  await expect(page.locator('.lb-table')).toBeVisible()
})

test('nav Leaderboard link opens the page', async ({ page }) => {
  await signUpAndOnboard(page, 'lb_nav')
  await page.click('.ts-navpills a:has-text("Leaderboard")')
  await expect(page).toHaveURL(/\/leaderboard/)
  await expect(page.locator('h1.ts-h1')).toContainText('Leaderboard')
})
