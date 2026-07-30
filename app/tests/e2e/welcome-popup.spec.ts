import { test, expect, type Page } from '@playwright/test'
import { createServiceClient } from './utils/db'
import { signUpAndOnboard } from './utils/onboard'

const WALL = process.env.TRIAL_WALL_ENABLED === 'true'

async function seedProfile(username: string, row: Record<string, unknown>) {
  const { error } = await createServiceClient().from('profiles').update(row).eq('username', username)
  if (error) throw new Error(`could not seed profile: ${error.message}`)
}

const popup = (page: Page) => page.getByRole('dialog', { name: /^Welcome to/ })

test('shows the Pro variant with a trial-honest price after onboarding', async ({ page }) => {
  await signUpAndOnboard(page)
  const modal = page.getByRole('dialog', { name: 'Welcome to pro' })
  await expect(modal).toBeVisible()
  await expect(modal).toContainText("You're on Pro Trader")
  // The entire reason for the price override: a no-card trialist must not be
  // told they are being billed $50/month.
  await expect(modal).toContainText('14 days free · then choose a plan')
  await expect(modal).not.toContainText('$50 / month')
})

test('shows the six features and fills the counter to 6 / 6', async ({ page }) => {
  await signUpAndOnboard(page)
  const modal = popup(page)
  await expect(modal.locator('.wpop-feat')).toHaveCount(6)
  // The reveal sequence finishes around 3.8s.
  await expect(modal).toContainText('6 / 6', { timeout: 10000 })
})

test('does not reappear after dismissal', async ({ page }) => {
  await signUpAndOnboard(page)
  await expect(popup(page)).toBeVisible()
  await page.locator('.wpop-close').click()
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
})

test('records the tier so a reload after "Maybe later" stays quiet', async ({ page }) => {
  const username = await signUpAndOnboard(page)
  await expect(popup(page)).toBeVisible()
  await page.locator('.wpop-secondary').click()
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
  const { data } = await createServiceClient()
    .from('profiles').select('welcome_tier_seen').eq('username', username).single()
  expect(data?.welcome_tier_seen).toBe('pro')
})

test('stays hidden while the end-of-trial wall is up', async ({ page }) => {
  test.skip(!WALL, 'requires TRIAL_WALL_ENABLED=true on the dev server')
  const username = await signUpAndOnboard(page)
  await page.locator('.wpop-close').click()
  // Expire the trial AND reset the celebrated tier, so the only thing keeping
  // the popup away is the wall suppression itself.
  await seedProfile(username, {
    trial_started_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    trial_ack_at: null,
    welcome_tier_seen: 'pro',
  })
  await page.goto('/')
  await expect(page.locator('.tg-backdrop')).toBeVisible()
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
})

test('does not cover the onboarding flow', async ({ page }) => {
  const stamp = Date.now().toString(36)
  await page.goto('/signup')
  await page.fill('input[name="username"]', `n_${stamp}`)
  await page.fill('input[name="email"]', `n_${stamp}@tradingsocial.io`)
  await page.fill('input[name="password"]', 'password123')
  await page.locator('label.fl-terms .fl-check').click()
  await page.click('button:has-text("Join the Beta")')
  await expect(page).toHaveURL(/\/welcome/, { timeout: 15000 })
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
  await page.click('button:has-text("Start my trial")')
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 })
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
})
