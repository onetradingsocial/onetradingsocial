'use client'

import { useEffect, useState } from 'react'
import { TrialUpsellModal } from './TrialUpsellModal'

/** Final-days nudge. The dismissal key includes the day count, so it shows
 *  once on each of the last few days rather than once ever.
 *
 *  "See plans" opens the in-trial upsell modal rather than linking to
 *  /settings/billing, which cannot sell anything to a trial user — see
 *  TrialUpsellModal for why. */
export function TrialEndingBanner({ daysLeft }: { daysLeft: number }) {
  const [hidden, setHidden] = useState(true)
  const [open, setOpen] = useState(false)
  const key = `ts_trial_nudge_${daysLeft}`

  useEffect(() => {
    setHidden(localStorage.getItem(key) === '1')
  }, [key])

  if (hidden) return null

  const dismiss = () => { localStorage.setItem(key, '1'); setHidden(true) }

  return (
    <div className="ts-trial-banner" role="status">
      <span>
        {/* Only rendered while the trial is active, which means daysLeft >= 1. */}
        Your Pro trial ends in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}.
        {' '}Keep unlimited journaling, advanced analytics and MT5 sync.
      </span>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        See plans
      </button>
      <button type="button" className="ts-banner-x" onClick={dismiss} aria-label="Dismiss">✕</button>
      {open && <TrialUpsellModal daysLeft={daysLeft} onClose={() => setOpen(false)} />}
    </div>
  )
}
