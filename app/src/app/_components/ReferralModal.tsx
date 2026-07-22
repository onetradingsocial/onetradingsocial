'use client'

import { useEffect, useRef, useState } from 'react'

export type ReferralSummary = {
  code: string
  signups: number
  activated: number
  months: number
  cap: number
}

/* ── icons ── */
const CLOSE = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
)
const COPY = (
  <svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="2" /><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
)
const X_LOGO = (
  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7.6 8.7L23 22h-6.6l-5.2-6.6L5.2 22H2l8.1-9.3L1.5 2h6.8l4.7 6.1L18.9 2zm-1.2 18.2h1.8L7.4 3.7H5.5l12.2 16.5z" /></svg>
)
const MAIL = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18v12H3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const WHATSAPP = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M12 3a9 9 0 00-7.8 13.5L3 21l4.7-1.2A9 9 0 1012 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M8.5 8.7c.3-.7 1-1.4 1.7-1.4.4 0 .8.5 1.2 1.3.3.6.9 2 .4 2.6-.6.7.4 1.7 1.1 2.3.7.6 1.7 1.5 2.4.9.6-.5 2 .1 2.6.4.8.4 1.3.8 1.3 1.2 0 .8-1 2.1-2.4 2.1-2.6 0-6.6-2.7-8.3-6.3-.5-1-.4-2.2 0-3.1z" fill="currentColor" /></svg>
)

const SHARE_TEXT = "I'm journaling my trades on TradingSocial — join with my link and we both get Pro free:"

export function ReferralModal({
  summary,
  loading,
  onClose,
}: {
  summary: ReferralSummary | null
  loading: boolean
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on Escape; lock the page behind the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const link = summary ? `${origin}/r/${summary.code}` : ''
  const months = summary?.months ?? 0
  const cap = summary?.cap ?? 12
  const remaining = Math.max(0, cap - months)

  const copyLink = () => {
    inputRef.current?.select()
    navigator.clipboard?.writeText(link).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const claim = async () => {
    setClaiming(true)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flow: 'referral' }),
      })
      const { url } = (await res.json().catch(() => ({}))) as { url?: string }
      if (res.ok && url) { window.location.href = url; return }
      alert('Could not start checkout. Please try again.')
    } catch {
      alert('Could not start checkout. Please try again.')
    }
    setClaiming(false)
  }

  const shareUrl = encodeURIComponent(link)
  const shareText = encodeURIComponent(SHARE_TEXT)

  return (
    <div className="ref-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ref-modal" role="dialog" aria-modal="true" aria-label="Refer traders, earn free Pro">
        <div className="ref-banner">
          <div className="ref-banner-noise" />
          <button className="ref-close" onClick={onClose} aria-label="Close">{CLOSE}</button>
          <span className="ref-eyebrow"><span className="dot" />Referral program</span>
          <h1>Refer a trader.<br />Earn Pro, free.</h1>
          <p>Every trader who joins with your link and logs their first trade earns you <b>1 month of Pro, free</b> — up to <b>a full year</b>.</p>
        </div>

        {loading || !summary ? (
          <div className="ref-loading"><div className="ref-spinner" /><span>Loading your referrals…</span></div>
        ) : (
          <div className="ref-body">
            <div className="ref-progress-head">
              <span className="lbl">Free Pro unlocked</span>
              <span className="val">{months} of {cap} months</span>
            </div>
            <div className="ref-track">
              {Array.from({ length: cap }, (_, i) => (
                <div key={i} className={`ref-seg${i < months ? ' filled' : ''}`} />
              ))}
            </div>
            <div className="ref-track-caption"><span>0 months</span><span>{cap} months free</span></div>

            <div className="ref-stats">
              <div className="ref-stat">
                <div className="k">Traders joined</div>
                <div className="v">{summary.signups}</div>
                <div className="s">{summary.activated} logged a trade</div>
              </div>
              <div className="ref-stat">
                <div className="k">Pro earned</div>
                <div className="v"><em>{months} {months === 1 ? 'month' : 'months'}</em></div>
                <div className="s">{remaining > 0 ? `${remaining} more to max out` : 'Fully maxed out'}</div>
              </div>
            </div>

            <div className="ref-link">
              <input ref={inputRef} type="text" readOnly value={link} aria-label="Your referral link" />
              <button className={`ref-copy${copied ? ' copied' : ''}`} onClick={copyLink}>
                {COPY}<span>{copied ? 'Copied!' : 'Copy link'}</span>
              </button>
            </div>

            <div className="ref-share">
              <a href={`https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`} target="_blank" rel="noopener noreferrer" aria-label="Share to X" title="Share to X">{X_LOGO}</a>
              <a href={`mailto:?subject=${encodeURIComponent('Join me on TradingSocial')}&body=${shareText}%20${shareUrl}`} aria-label="Share via email" title="Share via email">{MAIL}</a>
              <a href={`https://wa.me/?text=${shareText}%20${shareUrl}`} target="_blank" rel="noopener noreferrer" aria-label="Share to WhatsApp" title="Share to WhatsApp">{WHATSAPP}</a>
            </div>

            {months >= 1 ? (
              <button className="btn btn-primary ref-cta" onClick={claim} disabled={claiming}>
                {claiming ? 'Starting checkout…' : `Claim ${months} ${months === 1 ? 'month' : 'months'} of Pro free`}
              </button>
            ) : (
              <button className="btn btn-primary ref-cta" onClick={copyLink}>
                Copy your link to start earning
              </button>
            )}

            <p className="ref-fine">
              {months >= 1
                ? 'A card is required to claim — $0 due today. After your free months end, Pro renews at the monthly rate and you can cancel anytime.'
                : 'Rewards unlock when a referred trader logs their first trade. Self-referrals don’t count and each trader can only be referred once.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
