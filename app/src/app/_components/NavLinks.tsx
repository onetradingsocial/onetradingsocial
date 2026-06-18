'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function NavLinks() {
  const path = usePathname()
  return (
    <div className="ts-navpills">
      <Link href="/" className="ts-navpill" data-active={path === '/'}>Home</Link>
      <Link href="/journal" className="ts-navpill" data-active={!!path?.startsWith('/journal')}>Journal</Link>
      <span className="ts-navpill ts-navpill--soon" title="Leaderboard — coming soon">Leaderboard</span>
    </div>
  )
}
