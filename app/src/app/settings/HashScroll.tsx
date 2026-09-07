'use client'

import { useEffect } from 'react'

/**
 * Scrolls to the `#…` target once the settings sections have mounted.
 *
 * Both broker signposts point at an anchor on this page — `?from=journal#broker`
 * on the journal empty state and `?from=onboarding#broker` on the step-5 handoff
 * — and neither one arrived. Verified in production on 2026-09-07: the hash is in
 * the URL, `#broker` is in the DOM 3,281px down, and the window sits at scrollY
 * 63. The user lands on the Profile form and the MT5 card is five screens below
 * the fold, which is the same dead end the handoff was written to remove.
 *
 * The cause is `loading.tsx`. It gives this route a Suspense fallback, so a soft
 * navigation commits the skeleton first: the anchor does not exist yet, the
 * router scrolls to the top, and nothing re-runs when the real sections stream
 * in. Nothing throws and nothing is logged — the scroll simply never happens.
 *
 * This component renders inside the resolved page, so by the time its effect
 * runs the section is in the same commit. The rAF loop covers the remaining case
 * where a target mounts a frame or two later than this one.
 *
 * `scroll-margin-top: 84px` on `.settings-section` (settings.css) clears the
 * sticky header, so `block: 'start'` lands the heading in view rather than under
 * the nav. Scrolling is instant on purpose: this is arrival at a destination the
 * user asked for, not a movement they need to follow, and an animated jump of
 * 3,000px reads as a glitch under `prefers-reduced-motion`.
 */
export function HashScroll() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id) return

    let frame = 0
    let tries = 0
    const tick = () => {
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ block: 'start', behavior: 'auto' })
        return
      }
      // ~20 frames is a third of a second: long enough for a late section,
      // short enough that a genuinely absent id does not fight a user who has
      // started scrolling somewhere else.
      if (tries++ < 20) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return null
}
