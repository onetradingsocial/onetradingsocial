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

async function logout(page: Page) {
  await page.goto('/app/settings')
  await page.click('button:has-text("Log out")')
  await expect(page).toHaveURL(/\/app\/login/)
}

// Sets the account balance (so money P&L computes) then logs one public winning trade
// risking `riskPercent`. With the same +R outcome, a larger balance => larger P&L.
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

test('two traders ranked by P&L on the leaderboard', async ({ page }) => {
  const userHigh = await signUpAndOnboard(page, 'lb_hi')
  await setupAndLogWin(page, '10000') // bigger balance -> bigger P&L
  await logout(page)

  const userLow = await signUpAndOnboard(page, 'lb_lo')
  await setupAndLogWin(page, '2000')  // smaller balance -> smaller P&L

  await page.goto('/app/leaderboard')

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
  await expect(page).toHaveURL(/\/app\/leaderboard/)
  await expect(page.locator('h1.ts-h1')).toContainText('Leaderboard')
})
