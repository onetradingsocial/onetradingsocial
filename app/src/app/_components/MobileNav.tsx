'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { NewTradeButton } from './NewTradeButton'
import { TrialUpsellModal } from './TrialUpsellModal'

const PAGES = [
  { href: '/', label: 'Home', exact: true },
  { href: '/journal', label: 'Journal' },
  { href: '/leaderboard', label: 'Leaderboard' },
  // Learn hidden for now — we are not financial advisors. Restore when compliant.
]

/** `onTrial` is passed separately from `isPro` on purpose: during a trial the
 *  effective tier is 'pro', so `isPro` is true and the old `!isPro` gate hid the
 *  only billing entry point on phones — where the nav countdown chip is also
 *  hidden by the <=720px rule. Trial users got no countdown and no way to
 *  subscribe at all. */
export function MobileNav({
  isAdmin = false,
  isPro = false,
  onTrial = false,
  trialDaysLeft = 0,
}: {
  isAdmin?: boolean
  isPro?: boolean
  onTrial?: boolean
  trialDaysLeft?: number
}) {
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const [upsell, setUpsell] = useState(false)

  // close on navigation
  useEffect(() => { setOpen(false) }, [path])

  // close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const isActive = (href: string, exact?: boolean) => exact ? path === href : !!path?.startsWith(href)

  return (
    <div className="ts-mobilenav">
      <button
        type="button"
        className="ts-burger"
        aria-label="Menu"
        aria-expanded={open}
        data-open={open}
        onClick={() => setOpen(v => !v)}
      >
        <span /><span /><span />
      </button>
      {open && (
        <>
          <div className="ts-burger-backdrop" onClick={() => setOpen(false)} />
          <div className="ts-burger-panel" role="menu">
            {/* primary action */}
            <span onClick={() => setOpen(false)}>
              <NewTradeButton className="btn btn-primary btn-block ts-burger-cta" label="+ Log a trade" />
            </span>

            {/* Trial countdown: the nav chip is hidden at this width, so this is
                the only place a phone user can see how long is left. */}
            {onTrial && (
              <div className="ts-burger-trial">
                <span className="ts-trial-chip">PRO TRIAL · {trialDaysLeft}d left</span>
              </div>
            )}

            <div className="ts-burger-sep" />

            {/* navigation pages */}
            {PAGES.map(p => (
              <Link key={p.href} href={p.href} className="ts-burger-link" data-active={isActive(p.href, p.exact)} role="menuitem">
                {p.label}
              </Link>
            ))}

            <div className="ts-burger-sep" />

            {/* everything else from the bar */}
            <Link href="/messages" className="ts-burger-link" data-active={isActive('/messages')} role="menuitem">Messages</Link>
            <Link href="/settings" className="ts-burger-link" data-active={isActive('/settings')} role="menuitem">Settings</Link>
            {/* Driven off trial state, not isPro: a trial user IS 'pro' but has
                nothing to lose by subscribing and everything to lose by not.
                The modal is the working path — /settings/billing cannot sell to
                a trial user (no Stripe customer exists yet). */}
            {onTrial ? (
              <button
                type="button"
                className="ts-burger-link"
                role="menuitem"
                onClick={() => { setOpen(false); setUpsell(true) }}
              >
                Keep Pro after your trial
              </button>
            ) : !isPro ? (
              <Link href="/settings/billing" className="ts-burger-link" role="menuitem">Upgrade to Pro</Link>
            ) : null}
            {isAdmin && <Link href="/admin" className="ts-burger-link" data-active={isActive('/admin')} role="menuitem">Admin</Link>}
          </div>
        </>
      )}
      {upsell && <TrialUpsellModal daysLeft={trialDaysLeft} onClose={() => setUpsell(false)} />}
    </div>
  )
}
