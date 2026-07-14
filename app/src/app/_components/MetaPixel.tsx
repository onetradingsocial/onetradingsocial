'use client'

import { useEffect } from 'react'

// Meta (Facebook) pixel. The base loader + PageView live on the marketing site
// (static HTML). In the app we load it only on the auth/billing funnel to fire
// specific standard events — never in the global layout, so authenticated
// browsing of private journals is not streamed to Meta.
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '1056839790113606'

type MetaEvent = 'PageView' | 'CompleteRegistration' | 'InitiateCheckout' | 'Subscribe'

/* eslint-disable @typescript-eslint/no-explicit-any */
function ensureLoaded() {
  const w = window as any
  if (w.fbq) return
  const fbq: any = (w.fbq = function () {
    fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments)
  })
  if (!w._fbq) w._fbq = fbq
  fbq.push = fbq
  fbq.loaded = true
  fbq.version = '2.0'
  fbq.queue = []
  const t = document.createElement('script')
  t.async = true
  t.src = 'https://connect.facebook.net/en_US/fbevents.js'
  const s = document.getElementsByTagName('script')[0]
  s.parentNode?.insertBefore(t, s)
}

/** Imperative form for click handlers (e.g. InitiateCheckout before the
 *  Stripe redirect). fbevents.js queues calls made before it finishes loading. */
export function trackMeta(
  event: MetaEvent,
  params?: Record<string, unknown>,
  match?: { email?: string | null; externalId?: string },
) {
  ensureLoaded()
  const fbq = (window as any).fbq
  // Advanced-matching keys — fbevents.js SHA-256 hashes these client-side.
  const keys: Record<string, string> = {}
  if (match?.email) keys.em = match.email
  if (match?.externalId) keys.external_id = match.externalId
  fbq('init', PIXEL_ID, Object.keys(keys).length ? keys : undefined)
  fbq('track', event, params)
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// First-invoice amounts in USD (mirrors PLANS in select-plan / settings/billing;
// annual figures are the beta-promo first-year charge).
const SUBSCRIBE_VALUE: Record<string, number> = {
  trader_monthly: 30,
  trader_annual: 72,
  pro_monthly: 50,
  pro_annual: 120,
}

/** Params for the Subscribe standard event, from the tier/interval the
 *  checkout route appends to its success URL. Unknown combos → no params. */
export function subscribeParams(tier?: string, interval?: string) {
  const value = SUBSCRIBE_VALUE[`${tier}_${interval}`]
  return value ? { value, currency: 'USD', content_name: `${tier}_${interval}` } : undefined
}

export function MetaPixel({
  event,
  params,
  email,
  externalId,
  requireParam,
  requireValue = '1',
  strip = false,
}: {
  event: MetaEvent
  /** Optional standard-event parameters (value, currency, content_name, …). */
  params?: Record<string, unknown>
  /** Advanced-matching keys. fbevents.js SHA-256 hashes these client-side. */
  email?: string | null
  externalId?: string
  /** When set, only fire if this URL query param equals requireValue. */
  requireParam?: string
  requireValue?: string
  /** Strip requireParam (plus checkout metadata) after firing so a refresh or
   *  back-nav does not double-count. Leave false when another pixel component
   *  (e.g. RedditPixel) gates on the same param and does the stripping. */
  strip?: boolean
}) {
  useEffect(() => {
    if (requireParam) {
      const sp = new URLSearchParams(window.location.search)
      if (sp.get(requireParam) !== requireValue) return
      if (strip) {
        sp.delete(requireParam)
        sp.delete('tier')
        sp.delete('interval')
        const qs = sp.toString()
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
      }
    }
    trackMeta(event, params, { email, externalId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, email, externalId, requireParam, requireValue, strip])

  return null
}
