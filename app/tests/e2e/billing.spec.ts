import { test, expect } from '@playwright/test'

// Guard: skip Stripe-dependent tests when keys are absent.
const STRIPE = !!process.env.STRIPE_SECRET_KEY

async function signUpAndOnboard(page: import('@playwright/test').Page) {
  // Username prefix 'b' keeps it short; base-36 timestamp fits well within 20 chars.
  const stamp = Date.now().toString(36)
  const username = `b_${stamp}`
  const email = `b_${stamp}@tradingsocial.io`
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', email)
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

// ─── Test 1: Free tier ───────────────────────────────────────────────────────
// Runs without Stripe keys.  getTier fails closed to 'free', so this works
// even without migration 0009 applied.
test('free user sees Free plan and Upgrade button on billing page', async ({ page }) => {
  await signUpAndOnboard(page)
  await page.goto('/settings/billing')
  await expect(page.getByText('Current plan:')).toContainText('Free')
  await expect(page.getByRole('button', { name: /Upgrade to Trader/i })).toBeVisible()
})

// ─── Test 2: Checkout completion (Stripe-guarded) ───────────────────────────
// Requires: STRIPE_SECRET_KEY set + `stripe listen --forward-to localhost:3000/api/stripe/webhook`
// NOTE: Stripe-hosted Checkout field selectors (cardNumber, cardExpiry, cardCvc,
// hosted-payment-submit-button) may need tuning against the live Checkout DOM —
// Stripe periodically updates its hosted page markup.
test('checkout with test card upgrades plan to Trader', async ({ page }) => {
  test.skip(!STRIPE, 'requires Stripe test keys + stripe listen forwarding')

  await signUpAndOnboard(page)
  await page.goto('/settings/billing')

  // Click Upgrade — redirects to Stripe-hosted Checkout
  await page.getByRole('button', { name: /Upgrade to Trader/i }).click()

  // Fill Stripe-hosted Checkout fields (selectors subject to Stripe DOM changes)
  await page.fill('input[name="cardNumber"]', '4242424242424242')
  await page.fill('input[name="cardExpiry"]', '12 / 34')
  await page.fill('input[name="cardCvc"]', '123')
  // Some Checkout sessions also ask for name on card and postal code:
  // await page.fill('input[name="billingName"]', 'Test User')
  // await page.fill('input[name="postalCode"]', '10001')
  await page.getByTestId('hosted-payment-submit-button').click()

  // Stripe redirects back to success_url after payment
  await page.waitForURL(/\/settings\/billing\?status=success/, { timeout: 30_000 })

  // Webhook delivery is async — reload until the tier reflects 'Trader'
  await expect(async () => {
    await page.reload()
    await expect(page.getByText('Current plan:')).toContainText('Trader')
  }).toPass({ timeout: 15_000 })
})
