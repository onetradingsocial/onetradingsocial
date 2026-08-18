import Script from 'next/script'
import { consentSignal, type ConsentState } from '@/lib/consent'

export const GA_ID = 'G-M7NX0Y7NSC'

/**
 * GA4 with cross-domain linker so tradingsocial.io → app.tradingsocial.io
 * stays one attributed session. `isInternal` tags every hit with
 * traffic_type=internal (admins, seeded demo users) — pair with the
 * "Internal Traffic" data filter activated in the GA4 console.
 *
 * Consent (audit item 17, findings 5 to 7 and 10):
 *
 * - When the analytics tier is denied this renders NOTHING. gtag.js is never
 *   requested, so no beacon leaves the browser. Consent Mode alone would not
 *   achieve that — with analytics_storage:'denied' GA4 still sends cookieless
 *   pings to google-analytics.com, which is not what "decline" means to a
 *   person reading the notice.
 * - When it is granted, Consent Mode v2 defaults are declared before gtag.js
 *   loads, so the ad_* signals reflect the separate advertising answer. That is
 *   what switches off Google Signals personalisation (previously npa=0 with no
 *   consent state declared at all).
 * - cookie_flags adds Secure to _ga/_ga_* (finding 7) and cookie_expires pins
 *   13 months as a deliberate retention decision rather than GA's 2-year
 *   request silently clamped to 400 days by the browser (finding 10).
 *
 * The consent state is read server-side in layout.tsx, and CookieNotice
 * reloads the page when a choice is revoked, so this stays truthful without
 * needing to be a client component.
 */
export function GoogleAnalytics({
  isInternal,
  consent,
}: {
  isInternal: boolean
  consent: ConsentState
}) {
  if (!consent.analytics) return null

  const signal = JSON.stringify(consentSignal(consent))

  return (
    <>
      <Script id="ga4-init" strategy="afterInteractive">{`
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        window.gtag = gtag;
        gtag('consent', 'default', ${signal});
        gtag('js', new Date());
        gtag('config', '${GA_ID}', {
          linker: { domains: ['tradingsocial.io', 'app.tradingsocial.io'] },
          cookie_flags: 'SameSite=Lax;Secure',
          cookie_expires: 34128000,
          send_page_view: false${isInternal ? ",\n          traffic_type: 'internal'" : ''}
        });
      `}</Script>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
    </>
  )
}
