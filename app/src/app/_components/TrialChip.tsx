'use client'

import { useState } from 'react'
import { TrialUpsellModal } from './TrialUpsellModal'

/** Nav countdown chip. It opens the in-trial upsell modal rather than linking to
 *  /settings/billing, which cannot actually sell anything to a trial user: during
 *  the trial getTier() returns 'pro', so that page shows Pro as the disabled
 *  current plan and its other CTAs POST to the billing portal, which 400s
 *  because a trial creates no Stripe customer.
 *
 *  Rendered as a button rather than a link for the same reason, and styled by
 *  the unchanged .ts-trial-chip rule so it stays visually identical. */
export function TrialChip({ daysLeft }: { daysLeft: number }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="ts-trial-chip"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        PRO TRIAL · {daysLeft}d left
      </button>
      {open && <TrialUpsellModal daysLeft={daysLeft} onClose={() => setOpen(false)} />}
    </>
  )
}
