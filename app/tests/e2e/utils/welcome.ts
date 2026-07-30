import { type Page } from '@playwright/test'

/** Dismisses the post-onboarding welcome popup if it appears.
 *
 *  Every onboarding flow in the suite lands on '/', where this popup renders a
 *  full-screen backdrop that swallows clicks. Because WelcomeModal is mounted in
 *  the root layout, an undismissed popup blocks every later page too, not just
 *  the next click.
 *
 *  Why a bounded waitFor and not count(): WelcomeModal returns null on its first
 *  render and only portals the backdrop in on a second render, after its
 *  `useEffect(() => setMounted(true))` commits. toHaveURL('/') can resolve before
 *  that, so a single non-retrying count() is a coin-flip — and losing it means the
 *  popup appears afterwards and breaks the rest of the spec intermittently.
 *
 *  Still tolerant: a spec whose user has already acknowledged their tier simply
 *  falls through when the wait times out. */
export async function dismissWelcome(page: Page): Promise<void> {
  const backdrop = page.locator('.wpop-backdrop')
  const appeared = await backdrop
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (!appeared) return
  await page.locator('.wpop-close').click()
  await backdrop.waitFor({ state: 'detached', timeout: 5000 })
}
