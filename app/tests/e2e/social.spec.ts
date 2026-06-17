import { test, expect } from '@playwright/test'

async function signUp(page: import('@playwright/test').Page) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const username = `s_${stamp}`
  await page.goto('/app/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `s_${stamp}@tradingsocial.io`)
  await page.fill('input[name="password"]', 'password123')
  await page.check('input[name="terms"]')
  await page.click('button:has-text("Join the Beta")')
  await expect(page).toHaveURL(/\/app\/onboarding/)
  await page.locator('label.ts-chip', { hasText: 'forex' }).click()
  await page.fill('input[name="goal"]', 'Be consistent')
  await page.click('button:has-text("Finish")')
  await expect(page).toHaveURL(/\/app$/)
  return username
}

test('post, like, and comment on the feed', async ({ page }) => {
  await signUp(page)
  await page.fill('textarea[name="body"]', 'My first setup idea')
  await page.click('button:has-text("Post")')
  await expect(page.locator('.ts-post-body')).toContainText('My first setup idea')

  await page.locator('.ts-act').first().click() // like
  await expect(page.locator('.ts-act--on')).toContainText('1')

  await page.locator('.ts-act', { hasText: '💬' }).click() // open comments
  await page.fill('.ts-comment-add input', 'Nice one')
  await page.click('button:has-text("Reply")')
  await expect(page.locator('.ts-comment')).toContainText('Nice one')
})

test('follow another trader and see their post in the feed', async ({ page }) => {
  const userA = await signUp(page)
  await page.fill('textarea[name="body"]', 'Trader A breakout call')
  await page.click('button:has-text("Post")')
  await expect(page.locator('.ts-post-body')).toContainText('Trader A breakout call')
  // log out
  await page.goto('/app/settings')
  await page.click('button:has-text("Log out")')
  await expect(page).toHaveURL(/\/app\/login/)

  // user B follows A
  await signUp(page)
  await page.goto(`/app/${userA}`)
  await page.click('button:has-text("Follow")')
  await expect(page.locator('button:has-text("Following")')).toBeVisible()
  await page.goto('/app')
  await expect(page.locator('.ts-feed-main')).toContainText('Trader A breakout call')
})
