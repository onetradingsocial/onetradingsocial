'use client'

/**
 * First-party funnel events. Fire-and-forget POST to /api/track; the server
 * attaches the user, flags internal traffic and writes analytics_events.
 * Also mirrors the event to GA4 when gtag is present.
 */

import { readConsent } from '@/lib/consent'

export type TrackProps = Record<string, string | number | boolean | null>

const ANON_KEY = 'ts_anon_id'
const ANON_EXP_KEY = 'ts_anon_id_exp'

/**
 * Rotation window for the anonymous device id (audit item 17, findings 4 and
 * 10). 180 days.
 *
 * The old implementation minted a UUID once and kept it in localStorage
 * forever: localStorage has no expiry mechanism, so this was the only
 * identifier on the platform with an unbounded lifetime — longer-lived than
 * every cookie on the page — and it is the join key that retrospectively
 * attaches a visitor's whole pre-signup browsing history to a named account
 * once they sign up. That retrospective linkage is what turns "anonymous
 * analytics" into personal information under the Privacy Act.
 *
 * Rotating caps how far back that linkage can reach. It is deliberately the
 * same 180 days as the consent cookie, so a visitor who is re-asked about
 * tracking is also starting a fresh identifier. WS3 already scrubs anon_id from
 * analytics_events on account deletion; this bounds it for people who never had
 * an account at all, and the migration in this workstream purges the server-side
 * rows on the same schedule.
 */
const ANON_TTL_MS = 1000 * 60 * 60 * 24 * 180

export function anonId(): string {
  try {
    const id = localStorage.getItem(ANON_KEY)
    const exp = Number(localStorage.getItem(ANON_EXP_KEY) ?? 0)
    if (id && exp > Date.now()) return id

    const next = crypto.randomUUID()
    localStorage.setItem(ANON_KEY, next)
    localStorage.setItem(ANON_EXP_KEY, String(Date.now() + ANON_TTL_MS))
    return next
  } catch {
    return 'unknown'
  }
}

function device(): string {
  const w = window.innerWidth
  return w < 768 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop'
}

export function track(event: string, props: TrackProps = {}): void {
  try {
    // Analytics tier (audit item 17 finding 6). This is first-party and the
    // lowest-risk collection on the platform, but it is still non-essential and
    // it still mints a device identifier, so a visitor who declined analytics
    // gets no beacon and no anon id — not a beacon with the id stripped out.
    if (!readConsent().analytics) return

    const body = JSON.stringify({
      event,
      props,
      anonId: anonId(),
      path: location.pathname,
      referrer: document.referrer || null,
      device: device(),
      source: new URLSearchParams(location.search).get('utm_source'),
    })
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))
    } else {
      fetch('/api/track', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } })
    }
    const g = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag
    if (g) g('event', event, props)
  } catch {
    // analytics must never break the app
  }
}
