// app/tests/e2e/messaging.spec.ts
import { test, expect, type Page, type BrowserContext } from '@playwright/test'

const DOMAIN = 'msg.tradingsocial.test'

async function signUp(page: Page, prefix: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36)
  const username = `${prefix}_${stamp}`.slice(0, 20)
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@${DOMAIN}`)
  await page.fill('input[name="password"]', 'password123')
  await page.check('input[name="terms"]')
  await page.click('button:has-text("Join the Beta")')
  // Onboarding multi-step flow (4 steps + reveal)
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 })
  // Step 0 — welcome → "Build my identity"
  await page.click('button:has-text("Build my identity")')
  // Step 1 — markets → pick Forex, then Continue
  await page.click('button:has-text("Forex")')
  await page.click('button:has-text("Continue")')
  // Step 2 — experience → pick Beginner, then Continue
  await page.click('button:has-text("Beginner")')
  await page.click('button:has-text("Continue")')
  // Step 3 — goal → pick Build consistency, then Continue
  await page.click('button:has-text("Build consistency")')
  await page.click('button:has-text("Continue")')
  // Step 4 — visibility → pick Public, then "Create my profile"
  await page.click('button:has-text("Public")')
  await page.click('button:has-text("Create my profile")')
  // Step 5 — reveal → "Enter TradingSocial"
  await page.click('button:has-text("Enter TradingSocial")')
  await expect(page).toHaveURL('/', { timeout: 15000 })
  return username
}

// follow target from the currently-logged-in page (goto profile, click Follow)
async function follow(page: Page, targetUsername: string) {
  await page.goto(`/${targetUsername}`)
  await page.click('button:has-text("Follow")')
  await expect(page.locator('button:has-text("Following")')).toBeVisible()
}

test('mutual followers DM: live delivery + read receipt', async ({ browser }) => {
  test.setTimeout(90000)

  const ctxA: BrowserContext = await browser.newContext()
  const ctxB: BrowserContext = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  const a = await signUp(pageA, 'msga')
  const b = await signUp(pageB, 'msgb')

  // Establish MUTUAL follow
  await follow(pageA, b)
  await follow(pageB, a)

  // A visits B's profile — Message link should be visible (mutual follow)
  await pageA.goto('/' + b)
  await expect(pageA.locator('.ts-msg-profile-btn')).toBeVisible()
  await pageA.locator('.ts-msg-profile-btn').click()
  await expect(pageA).toHaveURL(new RegExp(`/messages\\?to=${b}`))

  // Set up listener for the server action POST response BEFORE sending
  const serverActionDone = pageA.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('localhost:3000/messages'),
    { timeout: 15000 },
  )

  // A sends a unique message (creates the conversation + message in DB)
  const body = `hello-dm-${Date.now()}`
  await pageA.fill('.ts-msg-input', body)
  await pageA.click('.ts-msg-send')
  // Wait for optimistic bubble AND the actual server action response (DB write committed)
  await expect(pageA.locator('.ts-msg-bubble-out').filter({ hasText: body }).first()).toBeVisible({ timeout: 10000 })
  await serverActionDone

  // A navigates to /messages?to=b to reload the thread via SSR with the real conversationId
  // (needed so A's realtime subscription targets the correct channel for read receipts)
  await pageA.goto(`/messages?to=${b}`)
  await pageA.waitForLoadState('load')
  // A should see the sent message in the thread (SSR-loaded via initialActive)
  await expect(pageA.locator('.ts-msg-bubble-out').filter({ hasText: body }).first()).toBeVisible({ timeout: 10000 })

  // B navigates to the conversation via ?to=a (SSR loads initialActive with messages)
  await pageB.goto(`/messages?to=${a}`)
  await pageB.waitForLoadState('load')
  await expect(pageB).toHaveURL(/\/messages/, { timeout: 5000 })
  // B sees the incoming message (SSR-loaded)
  await expect(pageB.locator('.ts-msg-bubble-in').filter({ hasText: body })).toBeVisible({ timeout: 10000 })

  // A sees read receipt after B opened the thread (triggers markThreadRead → realtime UPDATE)
  await expect(pageA.locator('.ts-msg-seen')).toBeVisible({ timeout: 10000 })

  await ctxA.close()
  await ctxB.close()
})

test('privacy guard: non-mutual cannot message', async ({ browser }) => {
  test.setTimeout(90000)

  const ctxA: BrowserContext = await browser.newContext()
  const ctxB: BrowserContext = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  const a = await signUp(pageA, 'msgpa')
  const b = await signUp(pageB, 'msgpb')

  // ONE-WAY only: A follows B, B does NOT follow A
  await follow(pageA, b)

  // A visits B's profile — no Message link (not mutual)
  await pageA.goto('/' + b)
  await expect(pageA.locator('.ts-msg-profile-btn')).toHaveCount(0)

  // Direct deep link should NOT yield a composer (no mutual follow, no thread)
  await pageA.goto(`/messages?to=${b}`)
  await expect(pageA.locator('.ts-msg-input')).toHaveCount(0)

  await ctxA.close()
  await ctxB.close()
})
