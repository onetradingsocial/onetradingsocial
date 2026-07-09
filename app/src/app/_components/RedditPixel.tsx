'use client'

import { useEffect } from 'react'

// Reddit Ads pixel. The base loader + PageVisit live on the marketing site
// (static HTML). In the app we load it only on the auth funnel (PageVisit) and
// to fire the SignUp conversion — never in the global layout, so authenticated
// browsing of private journals is not streamed to Reddit.
const PIXEL_ID = process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID || 'a2_jbawbd7fkiwo'

type RedditEvent = 'PageVisit' | 'SignUp'

/* eslint-disable @typescript-eslint/no-explicit-any */
function ensureLoaded() {
  const w = window as any
  if (w.rdt) return
  const rdt: any = (w.rdt = function () {
    rdt.sendEvent ? rdt.sendEvent.apply(rdt, arguments) : rdt.callQueue.push(arguments)
  })
  rdt.callQueue = []
  const t = document.createElement('script')
  t.src = `https://www.redditstatic.com/ads/pixel.js?pixel_id=${PIXEL_ID}`
  t.async = true
  const s = document.getElementsByTagName('script')[0]
  s.parentNode?.insertBefore(t, s)
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function RedditPixel({
  event,
  email,
  externalId,
  conversionId,
  requireParam,
}: {
  event: RedditEvent
  /** Advanced-matching keys. Reddit's pixel.js SHA-256 hashes these client-side. */
  email?: string | null
  externalId?: string
  /** Dedup key shared with the server-side (CAPI) event so Reddit counts once. */
  conversionId?: string
  /** When set, only fire if this URL query param equals "1"; then strip it so a
   *  refresh or back-nav does not double-count the conversion. */
  requireParam?: string
}) {
  useEffect(() => {
    if (requireParam) {
      const params = new URLSearchParams(window.location.search)
      if (params.get(requireParam) !== '1') return
      params.delete(requireParam)
      params.delete('cid')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }

    ensureLoaded()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rdt = (window as any).rdt
    const keys: Record<string, string> = {}
    if (email) keys.email = email
    if (externalId) keys.externalId = externalId
    rdt('init', PIXEL_ID, Object.keys(keys).length ? keys : undefined)
    rdt('track', event, conversionId ? { conversionId } : undefined)
  }, [event, email, externalId, conversionId, requireParam])

  return null
}
