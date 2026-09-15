// app/tests/e2e/admin.spec.ts
import { test, expect, type Page } from '@playwright/test'
import { deleteCourseBySlug } from './utils/db'
import { dismissWelcome } from './utils/welcome'
import { adminCreds, signInAsAdmin } from './utils/admin'
import { SIGNUP_PASSWORD } from './utils/creds'

// Audit item 18, F1. The admin specs used to mint an admin by signing up under
// a wildcard `.test` domain. The wildcard is gone, so they log in to a seeded
// admin instead — see tests/e2e/utils/admin.ts for the env vars.
const ADMIN = adminCreds()

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
  await page.fill('input[name="password"]', SIGNUP_PASSWORD)
  await page.locator('label.fl-terms .fl-check').click()
  await expect(page.locator('input[name="terms"]')).toBeChecked()
  await page.click('button:has-text("Join the Beta")')
  // Trial welcome step — 14 days of Pro, no card
  await expect(page).toHaveURL(/\/welcome/, { timeout: 15000 })
  await page.click('button:has-text("Continue on Free")')
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
  await dismissWelcome(page)
  return username
}

test('non-admin cannot reach the admin area', async ({ page }) => {
  await signUpAndOnboard(page, 'na')
  await page.goto('/admin')

  // Asserted on what RENDERED, not on the HTTP status.
  //
  // `requireAdmin()` calls notFound() from inside the page, which Next resolves
  // during a streaming render — and once the response has begun streaming the
  // status line is already sent, so the body becomes the not-found page while
  // the status stays 200. The old `expect(res.status()).toBe(404)` therefore
  // failed while the route was perfectly well protected, which is the worst
  // kind of failing security test: it cries wolf, and the next person to see it
  // red assumes it always is.
  //
  // Verified when this was changed: the response body is the 404 page, and no
  // admin surface is present.
  await expect(page.getByText('404')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Admin/i })).toHaveCount(0)
})

test('admin can create and publish a course with a lesson', async ({ page }) => {
  test.skip(!ADMIN, 'E2E_ADMIN_EMAIL is not set')
  await signInAsAdmin(page, ADMIN!)

  // Create a course
  const slug = 'e2e-' + Date.now().toString(36)
  createdCourseSlug = slug
  await page.goto('/admin/courses')
  await page.fill('input[name="title"]', 'E2E Course')
  await page.fill('input[name="slug"]', slug)
  await page.click('button:has-text("Create")')
  await expect(page).toHaveURL(/\/admin\/courses\/[0-9a-f-]+/)

  // Publish the course.
  //
  // Selected by title, not by label. PublishToggle was refactored so the LABEL
  // states what is ("Publish" / "Published") and the TITLE states what clicking
  // does — the old "Draft — click to publish" text has not existed for some
  // time, so this had been failing on a stale selector rather than on anything
  // real. A label match is also ambiguous here, since "Publish" is a prefix of
  // "Published"; the title is not.
  await page.click('button[title="Click to publish"]')
  await expect(page.locator('button:has-text("Published")')).toBeVisible()

  // Add + publish a lesson.
  //
  // WAIT FOR THE NAVIGATION before filling. "+ Add lesson" is a <Link>, so it
  // is a client-side transition, and the course page underneath has its own
  // edit form carrying the same `name="title"` and `name="slug"`. Fill straight
  // after the click and the values land on the COURSE form, the transition then
  // completes, and the lesson page renders empty.
  //
  // It failed silently rather than loudly: both inputs are `required`, so the
  // browser blocked submission natively — no action call, no error state, and a
  // completely clean server log. The only visible symptom was the URL never
  // leaving /lessons/new.
  await page.click('text=+ Add lesson')
  await expect(page).toHaveURL(/\/lessons\/new$/)
  await page.fill('input[name="title"]', 'E2E Lesson')
  await page.fill('input[name="slug"]', 'e2e-lesson')
  await page.fill('textarea[name="body"]', '<p>hello</p>')
  await page.click('button:has-text("Create lesson")')
  await expect(page).toHaveURL(/\/lessons\/[0-9a-f-]+/)
  await page.click('button[title="Click to publish"]')
  await expect(page.locator('button:has-text("Published")')).toBeVisible()

  // The course and its lesson are both published — asserted above, on the
  // toggles themselves.
  //
  // This used to finish by checking the course appeared on /learn. That
  // assertion cannot pass and has not been able to for some time: the Learn
  // section is deliberately switched off (`LEARN_HIDDEN = true` in
  // app/src/app/learn/page.tsx, "we are not financial advisors"), so /learn
  // redirects to '/' for everyone including admins.
  //
  // Rather than delete the coverage, assert the hide is actually in force —
  // that is a compliance property worth a test of its own, and it fails loudly
  // if someone flips the flag without meaning to. Restore the visibility check
  // in place of this when Learn is turned back on.
  await page.goto('/learn')
  await expect(page).toHaveURL(/\/$|\/\?/)
  await expect(page.getByText('E2E Course')).toHaveCount(0)
})

test('admin can change feedback status', async ({ page }) => {
  test.skip(!ADMIN, 'E2E_ADMIN_EMAIL is not set')
  await signInAsAdmin(page, ADMIN!)
  await page.goto('/admin/feedback')
  // If a feedback row exists, flipping its status persists across reload.
  const firstSelect = page.locator('select').first()
  if (await firstSelect.count()) {
    await firstSelect.selectOption('triaged')
    await page.goto('/admin/feedback?status=triaged')
    await expect(page.locator('select').first()).toHaveValue('triaged')
  }
})
