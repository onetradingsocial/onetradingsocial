import { test, expect, type Page } from '@playwright/test'

async function signUpAndOnboard(page: Page, prefix: string) {
  // Keep usernames within the 3-20 char limit: short prefix + base36 time/random.
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36)
  const username = `${prefix}_${stamp}`.slice(0, 20)
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

// Learn hidden for now — we are not financial advisors. Un-skip when the feature is restored.
test.skip('passing the quiz grants XP and marks the lesson complete', async ({ page }) => {
  await signUpAndOnboard(page, 'lp')
  await page.goto('/learn/foundations/what-is-a-trade')
  await expect(page.getByRole('heading', { name: 'Quiz' })).toBeVisible()
  // Seeded correct answer for this lesson is the first option.
  await page.locator('.quiz-q').first().locator('input[type=radio]').first().check()
  await page.click('button:has-text("Submit answers")')
  await expect(page.locator('.quiz-pass')).toContainText('+100 XP')

  await page.reload()
  await expect(page.locator('.quiz-done')).toBeVisible()

  await page.goto('/achievements')
  await expect(page.getByText(/lesson.* completed/)).toContainText(/1 lesson/)
})

test.skip('a wrong answer does not complete the lesson', async ({ page }) => {
  await signUpAndOnboard(page, 'lf')
  await page.goto('/learn/foundations/reading-candles')
  // Correct answer for this lesson is option 2; pick option 1 (wrong).
  await page.locator('.quiz-q').first().locator('input[type=radio]').first().check()
  await page.click('button:has-text("Submit answers")')
  await expect(page.locator('.quiz-fail')).toBeVisible()
})
