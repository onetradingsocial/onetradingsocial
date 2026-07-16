import { test, expect } from '@playwright/test'

async function signUp(page: import('@playwright/test').Page) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const username = `s_${stamp}`
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `s_${stamp}@tradingsocial.io`)
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

// The feed shows the viewer's own posts at the top, then fallback platform posts,
// so single-element selectors must be scoped to the first post / feed container.

test('post, like, and comment on the feed', async ({ page }) => {
  const user = await signUp(page)
  const body = `My first setup idea ${user}`
  await page.fill('.h-composer textarea', body)
  await page.click('.h-composer button:has-text("Post")')
  await expect(page.locator('.h-trade').first()).toContainText(body)

  const firstPost = page.locator('.h-trade').first()
  await firstPost.locator('.h-react').first().click() // like
  await expect(firstPost.locator('.h-react.liked')).toContainText('1')

  await firstPost.locator('.h-react').nth(1).click() // open comments
  await firstPost.locator('.ts-comment-add input').fill('Nice one')
  await firstPost.locator('button:has-text("Reply")').click()
  await expect(firstPost.locator('.ts-comment')).toContainText('Nice one')
})

test('follow another trader and see their post in the feed', async ({ page }) => {
  const userA = await signUp(page)
  const post = `Trader A breakout call ${userA}`
  await page.fill('.h-composer textarea', post)
  await page.click('.h-composer button:has-text("Post")')
  await expect(page.locator('.h-trade').first()).toContainText(post)
  // log out
  await page.goto('/settings')
  await page.click('button:has-text("Log out")')
  await expect(page).toHaveURL(/\/login/)

  // user B follows A
  await signUp(page)
  await page.goto(`/${userA}`)
  await page.click('button:has-text("Follow")')
  await expect(page.locator('button:has-text("Following")')).toBeVisible()
  await page.goto('/')
  await expect(page.locator('.h-app')).toContainText(post)
})
