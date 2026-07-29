'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { TRIAL_DAYS } from '@/lib/entitlements'
import { ackTrial } from '@/app/actions/trial'
import { TrialPlanPicker } from '@/app/_components/TrialPlanPicker'

// Subscribing has to land somewhere, so billing is the one page the wall skips.
const EXEMPT_PATHS = ['/settings/billing']

/** The end-of-trial WALL. It is not escapable: no Escape handler, no
 *  backdrop-click close, no close button, no logout. Its only actions are
 *  Subscribe to Trader, Subscribe to Pro, and Continue on Free.
 *
 *  The dismissible in-trial variant is a SEPARATE component
 *  (TrialUpsellModal). Keeping them apart is deliberate — there is no `mode`
 *  prop here that could accidentally render the wall in a closeable state. */
export function TrialGateModal({ show }: { show: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  const exempt = EXEMPT_PATHS.some((p) => pathname?.startsWith(p))
  const open = show && !exempt

  // Lock the page behind the modal and trap focus inside it. Deliberately NO
  // Escape handler and NO backdrop-click close — this modal must be answered.
  //
  // `mounted` is in the deps because the card does not exist until after the
  // mount guard below lets it render: on the first pass cardRef.current is null,
  // so focus() was a silent no-op and Tab walked straight out into the page
  // behind the wall. The effect has to re-run once the card is actually there.
  useEffect(() => {
    if (!open || !mounted) return
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
  }, [open, mounted])

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
          {/* h2, not h1: the page underneath already owns the document's h1. */}
          <h2 id="tg-title">Your {TRIAL_DAYS} days of Pro have ended.</h2>
          <p>
            Keep the full toolkit — unlimited journal, advanced analytics, MT5 sync and premium
            courses — or continue on Free with your last 30 trades, basic stats, the feed and the
            leaderboard.
          </p>
        </div>

        <TrialPlanPicker disabled={busy} onBusyChange={setCheckoutBusy} />

        {error && <p className="tg-error" role="alert">{error}</p>}

        <button
          type="button"
          className="tg-free"
          disabled={busy || checkoutBusy}
          onClick={continueFree}
        >
          Continue on Free
        </button>
      </div>
    </div>,
    document.body,
  )
}
