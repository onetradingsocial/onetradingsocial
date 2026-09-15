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

  // ── WAITING FOR THE ACK, NOT JUST THE BACKDROP ─────────────────────────────
  //
  // `close()` in WelcomeModal fires ackWelcome() fire-and-forget and removes the
  // backdrop on a fixed 300ms timer. Those are independent: the visual close
  // reliably wins, so "the backdrop is gone" does NOT mean welcome_tier_seen has
  // been written.
  //
  // A spec that navigates immediately after therefore renders the next page with
  // `welcome_tier_seen` still null, shouldShowWelcome returns true again, and
  // because WelcomeModal lives in the root layout its backdrop then intercepts
  // pointer events on EVERY subsequent page — surfacing as a cascade of
  // "element intercepts pointer events" timeouts nowhere near the real cause.
  //
  // Measured, not assumed: a probe confirmed the popup returns after a
  // client-side navigation for a Pro user as well as a Free one, and does NOT
  // return when the write is awaited first. So it is the race, not the tier.
  //
  // Waiting on the server action's own round trip is the precise fix — the
  // helper has no username, so it cannot poll the row. Tolerant by design: if
  // no POST is seen (an already-acked user whose popup never appeared), the
  // catch lets the dismissal proceed exactly as before.
  await page.locator('.wpop-close').click()
  await backdrop.waitFor({ state: 'detached', timeout: 5000 })

  // The backdrop being gone does NOT mean the popup is done with.
  //
  // `close()` in WelcomeModal fires ackWelcome() fire-and-forget and removes the
  // backdrop on a fixed 300ms timer. The two are independent, and the visual
  // close reliably wins — so a spec that navigates straight after renders the
  // next page with `welcome_tier_seen` still null, shouldShowWelcome returns
  // true again, and because WelcomeModal lives in the root layout its backdrop
  // then intercepts pointer events on EVERY later page. It surfaces as a
  // cascade of "element intercepts pointer events" timeouts nowhere near the
  // real cause.
  //
  // Measured, not assumed: a probe confirmed the popup returns after a
  // client-side navigation for a Pro user as well as a Free one, and does NOT
  // return once the write has landed. So it is the race, not the tier.
  //
  // Waiting on the network was tried and is not reliable here — the page also
  // POSTs analytics and CSP reports, so the interesting response is hard to
  // pick out. Asking the SERVER whether it still renders the popup is the
  // signal that actually matters, so: reload until it agrees, re-dismissing if
  // the write had not yet landed.
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.reload()
    const returned = await backdrop
      .waitFor({ state: 'visible', timeout: 1500 })
      .then(() => true)
      .catch(() => false)
    if (!returned) return
    await page.locator('.wpop-close').click().catch(() => {})
    await backdrop.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  }
  throw new Error('welcome popup kept returning after dismissal — ackWelcome never persisted')
}
