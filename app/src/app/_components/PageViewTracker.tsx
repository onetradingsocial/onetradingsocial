'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { track } from '@/lib/track'

/** Fires page_view on every App Router navigation (GA4 send_page_view is off). */
export function PageViewTracker() {
  const pathname = usePathname()
  const last = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname || last.current === pathname) return
    last.current = pathname
    // track() mirrors to gtag, so this single call covers GA4 too.
    track('page_view', { page_path: pathname, page_title: document.title })
  }, [pathname])

  return null
}
