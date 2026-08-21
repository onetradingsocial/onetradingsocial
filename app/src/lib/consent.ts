/**
 * Consent state, shared with the marketing site.
 *
 * The authoritative implementation and the legal rationale for the defaults
 * live in `/consent.js` at the repo root (served from the marketing origin).
 * This is the app-side mirror: same cookie name, same encoding, same defaults,
 * so a visitor who answers the notice on www.tradingsocial.io is not asked
 * again on app.tradingsocial.io. The cookie is written on `.tradingsocial.io`
 * precisely so both origins read one answer.
 *
 * Tiers (audit item 17, findings 5 and 6):
 *   analytics — GA4 + the first-party /api/track funnel. Default ON (opt-out).
 *               Australia has no ePrivacy-style consent rule; the obligation is
 *               APP 1.4 disclosure, which /privacy section 10 satisfies.
 *   ads       — Meta Pixel, Reddit Pixel, and the Reddit Conversions API.
 *               Default OFF (opt-in), because these transmit persistent
 *               identifiers to advertising networks (APP 6) and the CAPI leg is
 *               server-side and unreachable by any browser control.
 *
 * KEEP THE TWO DEFAULT CONSTANTS IN SYNC WITH /consent.js.
 */

export const CONSENT_COOKIE = 'ts_consent'
export const CONSENT_VERSION = 1

export const ANALYTICS_DEFAULT = true
export const ADS_DEFAULT = false

/** 180 days, then we ask again. */
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 180

export interface ConsentState {
  analytics: boolean
  ads: boolean
  /** False when no valid cookie was present, i.e. these are the defaults. */
  decided: boolean
}

export const CONSENT_DEFAULT: ConsentState = {
  analytics: ANALYTICS_DEFAULT,
  ads: ADS_DEFAULT,
  decided: false,
}

/**
 * Parse the cookie value `v:1|a:1|d:0`. A version mismatch returns null so the
 * visitor is re-asked rather than having a stale answer applied to tiers that
 * may since have changed meaning.
 */
export function parseConsent(raw: string | null | undefined): ConsentState | null {
  if (!raw) return null
  const out: Record<string, string> = {}
  for (const pair of raw.split('|')) {
    const idx = pair.indexOf(':')
    if (idx > 0) out[pair.slice(0, idx)] = pair.slice(idx + 1)
  }
  if (out.v !== String(CONSENT_VERSION)) return null
  // Both tier keys must actually be present. A truncated value like "v:1" would
  // otherwise parse as "declined everything, and already decided", which is
  // safe for tracking but permanently suppresses the notice — the visitor could
  // never turn anything back on because they would never be asked again.
  if (out.a == null || out.d == null) return null
  return { analytics: out.a === '1', ads: out.d === '1', decided: true }
}

export function serializeConsent(analytics: boolean, ads: boolean): string {
  return `v:${CONSENT_VERSION}|a:${analytics ? 1 : 0}|d:${ads ? 1 : 0}`
}

/** Google Consent Mode v2 signal for a given state (audit item 17 finding 5). */
export function consentSignal(s: ConsentState): Record<string, 'granted' | 'denied'> {
  const ads = s.ads ? 'granted' : 'denied'
  return {
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: ads,
    analytics_storage: s.analytics ? 'granted' : 'denied',
  }
}

/**
 * Isomorphic core of the read: turn a raw `ts_consent` cookie value into a
 * state, falling back to the documented defaults when it is absent or
 * unreadable. Shared by the client `readConsent()` below and by the server-side
 * gate in `/api/track`, so the two enforcement points cannot drift apart.
 *
 * Note this is the OPT-OUT default: no cookie means analytics is on. Only an
 * explicitly parsed `a:0` yields `analytics: false`.
 */
export function consentFromCookie(raw: string | null | undefined): ConsentState {
  if (raw == null) return CONSENT_DEFAULT
  let value = raw
  try {
    value = decodeURIComponent(raw)
  } catch {
    // Malformed percent-escape: fall back to the raw value rather than throwing.
  }
  return parseConsent(value) ?? CONSENT_DEFAULT
}

/** Client-side read. Returns the documented defaults when nothing is stored. */
export function readConsent(): ConsentState {
  if (typeof document === 'undefined') return CONSENT_DEFAULT
  const m = document.cookie.match(/(?:^|;\s*)ts_consent=([^;]*)/)
  return consentFromCookie(m ? m[1] : null)
}

function cookieDomain(hostname: string): string {
  return /(^|\.)tradingsocial\.io$/.test(hostname) ? '; domain=.tradingsocial.io' : ''
}

/** Client-side write. Mirrors /consent.js exactly. */
export function writeConsent(analytics: boolean, ads: boolean): void {
  if (typeof document === 'undefined') return
  document.cookie =
    `${CONSENT_COOKIE}=${serializeConsent(analytics, ads)}` +
    `; path=/; max-age=${CONSENT_MAX_AGE}; samesite=lax` +
    (location.protocol === 'https:' ? '; secure' : '') +
    cookieDomain(location.hostname)
}

/**
 * Cookies each tier is responsible for, from the live inventory in audit item
 * 17. Revoking a tier purges these, otherwise "decline" leaves the identifier
 * it was supposed to remove sitting in the jar.
 */
const TRACKER_COOKIES: Record<'analytics' | 'ads', RegExp[]> = {
  analytics: [/^_ga$/, /^_ga_/, /^_gid$/, /^_gat/],
  ads: [/^_fbp$/, /^_fbc$/, /^_rdt_uuid$/, /^_rdt_em$/, /^rdt_cid$/],
}

export function purgeTier(tier: 'analytics' | 'ads'): void {
  if (typeof document === 'undefined') return
  const pats = TRACKER_COOKIES[tier]
  for (const raw of document.cookie.split(';')) {
    const name = raw.split('=')[0].trim()
    if (!pats.some((p) => p.test(name))) continue
    // Host and registrable domain: gtag writes to the latter, so clearing only
    // the host would leave the client id alive.
    document.cookie = `${name}=; path=/; max-age=0`
    document.cookie = `${name}=; path=/; max-age=0${cookieDomain(location.hostname)}`
  }
  if (tier === 'analytics') {
    try {
      localStorage.removeItem('ts_anon_id')
      localStorage.removeItem('ts_anon_id_exp')
    } catch {
      // storage disabled — nothing to purge
    }
  }
}
