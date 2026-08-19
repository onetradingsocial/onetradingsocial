import { LEGAL_VERSION } from '@/lib/legal-versions'

/**
 * The record that a user agreed to the Terms — who, when, what, and **how**.
 *
 * ── WHY THE MECHANISM IS A COLUMN ────────────────────────────────────────────
 *
 * The two signup paths are not evidentially equal and a boolean would flatten
 * them precisely when the difference matters.
 *
 *   `signup_checkbox` — the email path. An unticked box blocks the submit
 *     button in `signup/SignupForm.tsx` and is re-checked server-side in
 *     `actions/auth.ts` (`if (!terms) return { error: … }`), so the account
 *     cannot exist without the box having been ticked. This is express consent:
 *     a positive act, directed at the consent itself, that the user could not
 *     have performed accidentally.
 *
 *   `oauth_notice` — the Google path. `OAuthLegalNotice` sits directly beneath
 *     the button on both `/signup` and `/login` (the only two places
 *     `GoogleButton` is rendered), naming and linking all three documents, and
 *     the user pressed the button after it. This is passive consent. It is
 *     accepted in Australia when the notice is visible at the point of
 *     collection and the user acts after seeing it — but it is inferred from
 *     conduct, not performed, and a court weighs it accordingly.
 *
 * Recording only "accepted: true" would let someone later read the second as if
 * it were the first. Recording the mechanism means the record is worth exactly
 * what the interaction was worth and no more. Add a value here only when a new
 * consent surface genuinely exists — and add it to the CHECK constraint in
 * migration 0060 in the same change.
 */
export const TERMS_MECHANISMS = ['signup_checkbox', 'oauth_notice'] as const

export type TermsMechanism = (typeof TERMS_MECHANISMS)[number]

export type TermsAcceptancePatch = {
  terms_accepted_at: string
  terms_accepted_version: string
  terms_accepted_via: TermsMechanism
}

/**
 * All three fields or none — never a partial row.
 *
 * A row with a timestamp and no version is the failure this whole workstream
 * exists to fix, restated one column to the left: it proves something happened
 * without proving what. Migration 0060 enforces the same rule in the database
 * with `num_nonnulls(...) in (0, 3)`, so neither this function nor a future
 * one-off script can write half a record.
 */
export function termsAcceptancePatch(
  via: TermsMechanism, now: Date = new Date(),
): TermsAcceptancePatch {
  return {
    terms_accepted_at: now.toISOString(),
    terms_accepted_version: LEGAL_VERSION,
    terms_accepted_via: via,
  }
}

/**
 * The third consent surface: Stripe Checkout.
 *
 * Item 5 finding 2 is that the Terms are never presented at checkout and
 * Stripe's own mechanism is unused. Stripe's mechanism is also the RIGHT one to
 * use, and the reason is worth stating so nobody "improves" on it later:
 * `consent_collection.terms_of_service: 'required'` renders a mandatory
 * checkbox on the hosted page and records the answer on the session as
 * `consent.terms_of_service = 'accepted'`, timestamped and retained by Stripe
 * on the object that also holds the amount, the price and the card. That is a
 * *stronger* record than anything we could write, because the acceptance and
 * the transaction it relates to are the same object. Copying it into
 * `profiles` would duplicate it, invite the two to disagree, and add nothing.
 * The webhook therefore does not persist it and should not start to.
 *
 * WHY THIS IS BEHIND A FLAG, DEFAULT OFF. Stripe links the ToS URL from
 * Dashboard -> Settings -> Business -> Public business information, and rejects
 * the parameter outright when that URL is unset. Whether it is set is not
 * observable from this repository (item 5, "Could not verify" #1). Shipping the
 * parameter unconditionally would therefore risk turning every checkout into a
 * 500 on deploy, to fix a record-keeping gap — a trade nobody would take. The
 * flag makes the code half done and the remaining half a Dashboard field plus
 * one env var, in that order. See STRIPE_TOS_CONSENT in .env.example.
 */
export function stripeTermsConsent(
  env: Record<string, string | undefined> = process.env,
): { terms_of_service: 'required' } | undefined {
  return (env.STRIPE_TOS_CONSENT ?? '').toLowerCase() === 'on'
    ? { terms_of_service: 'required' }
    : undefined
}
