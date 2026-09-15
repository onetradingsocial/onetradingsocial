import { test, expect, type Page } from '@playwright/test'
import { createServiceClient } from './utils/db'
import { signUpAndOnboard } from './utils/onboard'
import { SIGNUP_PASSWORD } from './utils/creds'

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

/** The Stripe trial a browser test cannot buy — see trial.spec.ts for why the
 *  subscription is written directly rather than bought through Checkout. */
async function giveStripeTrial(username: string, daysLeft = 9) {
  const svc = createServiceClient()
  const { data: prof, error: profErr } = await svc
    .from('profiles').select('id').eq('username', username).single()
  if (profErr || !prof) throw new Error(`no profile for ${username}: ${profErr?.message}`)

  const endsAt = new Date(Date.now() + daysLeft * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await svc.from('subscriptions').insert({
    id: `sub_e2e_${Date.now().toString(36)}`,
    user_id: prof.id,
    status: 'trialing',
    tier: 'pro',
    price_id: process.env.STRIPE_PRICE_PRO_MONTHLY ?? 'price_e2e_pro_monthly',
    current_period_end: endsAt,
    trial_start: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    trial_end: endsAt,
    cancel_at_period_end: false,
  })
  if (error) throw new Error(`could not create Stripe trial: ${error.message}`)
}

// The tier a fresh account lands on changed. Signing up no longer hands out a
// trial — /welcome offers one, and the helper above takes the decline route
// because the accept route goes to Stripe. So the popup a new user sees is the
// FREE variant, and the Pro variant needs a trial to exist first.

test('shows the Free variant to someone who declined the trial', async ({ page }) => {
  await signUpAndOnboard(page)
  const modal = page.getByRole('dialog', { name: 'Welcome to free' })
  await expect(modal).toBeVisible()
  await expect(modal).toContainText("You're on Free")
  await expect(modal).toContainText('A$0 / month')
})

test('shows the Pro variant with a trial-honest price to a trialist', async ({ page }) => {
  const username = await signUpAndOnboard(page)
  await giveStripeTrial(username)
  await page.reload()

  const modal = page.getByRole('dialog', { name: 'Welcome to pro' })
  await expect(modal).toBeVisible()
  await expect(modal).toContainText("You're on Pro Trader")
  // The entire reason for the price override: a trialist who has been charged
  // A$0 must not be shown A$50 / month as though it had already been taken.
  // This used to read "then choose a plan", which was true of the card-free
  // trial and wrong for a Stripe one, where the plan is already chosen.
  await expect(modal).toContainText('14 days free · nothing charged yet')
  await expect(modal).not.toContainText('A$50 / month')
})

test('reveals every feature and fills the counter to match', async ({ page }) => {
  await signUpAndOnboard(page)
  const modal = popup(page)

  // Counted, not hardcoded. This used to assert exactly 6 because every new
  // account was Pro, and Pro lists six; a fresh account now lands on Free,
  // which lists seven. The number was never what the test was for — the
  // invariant is that the reveal sequence finishes and the counter agrees with
  // what is on screen, which holds for whichever tier the popup is showing.
  const count = await modal.locator('.wpop-feat').count()
  expect(count).toBeGreaterThan(0)
  // The reveal sequence finishes around 3.8s.
  await expect(modal).toContainText(`${count} / ${count}`, { timeout: 10000 })
})

test('does not reappear after dismissal', async ({ page }) => {
  const username = await signUpAndOnboard(page)
  await expect(popup(page)).toBeVisible()
  await page.locator('.wpop-close').click()
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
  // Wait for the ack to actually persist before reloading — otherwise the
  // reload can outrun the fire-and-forget write, the server recomputes
  // welcome.show = true, and the popup deterministically resurfaces.
  await expectAcked(username, 'free')
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
  // A fresh account is now on Free, whose CTA is "Explore your Profile" and
  // resolves to /{username} (WELCOME_TIERS.free carries an empty href on
  // purpose — the handle is only known at render). The component awaits
  // ackWelcome() before calling router.push, so this needs a generous timeout.
  await expect(page).toHaveURL(new RegExp(`/${username}`), { timeout: 15000 })
  await expectAcked(username, 'free')
})

test('records the tier so a reload after "Maybe later" stays quiet', async ({ page }) => {
  const username = await signUpAndOnboard(page)
  await expect(popup(page)).toBeVisible()
  await page.locator('.wpop-secondary').click()
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
  await expectAcked(username, 'free')
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
  await page.fill('input[name="password"]', SIGNUP_PASSWORD)
  await page.locator('label.fl-terms .fl-check').click()
  await page.click('button:has-text("Join the Beta")')
  await expect(page).toHaveURL(/\/welcome/, { timeout: 15000 })
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
  await page.click('button:has-text("Continue on Free")')
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 })
  await expect(page.locator('.wpop-backdrop')).toHaveCount(0)
})
