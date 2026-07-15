'use client'

import { useEffect } from 'react'
import { track, type TrackProps } from '@/lib/track'

/** Drop into any (server) component to log a first-party event when it renders. */
export function TrackOnMount({ event, props }: { event: string; props?: TrackProps }) {
  useEffect(() => {
    track(event, props)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event])
  return null
}
