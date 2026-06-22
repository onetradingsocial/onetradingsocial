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

test('passing the quiz grants XP and marks the lesson complete', async ({ page }) => {
  await signUpAndOnboard(page, 'learn')
  await page.goto('/app/learn/foundations/what-is-a-trade')
  await expect(page.getByRole('heading', { name: 'Quiz' })).toBeVisible()
  // Seeded correct answer for this lesson is the first option.
  await page.locator('.quiz-q').first().locator('input[type=radio]').first().check()
  await page.click('button:has-text("Submit answers")')
  await expect(page.locator('.quiz-pass')).toContainText('+100 XP')

  await page.reload()
  await expect(page.locator('.quiz-done')).toBeVisible()

  await page.goto('/app/achievements')
  await expect(page.getByText(/lesson.* completed/)).toContainText(/1 lesson/)
})

test('a wrong answer does not complete the lesson', async ({ page }) => {
  await signUpAndOnboard(page, 'learnfail')
  await page.goto('/app/learn/foundations/reading-candles')
  // Correct answer for this lesson is option 2; pick option 1 (wrong).
  await page.locator('.quiz-q').first().locator('input[type=radio]').first().check()
  await page.click('button:has-text("Submit answers")')
  await expect(page.locator('.quiz-fail')).toBeVisible()
})
