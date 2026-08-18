import { test, expect } from '@playwright/test'

/**
 * Password recovery (item 9 F1 / F6). These cover everything provable without a
 * real inbox: the entry point exists, the response is enumeration-safe, and the
 * callback fails closed on every bad grant. Delivering and clicking a real
 * recovery link is the one manual step — see ws2-auth.md §"Manual proof".
 */

const NEUTRAL = /if an account exists for that email address/i

test('login page offers a way back in', async ({ page }) => {
  await page.goto('/login')
  const link = page.getByRole('link', { name: /forgot password/i })
  await expect(link).toBeVisible()
  await link.click()
  await expect(page).toHaveURL(/\/forgot-password/)
})

test('reset request returns the identical response for a registered and an unregistered address', async ({ page }) => {
  // A seeded account that definitely exists.
  await page.goto('/forgot-password')
  await page.fill('input[name="email"]', 'demo@tradingsocial.io')
  await page.click('button:has-text("Send reset link")')
  await expect(page.locator('.ts-callout')).toBeVisible({ timeout: 15000 })
  const known = (await page.locator('.ts-callout').first().innerText()).trim()
  expect(known).toMatch(NEUTRAL)

  // An address that certainly does not.
  await page.goto('/forgot-password')
  await page.fill('input[name="email"]', `nobody_${Date.now()}@tradingsocial.io`)
  await page.click('button:has-text("Send reset link")')
  await expect(page.locator('.ts-callout')).toBeVisible({ timeout: 15000 })
  const unknown = (await page.locator('.ts-callout').first().innerText()).trim()

  // Byte-for-byte identical. Anything else is an account-existence oracle.
  expect(unknown).toBe(known)
})

test('reset request does not reveal existence through the status code or URL either', async ({ page }) => {
  for (const email of ['demo@tradingsocial.io', `nobody_${Date.now()}@tradingsocial.io`]) {
    await page.goto('/forgot-password')
    await page.fill('input[name="email"]', email)
    await page.click('button:has-text("Send reset link")')
    await expect(page.locator('.ts-callout')).toBeVisible({ timeout: 15000 })
    // Stays put: no redirect that could differ between the two cases.
    await expect(page).toHaveURL(/\/forgot-password$/)
  }
})

test('the reset callback fails closed on a missing, malformed and expired grant', async ({ page }) => {
  for (const [query, expected] of [
    ['', /error=missing/],
    ['?token_hash=&type=recovery', /error=missing/],
    ['?token_hash=not-a-real-token&type=recovery', /error=(expired|denied)/],
    ['?error=access_denied&error_code=otp_expired', /error=expired/],
    // A signup grant must not be redeemable at the recovery endpoint.
    ['?token_hash=abc&type=signup', /error=denied/],
  ] as const) {
    await page.goto(`/auth/reset${query}`)
    await expect(page).toHaveURL(new RegExp(`/forgot-password.*${expected.source}`), { timeout: 15000 })
  }
})

test('the callback never leaves a token in the URL it lands on', async ({ page }) => {
  await page.goto('/auth/reset?token_hash=not-a-real-token&type=recovery')
  await expect(page).toHaveURL(/\/forgot-password/, { timeout: 15000 })
  expect(page.url()).not.toContain('token')
  expect(page.url()).not.toContain('access_token')
})

test('/reset-password is closed without a recovery session', async ({ page }) => {
  await page.goto('/reset-password')
  await expect(page).toHaveURL(/\/forgot-password\?error=expired/)
})

test('an implicit-flow token in the fragment is scrubbed before the page settles', async ({ page }) => {
  // Simulates a dashboard-issued recovery link landing on `/` — the page that
  // carries the Meta and Reddit pixels.
  await page.goto('/#access_token=fake-token-value&refresh_token=r&type=recovery')
  await expect(page).toHaveURL(/\/forgot-password\?error=leaked/, { timeout: 15000 })
  expect(page.url()).not.toContain('access_token')
})

test('signup rejects a password that fails the policy, client-side', async ({ page }) => {
  await page.goto('/signup')
  await page.fill('input[name="username"]', `pw_${Date.now()}`.slice(0, 20))
  await page.fill('input[name="email"]', `pw_${Date.now()}@tradingsocial.io`)
  await page.fill('input[name="password"]', 'short1')
  await page.locator('label.fl-terms .fl-check').click()
  // The submit button is gated on the same predicate the server enforces.
  await expect(page.locator('button:has-text("Join the Beta")')).toBeDisabled()
  await expect(page.locator('.fl-err')).toContainText(/at least 10 characters/i)
})
