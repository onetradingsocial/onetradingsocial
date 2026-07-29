'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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
 *  billing portal, which 400s (a trial creates no Stripe customer). This modal
 *  is the working subscribe path for a trial user. */
export function TrialUpsellModal({
  daysLeft,
  onClose,
}: {
  daysLeft: number
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
          <h2 id="tu-title">Keep Pro after your trial.</h2>
          <p>
            You are on Pro until your trial ends. Subscribe now and nothing changes when it does —
            unlimited journal, advanced analytics, MT5 sync and premium courses stay exactly where
            they are. No charge until you subscribe.
          </p>
        </div>

        <TrialPlanPicker />
      </div>
    </div>,
    document.body,
  )
}
