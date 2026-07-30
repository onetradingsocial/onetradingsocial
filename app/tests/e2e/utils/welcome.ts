import type { Page } from '@playwright/test'

/** Dismisses the post-onboarding welcome popup if it is up.
 *
 *  Every onboarding flow in the suite lands on '/', where this popup now
 *  renders a full-screen backdrop that swallows clicks. Tolerant by design:
 *  a spec may run against a user who has already acknowledged their tier, so
 *  absence is not a failure.
 *
 *  The close button only fades in with the rest of the banner, but it is in the
 *  DOM and clickable from the first frame, so there is no need to wait out the
 *  ~3.8s reveal sequence. */
export async function dismissWelcome(page: Page): Promise<void> {
  const backdrop = page.locator('.wpop-backdrop')
  if (!(await backdrop.count())) return
  await page.locator('.wpop-close').click()
  await backdrop.waitFor({ state: 'detached', timeout: 5000 })
}
