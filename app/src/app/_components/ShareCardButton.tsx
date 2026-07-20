'use client'

import { useState } from 'react'

/**
 * Share performance card (Sprint 4, row 37). Uses the same branded OG image the
 * profile advertises; copies the public link and offers a PNG download.
 */
export function ShareCardButton({ username }: { username: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const site = typeof window !== 'undefined' ? window.location.origin : ''
  const cardUrl = `${site}/api/og/profile/${username}`
  const profileUrl = `${site}/${username}`

  return (
    <>
      <button type="button" className="h-btn" onClick={() => setOpen(true)}>Share card</button>
      {open && (
        <div className="ts-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="ts-modal" style={{ maxWidth: 560 }}>
            <div className="ts-modal-head">
              <h2 className="ts-h2">Share your card</h2>
              <button type="button" className="ts-modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <img src={cardUrl} alt="Your performance card" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--border)' }} />
            <p className="faint mt-2" style={{ fontSize: 12.5 }}>Branded, verified, currency hidden — R multiples and percentages only.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <a className="btn btn-primary" href={cardUrl} download={`tradingsocial-${username}.png`}>Download PNG</a>
              <button type="button" className="btn" onClick={() => {
                navigator.clipboard?.writeText(profileUrl); setCopied(true); setTimeout(() => setCopied(false), 1500)
              }}>{copied ? 'Copied!' : 'Copy profile link'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
