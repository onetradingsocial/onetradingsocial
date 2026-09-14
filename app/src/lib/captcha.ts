/**
 * The form field the Turnstile widget writes its token into, and the field
 * `captchaToken()` reads on the server.
 *
 * WHY THIS IS ITS OWN MODULE. It used to live in `app/_components/Turnstile.tsx`,
 * which is `'use client'`. `actions/auth.ts` imported it from there, and across
 * the RSC boundary a plain value exported from a client module does not arrive
 * as the value — it arrives as a client-reference proxy. `formData.get()` then
 * looked up a key that was never in the form, `captchaToken()` returned
 * undefined, and GoTrue answered every login with
 * `captcha protection: request disallowed (no captcha_token found)` while the
 * widget sat there showing a green Success. Same shape as the /admin/feedback
 * outage in CLAUDE.md: `tsc` resolves it, the bundle builds, the tests pass.
 *
 * A plain module with no directive is importable from both sides, so the two
 * ends cannot drift and cannot silently stop referring to the same string.
 */
export const CAPTCHA_FIELD = 'cf-turnstile-response'
