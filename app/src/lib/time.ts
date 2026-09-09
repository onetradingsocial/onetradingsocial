export function timeAgo(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const s = Math.floor(diff / 1000)
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w`
  // Switch on the day count, not on the derived month count: 364 days is 12
  // 30-day months, so a `mo < 12` guard fell through to years and rendered
  // "0y" for anything between 360 and 364 days.
  if (d < 365) return `${Math.floor(d / 30)}mo`
  return `${Math.floor(d / 365)}y`
}

/*
 * Why this never falls back to a date.
 *
 * It used to end at `toLocaleDateString()` past five weeks, which caused two
 * problems at once.
 *
 * The visible one: a feed whose newest post was six weeks old showed
 * "7/24/2026" on every item. Nothing on screen said "six weeks ago", so a
 * visitor read the room as quiet without ever learning HOW quiet — the single
 * most useful thing that timestamp could have told them.
 *
 * The invisible one: `toLocaleDateString()` with no locale argument uses the
 * runtime's locale. That is the SERVER's locale during SSR and the BROWSER's
 * during hydration, so the same post renders "7/24/2026" and "24/07/2026" in
 * the two passes — a hydration mismatch (React #418), which recovers silently
 * and never reaches the error boundary or `analytics_events`.
 *
 * Staying relative fixes both: it is deterministic, locale-free, and it keeps
 * saying how old something is however old it gets. Note that other components
 * still call `toLocaleDateString()` and `Number.toLocaleString()` directly —
 * those are the same hydration hazard and are NOT addressed here.
 */
