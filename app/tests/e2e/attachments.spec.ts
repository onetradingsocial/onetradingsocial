import { test, expect } from '@playwright/test'

async function signUp(page: import('@playwright/test').Page) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const username = `a_${stamp}`
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `a_${stamp}@tradingsocial.io`)
  await page.fill('input[name="password"]', 'password123')
  await page.check('input[name="terms"]')
  await page.click('button:has-text("Join the Beta")')
  await expect(page).toHaveURL(/\/onboarding/)
  await page.locator('label.ts-chip', { hasText: 'forex' }).click()
  await page.fill('input[name="goal"]', 'Be consistent')
  await page.click('button:has-text("Finish")')
  await expect(page).toHaveURL('/')
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

  const card = page.locator('.h-trade').first()
  await expect(card).toContainText('EUR/USD')
  await expect(card).toContainText('1.6R')
})
