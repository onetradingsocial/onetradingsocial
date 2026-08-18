// app/tests/e2e/analytics.spec.ts
import { test, expect } from '@playwright/test'
import { adminCreds, signInAsAdmin } from './utils/admin'

// See tests/e2e/utils/admin.ts — audit item 18, F1.
const ADMIN = adminCreds()

test('admin sees the analytics dashboard sections', async ({ page }) => {
  test.skip(!ADMIN, 'E2E_ADMIN_EMAIL is not set')
  await signInAsAdmin(page, ADMIN!)
  await page.goto('/admin/analytics')
  await expect(page.getByRole('heading', { name: 'Growth' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Engagement' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ops' })).toBeVisible()
  await expect(page.getByText('Total users')).toBeVisible()
})
