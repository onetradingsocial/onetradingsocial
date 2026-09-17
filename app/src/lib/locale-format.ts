/**
 * Locale-stable formatting, so a server render and the browser's hydration pass
 * produce the same text.
 *
 * ── The fault this exists for ────────────────────────────────────────────────
 *
 * `toLocaleString()` / `toLocaleDateString()` with no locale use the RUNTIME's
 * locale and timezone: the server's during SSR (en-US, UTC on Vercel), the
 * browser's during hydration (en-AU, AEST for most of our users). In a client
 * component the two passes then disagree and React raises #418. React recovers
 * by re-rendering on the client, so nothing throws, `error.tsx` never runs and
 * no `client_error` row is written — the fault is invisible in SQL.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * NUMBERS: always format with `APP_LOCALE`. Output is then identical on both
 * passes. en-AU groups digits exactly like en-US, so English-locale viewers see
 * no change.
 *
 * DATES: a date depends on the viewer's timezone, which the server cannot know.
 * Render a stable string (APP_LOCALE, UTC) on the server and on the first client
 * pass, then switch to the viewer's own locale and timezone once hydrated — see
 * `useIsClient` in app/_components/LocalTime.tsx. That final text is what these
 * surfaces already showed after React's recovery, so what people see does not
 * change; only the mismatch goes.
 *
 * APP_LOCALE matches the en-AU already used by billing and lifecycle emails.
 */

export const APP_LOCALE = 'en-AU'

export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(APP_LOCALE, options)
}

/**
 * Format a date for display. `local` is false on the server and during
 * hydration (stable: APP_LOCALE, UTC) and true afterwards (viewer's locale and
 * timezone). Invalid input renders as an empty string rather than
 * "Invalid Date".
 */
export function formatDate(
  input: string | number | Date,
  options: Intl.DateTimeFormatOptions,
  local: boolean,
): string {
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  return local
    ? d.toLocaleString(undefined, options)
    : d.toLocaleString(APP_LOCALE, { ...options, timeZone: 'UTC' })
}

/**
 * The one way a billing date is written — "17 October 2026" — everywhere the
 * customer reads it: the pre-charge and trial emails, and the settings and
 * billing pages.
 *
 * Fixed to Australia/Sydney rather than the viewer's timezone because prices,
 * terms and every billing email are Australian, and because the page and the
 * email must name the SAME day. The settings pages used to call
 * `toLocaleDateString()` with no locale on the server, which on Vercel printed
 * US month-first dates ("10/5/2026") to Australian customers — read as 10 May —
 * in UTC, a day early for anything after 14:00 UTC.
 */
export function formatBillingDate(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' })
}
