'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  purgeTier,
  readConsent,
  writeConsent,
  type ConsentState,
} from '@/lib/consent'

/**
 * First-visit tracking notice for the app origin (audit item 17, finding 6).
 *
 * The marketing site has its own copy in /consent.js; both write the same
 * cookie on `.tradingsocial.io`, so whichever origin a visitor lands on first
 * is the only one that asks. `initial` comes from the server so the notice does
 * not flash for someone who already answered.
 *
 * Declining is real, not cosmetic: the ads tier gates MetaPixel/RedditPixel
 * loading and the server-side Reddit Conversions API call, the analytics tier
 * gates GoogleAnalytics rendering and the first-party track() beacon, and
 * revoking a tier purges the cookies it wrote and reloads — third-party script
 * already executing in the page cannot be trusted to stop on request.
 */
export function CookieNotice({ initial }: { initial: ConsentState }) {
  const [state, setState] = useState<ConsentState>(initial)
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState(false)
  const [analytics, setAnalytics] = useState(initial.analytics)
  const [ads, setAds] = useState(initial.ads)

  useEffect(() => {
    // Re-read on mount: the cookie may have been set on the marketing origin in
    // between the server render and hydration.
    const live = readConsent()
    setState(live)
    setAnalytics(live.analytics)
    setAds(live.ads)
    setOpen(!live.decided)
  }, [])

  useEffect(() => {
    const openPrefs = () => {
      const live = readConsent()
      setAnalytics(live.analytics)
      setAds(live.ads)
      setPrefs(true)
      setOpen(true)
    }
    window.addEventListener('ts:cookie-settings', openPrefs)
    return () => window.removeEventListener('ts:cookie-settings', openPrefs)
  }, [])

  const save = useCallback(
    (nextAnalytics: boolean, nextAds: boolean) => {
      const revoked = (state.analytics && !nextAnalytics) || (state.ads && !nextAds)
      writeConsent(nextAnalytics, nextAds)
      if (state.analytics && !nextAnalytics) purgeTier('analytics')
      if (state.ads && !nextAds) purgeTier('ads')
      setState({ analytics: nextAnalytics, ads: nextAds, decided: true })
      setOpen(false)
      // A reload is the only honest way to unload a tag that already ran.
      if (revoked) window.location.reload()
    },
    [state],
  )

  if (!open) return null

  return (
    <div className="cookie-notice" role="dialog" aria-label="Cookies and tracking">
      <div className="cookie-notice-in">
        <p>
          <strong>Cookies and tracking</strong>
          We use analytics cookies to see how the app is used. Advertising pixels from Meta and
          Reddit are <strong>off unless you turn them on</strong>. Full detail, including what our
          servers send Reddit, is in our{' '}
          <a
            href="https://www.tradingsocial.io/privacy#cookies"
            target="_blank"
            rel="noopener noreferrer"
          >
            privacy policy
          </a>
          .
        </p>
        <div className="cookie-notice-act">
          <button type="button" onClick={() => setPrefs((p) => !p)}>
            Manage
          </button>
          <button type="button" onClick={() => save(false, false)}>
            Reject non-essential
          </button>
          <button type="button" className="primary" onClick={() => save(true, true)}>
            Accept all
          </button>
        </div>
        {prefs && (
          <div className="cookie-notice-prefs">
            <div className="cookie-notice-row">
              <input
                type="checkbox"
                id="ts-c-analytics"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
              />
              <label htmlFor="ts-c-analytics">
                Analytics
                <small>
                  Google Analytics and our own usage counts. Aggregate measurement of how the app is
                  used. Cookies last 13 months; the browser identifier rotates every 180 days.
                </small>
              </label>
            </div>
            <div className="cookie-notice-row">
              <input
                type="checkbox"
                id="ts-c-ads"
                checked={ads}
                onChange={(e) => setAds(e.target.checked)}
              />
              <label htmlFor="ts-c-ads">
                Advertising
                <small>
                  Meta and Reddit pixels. These send persistent identifiers to advertising networks
                  and let them link this visit to your account with them. Leaving this off also
                  stops our servers sending Reddit a signup or purchase event.
                </small>
              </label>
            </div>
            <div className="cookie-notice-row" style={{ border: 0 }}>
              <button type="button" className="primary" onClick={() => save(analytics, ads)}>
                Save choices
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Footer affordance so a choice can be changed later, not just once. */
export function CookieSettingsLink() {
  return (
    <button
      type="button"
      className="cookie-settings-link"
      onClick={() => window.dispatchEvent(new Event('ts:cookie-settings'))}
    >
      Cookie settings
    </button>
  )
}
