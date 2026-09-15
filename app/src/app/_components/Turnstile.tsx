'use client'

import { useEffect, useRef, useState } from 'react'
import { CAPTCHA_FIELD } from '@/lib/captcha'

/**
 * Cloudflare Turnstile widget for the four auth forms.
 *
 * WHY THIS EXISTS: from 2026-09-06 every signup was automated — a random
 * 16-20 character mixed-case username on every account, none of which ever
 * completed onboarding, against a scraped list of other people's addresses
 * (.gov, .edu, corporate). Each victim got a confirmation email and, seconds
 * later, a password-reset email, because the run signs up and then hits
 * /recover. `lexingtontn.gov` now hard-bounces us and three more addresses are
 * suppressed in Resend. See docs/pending-2026-09-14.md.
 *
 * INERT UNTIL CONFIGURED. With no `NEXT_PUBLIC_TURNSTILE_SITE_KEY` this renders
 * nothing and submits no token, so the code ships ahead of the dashboard switch
 * — the same order the email-confirmation work used. Turn it on in Supabase
 * (Authentication -> Attack Protection) only once a deploy carrying the site key
 * is live, or GoTrue starts rejecting every auth request for a missing token.
 *
 * ALL FOUR FORMS, NOT JUST SIGNUP. GoTrue applies the check to the sign-in and
 * recovery endpoints too, so wiring signup alone would have left login and
 * password reset returning "captcha protection: request disallowed" the moment
 * the dashboard setting flipped. `tests/unit/captcha.test.ts` fails if a caller
 * is dropped.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** Field name lives in `lib/captcha` — a plain module, importable from both
 *  sides. Exported from here it crossed the RSC boundary as a client reference
 *  and the server read the wrong key. See that file. */

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<void> | null = null

/** One script tag per document, however many widgets mount. */
function loadTurnstile(): Promise<void> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('turnstile script failed')))
      return
    }
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('turnstile script failed'))
    document.head.appendChild(s)
  })
  return scriptPromise
}

export function Turnstile({ resetOn }: { resetOn?: unknown }) {
  const host = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const [token, setToken] = useState('')

  useEffect(() => {
    if (!SITE_KEY) return
    let cancelled = false
    loadTurnstile()
      .then(() => {
        if (cancelled || !host.current || !window.turnstile) return
        widgetId.current = window.turnstile.render(host.current, {
          sitekey: SITE_KEY,
          // We carry the token in our own hidden input below. Turnstile's
          // injected field would collide with it on the same name.
          'response-field': false,
          // The auth cards are light. 'dark' shipped with the inert widget, when
          // nobody could see it, and read as a black slab once the key went in.
          theme: 'light',
          callback: (t: string) => setToken(t),
          'expired-callback': () => setToken(''),
          'error-callback': () => setToken(''),
        })
      })
      .catch(() => {
        // Cloudflare unreachable. Leaving the token empty is the honest state:
        // GoTrue refuses the request and the user sees the mapped message,
        // rather than the form silently pretending to work.
      })
    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
      widgetId.current = null
    }
  }, [])

  // A token is single-use. `resetOn` is the action's returned state object,
  // which is a new reference on every result, so a refused submit always gets a
  // fresh challenge instead of replaying a spent one.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current)
      setToken('')
    }
  }, [resetOn])

  if (!SITE_KEY) return null

  return (
    <div className="fl-captcha">
      <div ref={host} />
      <input type="hidden" name={CAPTCHA_FIELD} value={token} readOnly />
    </div>
  )
}
