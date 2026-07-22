'use client'

import { useCallback, useEffect, useState } from 'react'
import { ReferralModal, type ReferralSummary } from './ReferralModal'

const GIFT = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M5 12v7a1 1 0 001 1h12a1 1 0 001-1v-7" />
    <path d="M12 8S10.5 3 8 3a2.5 2.5 0 000 5h4zM12 8s1.5-5 4-5a2.5 2.5 0 010 5h-4z" />
  </svg>
)

/**
 * Opens the referral modal from the app nav. The funnel data is fetched lazily
 * the first time the modal opens (and refreshed on each open) so the nav itself
 * stays cheap. `?refer=1` (e.g. from the help widget) auto-opens it.
 */
export function ReferralLauncher() {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<ReferralSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/referrals/summary', { cache: 'no-store' })
      if (res.ok) setSummary((await res.json()) as ReferralSummary)
    } catch { /* modal shows the loading state; user can retry by reopening */ }
    setLoading(false)
  }, [])

  const openModal = useCallback(() => { setOpen(true); load() }, [load])

  // Deep-link: /somewhere?refer=1 (e.g. from the help widget) auto-opens it.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('refer') === '1') openModal()
  }, [openModal])

  return (
    <>
      <button
        type="button"
        className="ts-nav-icon"
        title="Refer &amp; earn free Pro"
        aria-label="Refer &amp; earn free Pro"
        onClick={openModal}
      >
        {GIFT}
      </button>
      {open && <ReferralModal summary={summary} loading={loading} onClose={() => setOpen(false)} />}
    </>
  )
}
