import { test, expect } from '@playwright/test'

async function signUp(page: import('@playwright/test').Page) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const username = `a_${stamp}`
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `a_${stamp}@tradingsocial.io`)
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

test('create a poll and vote on it', async ({ page }) => {
  await signUp(page)
  await page.fill('.h-composer textarea', 'Long or short EUR/USD today?')
  await page.click('.h-composer button:has-text("Poll")')
  const opts = page.locator('.h-composer input.h-input')
  await opts.nth(0).fill('Long')
  await opts.nth(1).fill('Short')
  await page.click('.h-composer button:has-text("Post")')

  // The just-created post is first in the feed (newest self post).
  const poll = page.locator('.h-trade').first().locator('.ts-poll')
  await expect(poll).toBeVisible()
  const longOpt = poll.locator('.ts-poll-opt', { hasText: 'Long' }).first()
  await longOpt.click()
  await expect(longOpt).toContainText('100%')
})

test('share a trade in a post', async ({ page }) => {
  await signUp(page)
  // log a trade first
  await page.goto('/journal')
  await page.locator('button:has-text("Log trade")').first().click()
  await page.waitForSelector('.ts-modal--wide')
  await page.click('button:has-text("Detailed")')
  await page.fill('input[name="entry_price"]', '1.0856')
  await page.fill('input[name="stop_price"]', '1.0806')
  await page.fill('input[name="target_price"]', '1.0936')
  await page.fill('input[name="exit_price"]', '1.0936')
  await page.click('.ts-modal--wide button:has-text("Save Trade")')
  await page.waitForSelector('.ts-modal--wide', { state: 'detached' })

  await page.goto('/')
  await page.fill('.h-composer textarea', 'Textbook London breakout')
  await page.click('.h-composer button:has-text("Attach trade")')
  await page.locator('.ts-picker-row', { hasText: 'EUR/USD' }).first().click()
  await page.click('.h-composer button:has-text("Post")')

  // Scope to OUR post: the global feed fallback can surface other tests'
  // posts (e.g. the poll spec) above ours.
  const post = page.locator('article', { hasText: 'Textbook London breakout' }).first()
  await expect(post).toContainText('EUR/USD')
  await expect(post).toContainText('1.6R')
})
