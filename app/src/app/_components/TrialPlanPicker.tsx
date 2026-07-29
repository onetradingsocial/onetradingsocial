'use client'

import { useState, type ReactNode } from 'react'
import type { Interval } from '@/lib/entitlements'
import { PAID_PLANS } from '@/lib/plans'
import { trackMeta } from '@/app/_components/MetaPixel'

const CHK: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

/** The billing toggle, the two paid plan cards, the checkout POST and its inline
 *  error — shared by the end-of-trial wall (TrialGateModal) and the in-trial
 *  upsell (TrialUpsellModal) so the plan markup exists once.
 *
 *  It deliberately owns NO dismissal behaviour of any kind. Whether the
 *  surrounding modal can be closed is entirely the parent's business, which is
 *  what keeps the wall non-escapable while the upsell is freely dismissible.
 *
 *  `onBusyChange` lets a parent disable its own actions while a checkout is
 *  starting; `disabled` lets it disable these while its own action runs. */
export function TrialPlanPicker({
  disabled = false,
  onBusyChange,
}: {
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
}) {
  const [billing, setBilling] = useState<Interval>('monthly')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const markBusy = (b: boolean) => { setBusy(b); onBusyChange?.(b) }

  const subscribe = async (tier: 'trader' | 'pro') => {
    markBusy(true); setError(null)
    trackMeta('InitiateCheckout', { content_name: `${tier}_${billing}` })
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier, interval: billing, flow: 'trial_end' }),
      })
      const { url } = (await res.json().catch(() => ({}))) as { url?: string }
      // Leave the busy state set on success — we are navigating away, and
      // re-enabling the buttons would only invite a second checkout session.
      if (res.ok && url) { window.location.href = url; return }
      setError('Could not start checkout. Please try again.')
    } catch {
      setError('Could not start checkout. Please try again.')
    }
    markBusy(false)
  }

  const off = disabled || busy

  return (
    <>
      <div className="tg-billing">
        <button
          type="button"
          className={`tg-bopt${billing === 'monthly' ? ' on' : ''}`}
          onClick={() => setBilling('monthly')}
        >Monthly</button>
        <button
          type="button"
          className={`tg-bopt${billing === 'annual' ? ' on' : ''}`}
          onClick={() => setBilling('annual')}
        >Annual</button>
      </div>

      <div className="tg-grid">
        {PAID_PLANS.map((p) => (
          <div key={p.tier} className={`tg-card${p.tier === 'pro' ? ' pop' : ''}`}>
            <span className="tg-name"><span className={`fl-pip ${p.pip}`} />{p.name}</span>
            <div className="tg-price">
              <span className="cur">$</span>
              <span className="amt">{billing === 'monthly' ? p.monthly : p.annual}</span>
              <span className="per">/mo</span>
            </div>
            <div className="tg-billed">{billing === 'monthly' ? p.billedM : p.billedA}</div>
            <ul className="tg-feats">
              {p.feats.map((f, i) => (
                <li key={i}><span className="chk">{CHK}</span><span>{f.t}</span></li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-primary tg-cta"
              disabled={off}
              onClick={() => subscribe(p.tier)}
            >
              {busy ? 'Starting…' : `Subscribe to ${p.name}`}
            </button>
          </div>
        ))}
      </div>

      {error && <p className="tg-error" role="alert">{error}</p>}
    </>
  )
}
