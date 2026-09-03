// app/tests/unit/consent.test.ts
//
// Audit item 17 (cookies & tracking), workstream 7.
//
// These are regression guards, not coverage decoration. Every assertion here
// corresponds to something that was actually wrong on the live site, and the
// failure mode for most of them is silent: a reverted default or a re-added
// inline pixel does not break a page, it just starts sending data again.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ADS_DEFAULT,
  ANALYTICS_DEFAULT,
  CONSENT_DEFAULT,
  CONSENT_VERSION,
  consentSignal,
  parseConsent,
  serializeConsent,
} from '@/lib/consent'
import { buildConversionBody, hashSha256 } from '@/lib/reddit-capi'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const MARKETING_PAGES = [
  'index.html',
  'pricing.html',
  'privacy.html',
  'terms.html',
  'disclaimer.html',
  'blog.html',
  'blog-post.html',
  '404.html',
  'for/index.html',
  'for/journal.html',
  'for/crypto.html',
  'for/forex.html',
  'for/futures.html',
  'for/mt5.html',
  'for/prop-firm.html',
  'for/educators.html',
]

describe('consent defaults', () => {
  // The graded position: Australia has no ePrivacy-style consent rule, so
  // analytics (pseudonymous, aggregate) is opt-out, while the advertising
  // pixels (persistent identifiers to ad networks, plus a server-side leg no
  // browser can block) are opt-in. Flipping either of these is a legal
  // decision, so it should not be possible to do it by accident.
  it('analytics is opt-out and advertising is opt-in', () => {
    expect(ANALYTICS_DEFAULT).toBe(true)
    expect(ADS_DEFAULT).toBe(false)
    expect(CONSENT_DEFAULT).toEqual({ analytics: true, ads: false, decided: false })
  })

  it('an absent or unreadable cookie is never treated as consent', () => {
    for (const raw of [null, undefined, '', 'garbage', 'v:1', 'a:1|d:1']) {
      expect(parseConsent(raw)).toBeNull()
    }
  })

  it('a cookie from an older tier definition is discarded, not honoured', () => {
    const stale = `v:${CONSENT_VERSION - 1}|a:1|d:1`
    expect(parseConsent(stale)).toBeNull()
  })
})

describe('consent cookie encoding', () => {
  it('round-trips every combination', () => {
    for (const analytics of [true, false]) {
      for (const ads of [true, false]) {
        expect(parseConsent(serializeConsent(analytics, ads))).toEqual({
          analytics,
          ads,
          decided: true,
        })
      }
    }
  })

  it('produces a value with no cookie-reserved characters', () => {
    const v = serializeConsent(true, false)
    expect(v).not.toMatch(/[;,\s]/)
  })
})

describe('Google Consent Mode v2 signal', () => {
  it('maps the advertising tier onto all three ad_* keys', () => {
    // ad_personalization is the one that controls npa / Google Signals. The
    // live site was sending npa=0 with no consent state declared at all.
    expect(consentSignal({ analytics: true, ads: false, decided: true })).toEqual({
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'granted',
    })
  })

  it('grants everything only when both tiers are granted', () => {
    expect(consentSignal({ analytics: true, ads: true, decided: true })).toEqual({
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted',
    })
  })

  it('denies analytics_storage when analytics is declined', () => {
    const s = consentSignal({ analytics: false, ads: false, decided: true })
    expect(s.analytics_storage).toBe('denied')
  })
})

describe('Reddit CAPI never transmits a raw IP (item 17 F3)', () => {
  it('hashes ip_address when one is supplied', () => {
    const body = buildConversionBody({
      eventType: 'SignUp',
      conversionId: 'cid-1',
      ip: '203.0.113.7',
      eventAt: 1730000000000,
    })
    const user = (body.data.events[0] as { user: Record<string, string | undefined> }).user
    expect(user.ip_address).toBe(hashSha256('203.0.113.7'))
    expect(user.ip_address).not.toBe('203.0.113.7')
    expect(user.ip_address).toMatch(/^[a-f0-9]{64}$/)
  })

  it('omits ip_address entirely when the caller sends none', () => {
    // The default path: app/src/app/actions/profile.ts only collects the IP
    // when REDDIT_CAPI_SEND_IP=1, so normally this field is simply absent.
    const body = buildConversionBody({
      eventType: 'SignUp',
      conversionId: 'cid-2',
      email: 'a@b.com',
      eventAt: 1730000000000,
    })
    const user = (body.data.events[0] as { user: Record<string, string | undefined> }).user
    expect(user).not.toHaveProperty('ip_address')
    expect(user).not.toHaveProperty('user_agent')
  })

  it('does not leak the raw value anywhere else in the payload', () => {
    const body = buildConversionBody({
      eventType: 'Purchase',
      conversionId: 'cid-3',
      ip: '198.51.100.42',
      userAgent: 'Mozilla/5.0',
      eventAt: 1730000000000,
    })
    expect(JSON.stringify(body)).not.toContain('198.51.100.42')
  })
})

