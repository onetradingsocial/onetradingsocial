// Small date/time helpers for the messages UI. Locale-aware, no deps.

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** Compact relative stamp for conversation rows: "now", "5m", "3h", "Tue", "12 Jun". */
export function shortWhen(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  if (diff < MIN) return 'now'
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`
  if (diff < 7 * DAY) return new Date(then).toLocaleDateString(undefined, { weekday: 'short' })
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Clock time for a single bubble: "14:32". */
export function clock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** Day-divider label: "Today", "Yesterday", or a full date. */
export function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(d)) / DAY)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

/** True when two messages sit on different calendar days. */
export function isNewDay(prevIso: string | null, iso: string): boolean {
  if (!prevIso) return true
  const a = new Date(prevIso)
  const b = new Date(iso)
  return a.toDateString() !== b.toDateString()
}
