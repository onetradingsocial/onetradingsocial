import Script from 'next/script'

export const GA_ID = 'G-M7NX0Y7NSC'

/**
 * GA4 with cross-domain linker so tradingsocial.io → app.tradingsocial.io
 * stays one attributed session. `isInternal` tags every hit with
 * traffic_type=internal (admins, seeded demo users) — pair with the
 * "Internal Traffic" data filter activated in the GA4 console.
 */
export function GoogleAnalytics({ isInternal }: { isInternal: boolean }) {
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">{`
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        window.gtag = gtag;
        gtag('js', new Date());
        gtag('config', '${GA_ID}', {
          linker: { domains: ['tradingsocial.io', 'app.tradingsocial.io'] },
          send_page_view: false${isInternal ? ",\n          traffic_type: 'internal'" : ''}
        });
      `}</Script>
    </>
  )
}
