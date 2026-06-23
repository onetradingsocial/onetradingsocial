import { test, expect, type Page } from '@playwright/test'

// Measures perceived page-switch latency: time from clicking a nav pill
// until the destination's <h1> is visible (i.e. the server render arrived).
async function signUpAndOnboard(page: Page, prefix: string) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const username = `${prefix}_${stamp}`
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@tradingsocial.io`)
  await page.fill('input[name="password"]', 'password123')
  await page.check('input[name="terms"]')
  await page.click('button:has-text("Join the Beta")')
  await expect(page).toHaveURL(/\/onboarding/)
  await page.locator('label.ts-chip', { hasText: 'forex' }).click()
  await page.fill('input[name="goal"]', 'Be consistent')
  await page.click('button:has-text("Finish")')
  // Dev cold-compile of "/" can be slow on first hit; give it room.
  await expect(page).toHaveURL(/localhost:3000\/$/, { timeout: 30_000 })
  return username
}

test('measure nav switch latency', async ({ page }) => {
  test.setTimeout(120_000)
  await signUpAndOnboard(page, 'perf')

  const hops: Array<[string, RegExp]> = [
    ['Journal', /localhost:3000\/journal/],
    ['Leaderboard', /localhost:3000\/leaderboard/],
    ['Learn', /localhost:3000\/learn/],
    ['Home', /localhost:3000\/$/],
  ]

  // Round 0 includes dev first-hit compile; rounds 1-2 reflect steady-state nav.
  for (let round = 0; round < 3; round++) {
    for (const [label, urlre] of hops) {
      const t0 = Date.now()
      await page.click(`.ts-navpills a:has-text("${label}")`)
      // App Router commits the URL only after the server RSC render arrives,
      // so click->URL-change is the user-perceived switch latency.
      await page.waitForURL(urlre, { timeout: 30_000 })
      const dt = Date.now() - t0
      console.log(`[NAVPERF] round=${round} ${label}: ${dt}ms`)
    }
  }
})

test('measure Home full content-load time', async ({ page }) => {
  test.setTimeout(120_000)
  await signUpAndOnboard(page, 'load')
  // Warm the route once (dev compile), then measure steady-state server render:
  // full reload -> real feed content (.ts-standing only renders with data, not in skeleton).
  await page.goto('/journal')
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    await page.goto('/', { waitUntil: 'commit' })
    await page.locator('.ts-standing').waitFor({ state: 'visible', timeout: 30_000 })
    console.log(`[HOMELOAD] run=${i}: ${Date.now() - t0}ms`)
  }
})
