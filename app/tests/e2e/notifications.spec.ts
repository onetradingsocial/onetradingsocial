// app/tests/e2e/notifications.spec.ts
import { test, expect, type Page, type BrowserContext } from '@playwright/test'

const DOMAIN = 'notif.tradingsocial.test'

async function signUp(page: Page, prefix: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36)
  const username = `${prefix}_${stamp}`.slice(0, 20)
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@${DOMAIN}`)
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

async function logout(page: Page) {
  await page.goto('/settings')
  await page.click('button:has-text("Log out")')
  await expect(page).toHaveURL(/\/login/)
}

test('follow notification appears in bell', async ({ page }) => {
  const userA = await signUp(page, 'fna')
  await logout(page)

  const userB = await signUp(page, 'fnb')
  // B follows A
  await page.goto(`/${userA}`)
  await page.click('button:has-text("Follow")')
  await logout(page)

  // A logs in, checks bell
  await page.goto('/login')
  await page.fill('input[name="email"]', `${userA}@${DOMAIN}`)
  await page.fill('input[name="password"]', 'password123')
  await page.click('button:has-text("Log in")')
  await expect(page).toHaveURL('/')

  await page.click('.ts-notif-bell')
  await expect(page.locator('.ts-notif-list')).toContainText(`@${userB} followed you`)
})

test('like notification appears in bell', async ({ page }) => {
  // A posts; B likes it; A sees notification
  const userA = await signUp(page, 'lna')
  await page.fill('.h-composer textarea', `Like test post ${userA}`)
  await page.click('.h-composer button:has-text("Post")')
  await expect(page.locator('.h-trade').first()).toContainText(`Like test post ${userA}`)
  await logout(page)

  const userB = await signUp(page, 'lnb')
  await page.goto(`/${userA}`)
  // find A's post and like it
  await page.locator('.h-trade').first().locator('.h-react').first().click()
  await logout(page)

  await page.goto('/login')
  await page.fill('input[name="email"]', `${userA}@${DOMAIN}`)
  await page.fill('input[name="password"]', 'password123')
  await page.click('button:has-text("Log in")')
  await expect(page).toHaveURL('/')

  await page.click('.ts-notif-bell')
  await expect(page.locator('.ts-notif-list')).toContainText(`@${userB} liked your post`)
})

test('comment notification appears in bell', async ({ page }) => {
  const userA = await signUp(page, 'cna')
  await page.fill('.h-composer textarea', `Comment test post ${userA}`)
  await page.click('.h-composer button:has-text("Post")')
  await expect(page.locator('.h-trade').first()).toContainText(`Comment test post ${userA}`)
  await logout(page)

  const userB = await signUp(page, 'cnb')
  await page.goto(`/${userA}`)
  const firstPost = page.locator('.h-trade').first()
  await firstPost.locator('.h-react').nth(1).click()
  await firstPost.locator('.ts-comment-add input').fill('Great setup!')
  await firstPost.locator('button:has-text("Reply")').click()
  await logout(page)

  await page.goto('/login')
  await page.fill('input[name="email"]', `${userA}@${DOMAIN}`)
  await page.fill('input[name="password"]', 'password123')
  await page.click('button:has-text("Log in")')
  await expect(page).toHaveURL('/')

  await page.click('.ts-notif-bell')
  await expect(page.locator('.ts-notif-list')).toContainText(`@${userB} commented on your post`)
})

test('mark all read clears badge', async ({ page }) => {
  const userA = await signUp(page, 'mra')
  await logout(page)

  const userB = await signUp(page, 'mrb')
  await page.goto(`/${userA}`)
  await page.click('button:has-text("Follow")')
  await logout(page)

  await page.goto('/login')
  await page.fill('input[name="email"]', `${userA}@${DOMAIN}`)
  await page.fill('input[name="password"]', 'password123')
  await page.click('button:has-text("Log in")')
  await expect(page).toHaveURL('/')

  await expect(page.locator('.ts-notif-badge')).toBeVisible()
  await page.click('.ts-notif-bell')
  await page.click('.ts-notif-mark-all')
  await expect(page.locator('.ts-notif-badge')).not.toBeVisible()
})

test('realtime: User B bell updates when User A likes without page refresh', async ({ browser }) => {
  const ctxA: BrowserContext = await browser.newContext()
  const ctxB: BrowserContext = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  const userA = await signUp(pageA, 'rta')
  // A posts
  await pageA.fill('.h-composer textarea', `RT post ${userA}`)
  await pageA.click('.h-composer button:has-text("Post")')
  await expect(pageA.locator('.h-trade').first()).toContainText(`RT post ${userA}`)

  // B signs up and logs in (separate context)
  const stamp = Date.now().toString(36)
  const userB = `rtb_${stamp}`.slice(0, 20)
  await pageB.goto('/signup')
  await pageB.fill('input[name="username"]', userB)
  await pageB.fill('input[name="email"]', `${userB}@${DOMAIN}`)
  await pageB.fill('input[name="password"]', 'password123')
  await pageB.check('input[name="terms"]')
  await pageB.click('button:has-text("Join the Beta")')
  await expect(pageB).toHaveURL(/\/onboarding/)
  await pageB.locator('label.ts-chip', { hasText: 'forex' }).click()
  await pageB.fill('input[name="goal"]', 'Be consistent')
  await pageB.click('button:has-text("Finish")')
  await expect(pageB).toHaveURL('/')

  // A navigates to B's profile and follows B (to get B's post in feed) — actually A just navigates to find B
  // Simpler: A likes their own post is self-notif (skipped), so go via B liking A's post
  // B goes to A's profile and likes their post — A's bell updates in pageA
  await pageB.goto(`/${userA}`)
  // wait for feed to load
  await pageB.waitForSelector('.h-trade')
  await pageB.locator('.h-trade').first().locator('.h-react').first().click()

  // A's bell badge should appear without refresh (realtime)
  await expect(pageA.locator('.ts-notif-badge')).toBeVisible({ timeout: 10000 })

  await ctxA.close()
  await ctxB.close()
})
