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
  await expect(page).toHaveURL(/\/select-plan/, { timeout: 15000 })
  await page.click('button:has-text("Continue with Free")')
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

test('hovering a follow notification opens the trader card', async ({ page }) => {
  // User A exists and will receive the notification.
  const userA = await signUpAndOnboard(page, 'hov_a')
  await logout(page)

  // User B follows A from A's profile page.
  await signUpAndOnboard(page, 'hov_b')
  await page.goto(`/${userA}`)
  await page.click('button:has-text("Follow")')
  await logout(page)

  // A logs in and opens the notification bell.
  await page.goto('/login')
  await page.fill('input[name="email"]', `${userA}@tradingsocial.io`)
  await page.fill('input[name="password"]', 'password123')
  await page.click('button:has-text("Log in")')
  await expect(page).toHaveURL('/', { timeout: 15000 })

  await page.click('.ts-notif-bell')
  const row = page.locator('.ts-notif-row-link').first()
  await expect(row).toBeVisible()

  // Hover opens the card (300ms open delay in TraderHoverCard).
  await row.hover()
  await expect(page.locator('.thc-card')).toBeVisible({ timeout: 4000 })
  // Card header is a profile link.
  await expect(page.locator('.thc-card a.thc-id')).toBeVisible()
})
