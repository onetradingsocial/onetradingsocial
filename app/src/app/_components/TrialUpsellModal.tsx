'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { TrialPlanPicker } from '@/app/_components/TrialPlanPicker'

const CLOSE: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
)

/** The IN-TRIAL upsell, opened from the nav countdown chip and the final-days
 *  banner. Unlike TrialGateModal this one IS dismissible — Escape, backdrop
 *  click and a close button are all correct here, because the user is not
 *  walled, they are browsing mid-trial and can carry on.
 *
 *  It is a separate component from the wall on purpose: there is no shared
 *  `mode` flag that could make the wall closeable. It also has NO "Continue on
 *  Free" button — there is nothing to acknowledge yet.
 *
 *  It exists because during a trial getTier() returns 'pro', so /settings/billing
 *  shows Pro as the disabled current plan and its remaining CTAs POST to the
 *  billing portal. For a GRANDFATHERED card-free trial that portal call 400s,
 *  because such a trial creates no Stripe customer, and this modal is the only
 *  working subscribe path. A Stripe trialist does have a customer and can use
 *  the portal — they reach this modal from the same chip, so it has to be
 *  honest for both.
 *
 *  `cardOnFile` is what keeps it honest. "No charge until you subscribe" is
 *  true of the card-free trial and flatly false of the Stripe one, where a
 *  charge is already scheduled. */
export function TrialUpsellModal({
  daysLeft,
  cardOnFile = false,
  cancelling = false,
  onClose,
}: {
  daysLeft: number
  cardOnFile?: boolean
  /** Card on file but the customer has cancelled — no charge follows. */
  cancelling?: boolean
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  // Escape to close, body scroll lock, and a focus trap. `mounted` is in the
  // deps for the same reason as the wall: the card does not exist until the
  // mount guard below lets it render, so focusing it any earlier is a no-op.
  useEffect(() => {
    if (!mounted) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cardRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
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
  }, [mounted, onClose])

  if (!mounted) return null

  return createPortal(
    <div
      className="tg-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="tg-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tu-title"
        ref={cardRef}
        tabIndex={-1}
      >
        <button type="button" className="tg-close" onClick={onClose} aria-label="Close">{CLOSE}</button>

        <div className="tg-head">
          <span className="tg-eyebrow"><span className="dot" />
            {daysLeft === 1 ? '1 day left' : `${daysLeft} days left`}
          </span>
          <h2 id="tu-title">{cardOnFile ? 'Your plan after the trial.' : 'Keep Pro after your trial.'}</h2>
          <p>
            {/* Learn hidden for now — we are not financial advisors. This line read
                '…MT5 sync and premium courses stay exactly where they are.'
                Restore when compliant. */}
            {/* "Subscribe to Pro", not "Subscribe": the sentence promises MT5
                sync keeps running, which is true of Pro and false of the Trader
                card sitting right beneath it. See TRADER_SYNC_WARNING_TRIAL. */}
            You are on Pro until your trial ends. Subscribe to Pro now and nothing changes when
            it does — unlimited journal, advanced analytics and MT5 sync stay exactly
            where they are.
            {cardOnFile && cancelling
              ? ' You have cancelled, so nothing will be charged and your account moves to Free when the trial ends. You can change your mind in Settings → Billing.'
              : cardOnFile
              ? ' Your card is already on file, so your plan continues automatically unless you cancel in Settings → Billing.'
              : ' No charge until you subscribe.'}
          </p>
        </div>

        {/* A card-on-file trialist ALREADY has a subscription, and checkout only
            ever creates another — it never modifies one. Offering the picker
            here would let someone mid-trial on Pro buy Trader and end up paying
            for both. The route refuses it now (409), but a button that exists
            only to return an error is not an improvement, so they get the
            billing page instead, which is where a plan change belongs. */}
        {cardOnFile ? (
          <Link className="btn btn-primary tg-cta" href="/settings/billing" onClick={onClose}>
            Manage my plan
          </Link>
        ) : (
          <TrialPlanPicker midTrial />
        )}
      </div>
    </div>,
    document.body,
  )
}
