'use client'

import { useEffect, useState } from 'react'
import { TrialUpsellModal } from './TrialUpsellModal'

/** Final-days nudge. The dismissal key includes the day count, so it shows
 *  once on each of the last few days rather than once ever.
 *
 *  "See plans" opens the in-trial upsell modal rather than linking to
 *  /settings/billing, which cannot sell anything to a trial user — see
 *  TrialUpsellModal for why.
 *
 *  ── TWO TRIALS, TWO JOBS ────────────────────────────────────────────────────
 *
 *  `cardOnFile` splits this banner into the only two things it can honestly be.
 *
 *    false — a GRANDFATHERED local trial. These accounts were sold a trial that
 *            takes no card and they will not be charged; when it lapses they
 *            simply drop to Free. So this is an invitation, and it says what
 *            they have to DO ("add a card") rather than implying a deadline
 *            they must act before to avoid a charge.
 *
 *    true  — a Stripe trial. A charge IS coming, so the banner is a reminder of
 *            it and the way out. It never claims an amount: the day-11 email
 *            carries the figure from Stripe, and a second number rendered from
 *            a different source is a second chance to be wrong.
 *
 *  The dismissal is `localStorage` and survives, which is defensible for an
 *  upsell and thinner for a pre-charge reminder — the email is the notice of
 *  record, and it cannot be dismissed. */
export function TrialEndingBanner({ daysLeft, cardOnFile, cancelling = false }: { daysLeft: number; cardOnFile: boolean; cancelling?: boolean }) {
  const [hidden, setHidden] = useState(true)
  const [open, setOpen] = useState(false)
  const key = `ts_trial_nudge_${cardOnFile ? (cancelling ? 'x' : 'c') : 'f'}_${daysLeft}`

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
        {cardOnFile && cancelling
          ? ' You have cancelled, so nothing will be charged and your account moves to Free.'
          : cardOnFile
          ? ' Your plan then continues on the card you saved — cancel before then and you are not charged.'
          : ' Add a card to keep unlimited journaling, advanced analytics and MT5 sync. Nothing is charged for this trial.'}
      </span>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        {cardOnFile ? 'Review plan' : 'Add a card'}
      </button>
      <button type="button" className="ts-banner-x" onClick={dismiss} aria-label="Dismiss">✕</button>
      {open && <TrialUpsellModal daysLeft={daysLeft} cardOnFile={cardOnFile} cancelling={cancelling} onClose={() => setOpen(false)} />}
    </div>
  )
}
