'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Item = { href: string; label: string; badge?: number }
export type NavGroup = { title: string; items: Item[] }

/**
 * Left rail for the admin console. Client-only so the current route can be
 * highlighted; `aria-current` drives the styling (no duplicate state class).
 */
export function AdminNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname()
  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)

  return (
    <nav className="ad-side" aria-label="Admin sections">
      {groups.map((g) => (
        <div key={g.title} style={{ display: 'contents' }}>
          <span className="ad-side-group">{g.title}</span>
          {g.items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="ad-link"
              aria-current={isActive(it.href) ? 'page' : undefined}
            >
              {it.label}
              {!!it.badge && <span className="ad-count">{it.badge > 99 ? '99+' : it.badge}</span>}
            </Link>
          ))}
        </div>
      ))}
      <div className="ad-side-foot">
        <Link href="/feed" className="ad-link">← Back to app</Link>
      </div>
    </nav>
  )
}
