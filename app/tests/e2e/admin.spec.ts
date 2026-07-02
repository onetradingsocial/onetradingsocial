// app/tests/e2e/admin.spec.ts
import { test, expect, type Page } from '@playwright/test'
import { deleteCourseBySlug } from './utils/db'

// Course created by the publish test; removed in afterEach so failed runs
// don't leave "E2E Course" rows behind in the shared database.
let createdCourseSlug: string | null = null

test.afterEach(async () => {
  if (createdCourseSlug) {
    await deleteCourseBySlug(createdCourseSlug)
    createdCourseSlug = null
  }
})

async function signUpAndOnboard(page: Page, prefix: string, domain = 'tradingsocial.io') {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36)
  const username = `${prefix}_${stamp}`.slice(0, 20)
  await page.goto('/signup')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="email"]', `${username}@${domain}`)
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

test('non-admin cannot reach the admin area', async ({ page }) => {
  await signUpAndOnboard(page, 'na')
  const res = await page.goto('/admin')
  expect(res?.status()).toBe(404)
})

test('admin can publish a new course and it appears in Learn', async ({ page }) => {
  await signUpAndOnboard(page, 'ad', 'admin.tradingsocial.test')

  // Create a course
  const slug = 'e2e-' + Date.now().toString(36)
  createdCourseSlug = slug
  await page.goto('/admin/courses')
  await page.fill('input[name="title"]', 'E2E Course')
  await page.fill('input[name="slug"]', slug)
  await page.click('button:has-text("Create")')
  await expect(page).toHaveURL(/\/admin\/courses\/[0-9a-f-]+/)

  // Publish the course
  await page.click('button:has-text("Draft — click to publish")')
  await expect(page.locator('button:has-text("Published")')).toBeVisible()

  // Add + publish a lesson
  await page.click('text=+ Add lesson')
  await page.fill('input[name="title"]', 'E2E Lesson')
  await page.fill('input[name="slug"]', 'e2e-lesson')
  await page.fill('textarea[name="body"]', '<p>hello</p>')
  await page.click('button:has-text("Create lesson")')
  await expect(page).toHaveURL(/\/lessons\/[0-9a-f-]+/)
  await page.click('button:has-text("Draft — click to publish")')
  await expect(page.locator('button:has-text("Published")')).toBeVisible()

  // It now shows in Learn
  await page.goto('/learn')
  await expect(page.getByText('E2E Course')).toBeVisible()
})

test('admin can change feedback status', async ({ page }) => {
  await signUpAndOnboard(page, 'fb', 'admin.tradingsocial.test')
  await page.goto('/admin/feedback')
  // If a feedback row exists, flipping its status persists across reload.
  const firstSelect = page.locator('select').first()
  if (await firstSelect.count()) {
    await firstSelect.selectOption('triaged')
    await page.goto('/admin/feedback?status=triaged')
    await expect(page.locator('select').first()).toHaveValue('triaged')
  }
})
