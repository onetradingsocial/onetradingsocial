'use client'

import { useSyncExternalStore } from 'react'
import { formatDate } from '@/lib/locale-format'

const subscribe = () => () => {}

/**
 * False during SSR and the hydration pass, true on every render after.
 *
 * `useSyncExternalStore` reads the server snapshot while hydrating and the
 * client snapshot afterwards, and re-renders once when they differ — the
 * supported way to render browser-only values without a hydration mismatch and
 * without an effect-driven setState. A component mounted by client-side
 * navigation (no hydration) gets `true` on its first render.
 *
 * See lib/locale-format.ts for why dates need this.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false)
}

/** A `<time>` element in the viewer's locale and timezone, hydration-safe. */
export function LocalTime({
  iso, options, className, style,
}: {
  iso: string
  options: Intl.DateTimeFormatOptions
  className?: string
  style?: React.CSSProperties
}) {
  const local = useIsClient()
  return <time dateTime={iso} className={className} style={style}>{formatDate(iso, options, local)}</time>
}
