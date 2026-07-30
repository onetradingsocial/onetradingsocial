import { test, expect, type Page } from '@playwright/test'
import { createServiceClient } from './utils/db'
import { signUpAndOnboard } from './utils/onboard'

const WALL = process.env.TRIAL_WALL_ENABLED === 'true'

async function seedProfile(username: string, row: Record<string, unknown>) {
  const { error } = await createServiceClient().from('profiles').update(row).eq('username', username)
  if (error) throw new Error(`could not seed profile: ${error.message}`)
}

const popup = (page: Page) => page.getByRole('dialog', { name: /^Welcome to/ })

// close('later') / close('close') fire ackWelcome() fire-and-forget, then remove
// the backdrop after a fixed 300ms — the client-side "backdrop is gone" signal
// and the server-side "the Supabase write landed" signal are independent async
// chains. A single non-retried read right after the backdrop disappears can
// easily lose that race (especially on a cold dev server), so poll instead of
// assuming the write has landed.
async function expectAcked(username: string, tier: string) {
  await expect.poll(async () => {
    const { data } = await createServiceClient()
      .from('profiles').select('welcome_tier_seen').eq('username', username).single()
    return data?.welcome_tier_seen ?? null
  }, { timeout: 15000, message: 'ackWelcome should persist welcome_tier_seen' }).toBe(tier)
}

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
  const username = await signUpAndOnboard(page)
  await expect(popup(page)).toBeVisible()
  await page.locator('.wpop-close').click()
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
  // Wait for the ack to actually persist before reloading — otherwise the
  // reload can outrun the fire-and-forget write, the server recomputes
  // welcome.show = true, and the popup deterministically resurfaces.
  await expectAcked(username, 'pro')
  await page.reload()
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
})

// Guards the fix in WelcomeModal.handleCta: a bare <a href> plus an
// un-awaited server action used to be aborted by the navigation it triggered,
// so welcome_tier_seen never persisted on the most common dismissal path and
// the popup returned forever. The component now preventDefaults, awaits the
// ack, then navigates itself via the router.
test('clicking the CTA navigates and persists the ack', async ({ page }) => {
  const username = await signUpAndOnboard(page)
  await expect(popup(page)).toBeVisible()
  await page.locator('.wpop-cta').click()
  // A fresh trial user is on the Pro tier, whose CTA href is /journal. The
  // component awaits ackWelcome() before calling router.push, so this needs a
  // generous timeout rather than the default.
  await expect(page).toHaveURL(/\/journal/, { timeout: 15000 })
  await expectAcked(username, 'pro')
})

test('records the tier so a reload after "Maybe later" stays quiet', async ({ page }) => {
  const username = await signUpAndOnboard(page)
  await expect(popup(page)).toBeVisible()
  await page.locator('.wpop-secondary').click()
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
  await expectAcked(username, 'pro')
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

// This passes via the `!onboarded` gate in shouldShowWelcome (the user's
// onboarding_completed is still false throughout this test), NOT because of
// WelcomeModal's EXEMPT_PATHS check. EXEMPT_PATHS is belt-and-braces defence
// that no e2e test can reach: an onboarded user cannot land on /onboarding or
// /welcome at all, since both pages redirect them straight to '/' when
// profile.onboarding_completed is true. So this test would still pass if
// EXEMPT_PATHS were deleted entirely — it only proves the popup stays away
// during the signup funnel, not that the exempt-path check works.
test('no popup anywhere in the signup funnel', async ({ page }) => {
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
