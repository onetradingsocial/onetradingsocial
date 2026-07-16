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
  await page.locator('label.fl-terms .fl-check').click()
  await expect(page.locator('input[name="terms"]')).toBeChecked()
  await page.click('button:has-text("Join the Beta")')
  await expect(page.locator('text=That username is reserved.')).toBeVisible()
})
