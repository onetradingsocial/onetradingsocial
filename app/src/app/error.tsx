'use client'

import { useEffect } from 'react'
import { track } from '@/lib/track'
import { classifyClientError } from '@/lib/redact'

/**
 * Route-segment error boundary: reports the error, offers retry.
 *
 * ── Audit item 19, F1 ────────────────────────────────────────────────────────
 * This used to send `error.message` verbatim. `/api/track` writes it into
 * `analytics_events.props`, which had no retention policy and is joined to a
 * named account by `anon_id` — so an uncontrolled string (a Postgres error
 * echoing a column value, a failed fetch carrying a URL with its query string)
 * became indefinitely-stored, attributable data. The 300-character truncation
 * bounded the volume, not the sensitivity.
 *
 * It now sends a label from a fixed vocabulary plus `error.digest`, which is
 * the value that actually correlates to the full server-side stack in Vercel.
 * `kind` is the error's constructor name, which is bounded and author-written.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    track('client_error', {
      code: classifyClientError(error?.message, error?.name),
      kind: typeof error?.name === 'string' ? error.name.slice(0, 40) : 'Error',
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
