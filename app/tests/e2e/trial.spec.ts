import { test, expect } from '@playwright/test'
import { createServiceClient } from './utils/db'
import { dismissWelcome } from './utils/welcome'
import { SIGNUP_PASSWORD } from './utils/creds'

// The wall only renders when the kill switch is on. Skip rather than fail when
// the dev server was started without it.
const WALL = process.env.TRIAL_WALL_ENABLED === 'true'

async function signUpAndOnboard(page: import('@playwright/test').Page) {
  const stamp = Date.now().toString(36)
  const username = `t_${stamp}`
  const email = `t_${stamp}@tradingsocial.io`
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', SIGNUP_PASSWORD)
  await page.locator('label.fl-terms .fl-check').click()
  await expect(page.locator('input[name="terms"]')).toBeChecked()
  await page.click('button:has-text("Join the Beta")')
  // Trial welcome step — 14 days of Pro, no card
  await expect(page).toHaveURL(/\/welcome/, { timeout: 15000 })
  await page.click('button:has-text("Start my trial")')
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
  await dismissWelcome(page)
  return username
}

async function expireTrial(username: string) {
  const svc = createServiceClient()
  const { error } = await svc
    .from('profiles')
    .update({
      trial_started_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      trial_ack_at: null,
    })
    .eq('username', username)
  if (error) throw new Error(`could not expire trial: ${error.message}`)
}

const wall = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: /days of Pro have ended/i })

test('a new user is on the Pro trial, not Free', async ({ page }) => {
  await signUpAndOnboard(page)
  await page.goto('/settings/billing')
  await expect(page.locator('.ts-sub')).toContainText('Pro Trader')
})

test('an expired trial walls the app and cannot be escaped', async ({ page }) => {
  test.skip(!WALL, 'requires TRIAL_WALL_ENABLED=true on the dev server')
  const username = await signUpAndOnboard(page)
  await expireTrial(username)

  await page.goto('/')
  await expect(wall(page)).toBeVisible()

  // Assert the modal's complete interactive button set rather than the absence
  // of one named "Close" — an absence check only rules out that exact label,
  // so a regression that adds an icon-only close button (or any other new
  // control) under a different aria-label would silently slip past it while
  // the wall became escapable. An exact-set check fails on ANY added button.
  const modalButtonTexts = (await page.locator('.tg-modal button').allTextContents()).map((t) => t.trim())
  expect(modalButtonTexts).toEqual([
    'Monthly',
    'Annual',
    'Subscribe to Trader',
    'Subscribe to Pro Trader',
    'Continue on Free',
  ])
  await page.keyboard.press('Escape')
  await expect(wall(page)).toBeVisible()
  await page.locator('.tg-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(wall(page)).toBeVisible()

  // It follows the user around the app…
  for (const path of ['/journal', '/leaderboard']) {
    await page.goto(path)
    await expect(wall(page)).toBeVisible()
  }
  // …except on billing, where Subscribe has to land.
  await page.goto('/settings/billing')
  await expect(wall(page)).toHaveCount(0)
})

test('Continue on Free clears the wall for good', async ({ page }) => {
  test.skip(!WALL, 'requires TRIAL_WALL_ENABLED=true on the dev server')
  const username = await signUpAndOnboard(page)
  await expireTrial(username)

  await page.goto('/')
  await expect(wall(page)).toBeVisible()
  await page.click('button:has-text("Continue on Free")')
  await expect(wall(page)).toHaveCount(0)

  await page.reload()
  await expect(wall(page)).toHaveCount(0)
  await page.goto('/settings/billing')
  await expect(page.locator('.ts-sub')).toContainText('Free')
})
