'use client'

import { useState } from 'react'

/** Copyable referral link. Client-only so it can read the current origin. */
export function ReferralLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const link = `${origin}/r/${code}`

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <code style={{
        flex: 1, minWidth: 240, padding: '10px 14px', borderRadius: 10,
        background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 13.5,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{link}</code>
      <button type="button" className="btn btn-primary" onClick={() => {
        navigator.clipboard?.writeText(link)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}>{copied ? 'Copied!' : 'Copy link'}</button>
    </div>
  )
}
