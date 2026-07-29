'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import type { Interval } from '@/lib/entitlements'
import { TRIAL_DAYS } from '@/lib/entitlements'
import { PAID_PLANS } from '@/lib/plans'
import { ackTrial } from '@/app/actions/trial'
import { trackMeta } from '@/app/_components/MetaPixel'

const CHK: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

// Subscribing has to land somewhere, so billing is the one page the wall skips.
const EXEMPT_PATHS = ['/settings/billing']

export function TrialGateModal({ show }: { show: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [interval, setInterval] = useState<Interval>('monthly')
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  const exempt = EXEMPT_PATHS.some((p) => pathname?.startsWith(p))
  const open = show && !exempt

  // Lock the page behind the modal and trap focus inside it. Deliberately NO
  // Escape handler and NO backdrop-click close — this modal must be answered.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cardRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])

  const subscribe = async (tier: 'trader' | 'pro') => {
    setBusy(true); setError(null)
    trackMeta('InitiateCheckout', { content_name: `${tier}_${interval}` })
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier, interval, flow: 'trial_end' }),
      })
      const { url } = (await res.json().catch(() => ({}))) as { url?: string }
      if (res.ok && url) { window.location.href = url; return }
      setError('Could not start checkout. Please try again.')
    } catch {
      setError('Could not start checkout. Please try again.')
    }
    setBusy(false)
  }

  const continueFree = async () => {
    setBusy(true); setError(null)
    const result = await ackTrial()
    if (!result.ok) { setError(result.error); setBusy(false); return }
    router.refresh()
  }

  if (!mounted || !open) return null

  // Portal to <body> so the fixed backdrop escapes the nav's backdrop-filter,
  // which would otherwise become its containing block and clip it.
  return createPortal(
    <div className="tg-backdrop">
      <div
        className="tg-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tg-title"
        ref={cardRef}
        tabIndex={-1}
      >
        <div className="tg-head">
          <span className="tg-eyebrow"><span className="dot" />Trial ended</span>
          <h1 id="tg-title">Your {TRIAL_DAYS} days of Pro have ended.</h1>
          <p>
            Keep the full toolkit — unlimited journal, advanced analytics, MT5 sync and premium
            courses — or continue on Free with your last 30 trades, basic stats, the feed and the
            leaderboard.
          </p>
        </div>

        <div className="tg-billing">
          <button
            type="button"
            className={`tg-bopt${interval === 'monthly' ? ' on' : ''}`}
            onClick={() => setInterval('monthly')}
          >Monthly</button>
          <button
            type="button"
            className={`tg-bopt${interval === 'annual' ? ' on' : ''}`}
            onClick={() => setInterval('annual')}
          >Annual</button>
        </div>

        <div className="tg-grid">
          {PAID_PLANS.map((p) => (
            <div key={p.tier} className={`tg-card${p.tier === 'pro' ? ' pop' : ''}`}>
              <span className="tg-name"><span className={`fl-pip ${p.pip}`} />{p.name}</span>
              <div className="tg-price">
                <span className="cur">$</span>
                <span className="amt">{interval === 'monthly' ? p.monthly : p.annual}</span>
                <span className="per">/mo</span>
              </div>
              <div className="tg-billed">{interval === 'monthly' ? p.billedM : p.billedA}</div>
              <ul className="tg-feats">
                {p.feats.map((f, i) => (
                  <li key={i}><span className="chk">{CHK}</span><span>{f.t}</span></li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn-primary tg-cta"
                disabled={busy}
                onClick={() => subscribe(p.tier)}
              >
                {busy ? 'Starting…' : `Subscribe to ${p.name}`}
              </button>
            </div>
          ))}
        </div>

        {error && <p className="tg-error" role="alert">{error}</p>}

        <button type="button" className="tg-free" disabled={busy} onClick={continueFree}>
          Continue on Free
        </button>
      </div>
    </div>,
    document.body,
  )
}
