'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { NewTradeButton } from './NewTradeButton'

const PAGES = [
  { href: '/', label: 'Home', exact: true },
  { href: '/journal', label: 'Journal' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/learn', label: 'Learn' },
]

export function MobileNav({ isAdmin = false, isPro = false }: { isAdmin?: boolean; isPro?: boolean }) {
  const path = usePathname()
  const [open, setOpen] = useState(false)

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
            {!isPro && <Link href="/settings/billing" className="ts-burger-link" role="menuitem">Upgrade to Pro</Link>}
            {isAdmin && <Link href="/admin" className="ts-burger-link" data-active={isActive('/admin')} role="menuitem">Admin</Link>}
          </div>
        </>
      )}
    </div>
  )
}