describe('marketing pages load no tracker without the consent gate (item 17 F6)', () => {
  it.each(MARKETING_PAGES)('%s has no inline analytics or pixel loader', (page) => {
    const html = read(page)
    expect(html).not.toContain('googletagmanager.com/gtag/js')
    expect(html).not.toContain('connect.facebook.net')
    expect(html).not.toContain('redditstatic.com/ads/pixel.js')
    expect(html).not.toMatch(/\bfbq\(/)
    expect(html).not.toMatch(/\brdt\(/)
  })

  it.each(MARKETING_PAGES)('%s routes tags through /consent.js', (page) => {
    expect(read(page)).toContain('<script src="/consent.js"></script>')
  })

  it.each(MARKETING_PAGES)('%s has no un-declinable <noscript> Meta beacon', (page) => {
    // This one fired even with JavaScript disabled, i.e. for a visitor who
    // could not have been shown a notice or operated a control.
    expect(read(page)).not.toContain('facebook.com/tr?id=')
  })

  it.each(MARKETING_PAGES)('%s does not preconnect to Google Fonts', (page) => {
    // Fonts are self-hosted under /assets/fonts; the leftover preconnect still
    // performed a full TLS handshake, disclosing the visitor's IP to Google on
    // every page load for no benefit.
    expect(read(page)).not.toContain('fonts.gstatic.com')
    expect(read(page)).not.toContain('fonts.googleapis.com')
  })
})

describe('consent.js implements the gate it claims to', () => {
  const js = read('consent.js')

  it('defaults advertising off and analytics on, matching lib/consent.ts', () => {
    expect(js).toMatch(/var ANALYTICS_DEFAULT = true;/)
    expect(js).toMatch(/var ADS_DEFAULT = false;/)
  })

  it('declares Consent Mode before requesting gtag.js', () => {
    const consentDefault = js.indexOf("gtag('consent', 'default'")
    const loader = js.indexOf('googletagmanager.com/gtag/js')
    expect(consentDefault).toBeGreaterThan(-1)
    expect(loader).toBeGreaterThan(consentDefault)
  })

  it('sets Secure on the GA cookies and a 13-month lifetime', () => {
    expect(js).toContain("cookie_flags: 'SameSite=Lax;Secure'")
    expect(js).toContain('cookie_expires: 34128000')
  })

  it('sets Meta Limited Data Use before init', () => {
    const ldu = js.indexOf("fbq('dataProcessingOptions'")
    const init = js.indexOf("fbq('init'")
    expect(ldu).toBeGreaterThan(-1)
    expect(init).toBeGreaterThan(ldu)
  })

  it('purges the identifiers a revoked tier had already set', () => {
    expect(js).toContain('_fbp')
    expect(js).toContain('_rdt_uuid')
    expect(js).toContain('ts_anon_id')
    expect(js).toContain('location.reload()')
  })
})

describe('content security policy reports somewhere (item 17 F8)', () => {
  it('the marketing CSP has a report endpoint and no img-src wildcard', () => {
    const csp = JSON.parse(read('vercel.json'))
      .headers.flatMap((h: { headers: { key: string; value: string }[] }) => h.headers)
      .find((h: { key: string; value: string }) => h.key.startsWith('Content-Security-Policy'))?.value as string
    expect(csp).toContain('report-uri')
    expect(csp).not.toMatch(/img-src[^;]*\shttps:\s*(;|$)/)
  })

  it('the app CSP has a report endpoint and no img-src wildcard', () => {
    const cfg = read('app/next.config.ts')
    expect(cfg).toContain("report-uri /api/csp-report")
    expect(cfg).not.toMatch(/img-src[^"]*\shttps:\s"/)
  })
})
