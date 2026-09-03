import { test, expect, type Page } from '@playwright/test'
import { dismissWelcome } from './utils/welcome'

const DOMAIN = 'search.tradingsocial.test'

async function signUp(page: Page, prefix: string, opts: { private?: boolean } = {}) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36)
  const username = `${prefix}_${stamp}`.slice(0, 20)
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@${DOMAIN}`)
  await page.fill('input[name="password"]', 'password123')
  await page.locator('label.fl-terms .fl-check').click()
  await expect(page.locator('input[name="terms"]')).toBeChecked()
  await page.click('button:has-text("Join the Beta")')
  // Trial welcome step — 14 days of Pro, no card
  await expect(page).toHaveURL(/\/welcome/, { timeout: 15000 })
  await page.click('button:has-text("Start my trial")')
  // Onboarding multi-step flow (5 steps + reveal)
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 })
  await page.click('button:has-text("Build my identity")')
  await page.click('button:has-text("Forex")')
  await page.click('button:has-text("Continue")')
  await page.click('button:has-text("Beginner")')
  await page.click('button:has-text("Continue")')
  await page.click('button:has-text("Build consistency")')
  await page.click('button:has-text("Continue")')
  // The visibility step. This was hardcoded to Public while a caller was already
  // passing { private: true }, so the "private trader and their posts do NOT
  // appear in search" test signed up a PUBLIC account and then asserted it was
  // absent from search — it could pass without the privacy filter existing at
  // all. Private is selectable here because signup starts a Pro trial;
  // resolveVisibility() forces public on the free plan.
  await page.click(opts.private ? 'button:has-text("Private")' : 'button:has-text("Public")')
  await page.click('button:has-text("Continue")')
  await page.click('button:has-text("Log trades manually")')
  await page.click('button:has-text("Create my profile")')
  await page.click('button:has-text("Enter TradingSocial")')
  await expect(page).toHaveURL('/', { timeout: 15000 })
  await dismissWelcome(page)
  return username
}

async function logout(page: Page) {
  await page.goto('/settings')
  await page.click('button:has-text("Log out")')
  await expect(page).toHaveURL(/\/login/)
}

test('finds a public trader by username', async ({ page }) => {
  const userA = await signUp(page, 'pub')
  await logout(page)

  await signUp(page, 'seek')
  await page.fill('.ts-search input', userA)
  await expect(page.locator('.ts-search-dropdown')).toContainText(`@${userA}`)
})

test('finds a public post by keyword', async ({ page }) => {
  const keyword = `breakoutkw${Date.now().toString(36)}`
  await signUp(page, 'poster')
  await page.fill('.h-composer textarea', `A clean ${keyword} setup on EURUSD`)
  await page.click('.h-composer button:has-text("Post")')
  await expect(page.locator('.h-trade').first()).toContainText(keyword)
  await logout(page)

  await signUp(page, 'seek')
  await page.fill('.ts-search input', keyword)
  await expect(page.locator('.ts-search-dropdown')).toContainText(keyword)
})

test('does not open dropdown for under 2 chars', async ({ page }) => {
  await signUp(page, 'short')
  await page.fill('.ts-search input', 'a')
  await expect(page.locator('.ts-search-dropdown')).toHaveCount(0)
})

test('clicking a trader result navigates to their profile', async ({ page }) => {
  const userA = await signUp(page, 'navtgt')
  await logout(page)

  await signUp(page, 'seek')
  await page.fill('.ts-search input', userA)
  await page.locator('.ts-search-dropdown .ts-search-row', { hasText: `@${userA}` }).first().click()
  await expect(page).toHaveURL(new RegExp(`/${userA}$`))
})

test('private trader and their posts do NOT appear in search', async ({ page }) => {
  const priv = await signUp(page, 'priv', { private: true })
  const keyword = `secretkw${Date.now().toString(36)}`
  await page.fill('.h-composer textarea', `My ${keyword} private idea`)
  await page.click('.h-composer button:has-text("Post")')
  await expect(page.locator('.h-trade').first()).toContainText(keyword)
  await logout(page)

  await signUp(page, 'seek')
  // search the private user's name → no trader result
  await page.fill('.ts-search input', priv)
  await expect(page.locator('.ts-search-dropdown')).toContainText('No results')
  // search the private post keyword → no post result
  await page.fill('.ts-search input', keyword)
  await expect(page.locator('.ts-search-dropdown')).toContainText('No results')
})
