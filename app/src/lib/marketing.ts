/**
 * Links to the legal pages on the marketing origin.
 *
 * The app and the marketing site are two deployables on two origins
 * (app.tradingsocial.io / www.tradingsocial.io), and the legal pages live on
 * the marketing one. Before this module the base URL was read in exactly one
 * file — signup/SignupForm.tsx — and used for exactly two links, Terms and the
 * financial disclaimer. `/privacy` appeared nowhere in `app/src` at all, so
 * every disclosure in the privacy policy reached zero users of the product
 * that does the collecting (audit item 4, findings 1 and 2).
 *
 * Defined once here so a collection surface can link the policy without
 * re-deriving the origin, and so that adding a surface is a one-line import
 * rather than a copy of an env-var fallback.
 */
export const MARKETING_URL =
  process.env.NEXT_PUBLIC_MARKETING_URL ?? 'https://www.tradingsocial.io'

export const LEGAL = {
  terms: `${MARKETING_URL}/terms`,
  /** Anchored at the subscription section — the only part checkout needs. */
  subscriptionTerms: `${MARKETING_URL}/terms#subscriptions`,
  privacy: `${MARKETING_URL}/privacy`,
  disclaimer: `${MARKETING_URL}/disclaimer`,
} as const

/** Props every legal link wants: new tab, and no window.opener handle back. */
export const EXTERNAL_LINK = {
  target: '_blank',
  rel: 'noopener noreferrer',
} as const
