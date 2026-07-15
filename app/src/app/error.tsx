'use client'

import { useEffect } from 'react'
import { track } from '@/lib/track'

/** Route-segment error boundary: logs the error, offers retry. */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    track('client_error', {
      message: String(error?.message ?? 'unknown').slice(0, 300),
      digest: error?.digest ?? null,
    })
  }, [error])

  return (
    <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: '48px 20px' }}>
      <div style={{ textAlign: 'center', maxWidth: 440 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, marginBottom: 10 }}>Something went wrong</h1>
        <p style={{ opacity: 0.7, marginBottom: 24 }}>
          The error has been reported automatically. You can retry, or head back home.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={reset}>Try again</button>
          <a href="/" className="btn">Go home</a>
        </div>
      </div>
    </main>
  )
}
