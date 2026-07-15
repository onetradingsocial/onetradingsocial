'use client'

/**
 * First-party funnel events. Fire-and-forget POST to /api/track; the server
 * attaches the user, flags internal traffic and writes analytics_events.
 * Also mirrors the event to GA4 when gtag is present.
 */

export type TrackProps = Record<string, string | number | boolean | null>

const ANON_KEY = 'ts_anon_id'

export function anonId(): string {
  try {
    let id = localStorage.getItem(ANON_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(ANON_KEY, id)
    }
    return id
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
