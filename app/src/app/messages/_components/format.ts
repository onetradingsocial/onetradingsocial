// Small date/time helpers for the messages UI.
//
// Every helper takes `local`: false while server-rendering and hydrating
// (stable en-AU, UTC), true afterwards (the viewer's locale and timezone).
// Pass `useIsClient()` from app/_components/LocalTime. Without it the server's
// UTC clock and the browser's local one disagree and React raises #418 — see
// lib/locale-format.ts.
import { formatDate } from '@/lib/locale-format'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** Compact relative stamp for conversation rows: "now", "5m", "3h", "Tue", "12 Jun". */
export function shortWhen(iso: string, local: boolean): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  if (diff < MIN) return 'now'
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`
  if (diff < 7 * DAY) return formatDate(then, { weekday: 'short' }, local)
  return formatDate(then, { day: 'numeric', month: 'short' }, local)
}

/** Clock time for a single bubble: "14:32". */
export function clock(iso: string, local: boolean): string {
  return formatDate(iso, { hour: '2-digit', minute: '2-digit' }, local)
}

/** Day-divider label: "Today", "Yesterday", or a full date. */
export function dayLabel(iso: string, local: boolean): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  // Calendar days in the same timezone the label is printed in.
  const startOf = (x: Date) => local
    ? new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    : Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())
  const year = (x: Date) => local ? x.getFullYear() : x.getUTCFullYear()
  const days = Math.round((startOf(today) - startOf(d)) / DAY)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return formatDate(d, { weekday: 'long' }, local)
  return formatDate(d, { day: 'numeric', month: 'long', year: year(d) === year(today) ? undefined : 'numeric' }, local)
}

/** True when two messages sit on different calendar days. */
export function isNewDay(prevIso: string | null, iso: string, local: boolean): boolean {
  if (!prevIso) return true
  const a = new Date(prevIso)
  const b = new Date(iso)
  return local
    ? a.toDateString() !== b.toDateString()
    : a.toISOString().slice(0, 10) !== b.toISOString().slice(0, 10)
}
