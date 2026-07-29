'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

/** Final-days nudge. The dismissal key includes the day count, so it shows
 *  once on each of the last few days rather than once ever. */
export function TrialEndingBanner({ daysLeft }: { daysLeft: number }) {
  const [hidden, setHidden] = useState(true)
  const key = `ts_trial_nudge_${daysLeft}`

  useEffect(() => {
    setHidden(localStorage.getItem(key) === '1')
  }, [key])

  if (hidden) return null

  const dismiss = () => { localStorage.setItem(key, '1'); setHidden(true) }

  return (
    <div className="ts-trial-banner" role="status">
      <span>
        {daysLeft === 0
          ? 'Your Pro trial ends today.'
          : `Your Pro trial ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}.`}
        {' '}Keep unlimited journaling, advanced analytics and MT5 sync.
      </span>
      <Link href="/settings/billing" className="btn btn-primary btn-sm">See plans</Link>
      <button type="button" onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  )
}
