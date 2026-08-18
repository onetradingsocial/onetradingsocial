/**
 * Passwords used by the e2e suite.
 *
 * Two constants, not one, and they must stay separate:
 *
 * SEEDED_PASSWORD is the password the seeded dev accounts were created with,
 * long before the item 9 F5 policy existed. Login does not re-check policy —
 * it would lock out every existing user — so these specs keep working and this
 * literal must NOT be "modernised".
 *
 * SIGNUP_PASSWORD is for specs that create an account through the real form.
 * It has to satisfy `lib/password.ts` (>= 10 chars, letter + digit, not in the
 * denylist, not containing the username/email), because the submit button is
 * disabled until it does. The old 'password123' now fails on the denylist.
 */
export const SEEDED_PASSWORD = 'password123'
export const SIGNUP_PASSWORD = 'Journal-Edge-2026'
