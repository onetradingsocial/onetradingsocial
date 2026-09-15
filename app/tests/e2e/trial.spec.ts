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
  await page.click('button:has-text("Continue on Free")')
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

/** Give a user the Stripe trial a browser test cannot buy.
 *
 *  The real route to a trial is Stripe Checkout, which Playwright cannot
 *  complete — there is a card form on a domain we do not control. So the
 *  subscription is written directly, exactly as `expireTrial` writes the legacy
 *  trial's timestamps. What is under test is everything DOWNSTREAM of the
 *  subscription existing: the tier it grants, and what the app tells the person
 *  about the charge coming. */
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
    // NOT first_paid_at: a trial has taken no money, and leaving it null is what
    // withholds dunning grace if the conversion charge later declines.
  })
  if (error) throw new Error(`could not create Stripe trial: ${error.message}`)
}

// ── What signing up actually does now ──────────────────────────────────────
//
// This file used to assert "a new user is on the Pro trial, not Free". That was
// true while every account was handed a trial automatically. It is not any more:
// the trial is a Stripe subscription, it starts at Checkout, and /welcome offers
// a way past it. The two tests below are the two real outcomes.

test('declining the trial really does leave you on Free', async ({ page }) => {
  // Load-bearing, not incidental. Terms §7 says the Free plan is free forever
  // and needs no payment details, and two for/ landing pages say the same. All
  // of that is only true while someone can get past /welcome WITHOUT entering a
  // card — so this asserts the affordance those promises depend on.
  await signUpAndOnboard(page)
  await page.goto('/settings/billing')
  await expect(page.locator('.ts-sub')).toContainText('Free')
  await expect(page.locator('.ts-sub')).not.toContainText('Pro trial')
})

test('a Stripe trial grants Pro and says what will be charged', async ({ page }) => {
  const username = await signUpAndOnboard(page)
  await giveStripeTrial(username)

  await page.goto('/settings/billing')
  const sub = page.locator('.ts-sub')

  // The tier the subscription grants.
  await expect(sub).toContainText('Pro trial')

  // And the disclosure. This page used to fall through to the paid branch for a
  // Stripe trialist and tell someone who has paid nothing that their plan
  // "renews" — on the day of their first charge. It must now name the charge
  // and the way out of it.
  await expect(sub).toContainText('will be charged')
  await expect(sub).toContainText(/cancel before then/i)
  await expect(sub).not.toContainText('Renews')

  // The countdown chip reaches a Stripe trialist too. Without it, someone with
  // a card on file has no sign anywhere in the app that a charge is coming.
  await expect(page.locator('.ts-trial-chip')).toContainText(/\d+d left/)
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
