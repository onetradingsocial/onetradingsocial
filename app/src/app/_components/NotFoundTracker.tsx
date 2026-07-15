'use client'

import { useEffect } from 'react'
import { track } from '@/lib/track'

/** Logs every 404 hit with path + referrer so broken routes can be found and fixed. */
export function NotFoundTracker() {
  useEffect(() => {
    track('not_found', { broken_path: location.pathname + location.search })
  }, [])
  return null
}
