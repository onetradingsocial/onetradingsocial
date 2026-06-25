import { test, expect } from '@playwright/test'

const stamp = Date.now()
const username = `e2e_${stamp}`
const email = `e2e_${stamp}@tradingsocial.io`
const password = 'password123'

test('signup -> onboarding -> profile, then logout', async ({ page }) => {
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.check('input[name="terms"]')
  await page.click('button:has-text("Join the Beta")')

  // Onboarding
  await expect(page).toHaveURL(/\/onboarding/)
  await page.locator('label.ts-chip', { hasText: 'forex' }).click()
  await page.fill('input[name="goal"]', 'Get consistent')
  await page.click('button:has-text("Finish")')

  // Landed in app
  await expect(page).toHaveURL('/')

  // Public profile renders
  await page.goto(`/${username}`)
  await expect(page.locator('text=@' + username)).toBeVisible()
})

test('unauthed protected route redirects to login', async ({ page }) => {
  await page.context().clearCookies()
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/login/)
})

test('reserved username is rejected at signup', async ({ page }) => {
  await page.goto('/signup')
  await page.fill('input[name="username"]', 'login')
  await page.fill('input[name="email"]', `r_${Date.now()}@tradingsocial.io`)
  await page.fill('input[name="password"]', 'password123')
  await page.check('input[name="terms"]')
  await page.click('button:has-text("Join the Beta")')
  await expect(page.locator('text=That username is reserved.')).toBeVisible()
})
