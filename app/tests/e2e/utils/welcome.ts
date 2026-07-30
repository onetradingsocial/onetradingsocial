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
 *  falls through when the wait times out.
 *
 *  The visible-wait bound is 15000ms, not a tighter one, because Playwright's
 *  config starts `npm run dev` fresh and the FIRST request to '/' in the whole
 *  run pays a full cold Next compile — which can outlast a 5s wait on its own.
 *  If that happens here, this helper wrongly concludes "no popup", the popup
 *  then mounts moments later, and because WelcomeModal lives in the root
 *  layout its backdrop intercepts pointer events on every subsequent page in
 *  the spec — producing a cascade of "element intercepts pointer events"
 *  timeouts far from the real cause. The detached-wait stays at 5000ms: by
 *  that point the popup is already visible and closing it is fast. */
export async function dismissWelcome(page: Page): Promise<void> {
  const backdrop = page.locator('.wpop-backdrop')
  const appeared = await backdrop
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  if (!appeared) return
  await page.locator('.wpop-close').click()
  await backdrop.waitFor({ state: 'detached', timeout: 5000 })
}
