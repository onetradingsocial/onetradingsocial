'use client'

import { useEffect } from 'react'

/** Root-layout crash fallback. Must render its own <html>; keeps deps minimal. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try {
      const body = JSON.stringify({
        event: 'client_error',
        props: { message: String(error?.message ?? 'unknown').slice(0, 300), digest: error?.digest ?? null, fatal: true },
        path: location.pathname,
      })
      navigator.sendBeacon?.('/api/track', new Blob([body], { type: 'application/json' }))
    } catch { /* never throw from the crash handler */ }
  }, [error])

  return (
    <html lang="en">
      <body style={{ background: '#0b0e14', color: '#e8ecf4', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <div style={{ textAlign: 'center', maxWidth: 440 }}>
            <h1 style={{ fontSize: 26, marginBottom: 10 }}>Something went wrong</h1>
            <p style={{ opacity: 0.7, marginBottom: 24 }}>The error has been reported. Try reloading the page.</p>
            <button
              type="button"
              onClick={reset}
              style={{ padding: '10px 22px', borderRadius: 10, border: 0, cursor: 'pointer', fontWeight: 600 }}
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
