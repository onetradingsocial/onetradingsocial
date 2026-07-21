'use client'

import { Suspense, use } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type NavCounts = { feedback: number; reports: number; alerts: number }
type CountKey = keyof NavCounts

type Item = { href: string; label: string; countKey?: CountKey }
export type NavGroup = { title: string; items: Item[] }

/**
 * Badge resolves from the streamed counts promise. Its own Suspense boundary
 * with a null fallback means the rail paints immediately and each badge pops
 * in when the count lands — the nav never waits on a query.
 */
function NavCount({ counts, k }: { counts: Promise<NavCounts>; k: CountKey }) {
  const n = use(counts)[k]
  if (!n) return null
  return <span className="ad-count">{n > 99 ? '99+' : n}</span>
}

/**
 * Left rail for the admin console. Client-only so the current route can be
 * highlighted; `aria-current` drives the styling (no duplicate state class).
 */
export function AdminNav({ groups, counts }: { groups: NavGroup[]; counts: Promise<NavCounts> }) {
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
              {it.countKey && (
                <Suspense fallback={null}>
                  <NavCount counts={counts} k={it.countKey} />
                </Suspense>
              )}
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
