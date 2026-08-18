/**
 * Password policy (item 9 F5).
 *
 * Pure and isomorphic on purpose: the signup form, the reset-password form and
 * both server actions have to agree on the rule, and the only way to guarantee
 * that is one module they all import. The client copy is UX — the server copy
 * is the enforcement.
 *
 * The previous rule was `password.length < 8` in one server action, mirrored by
 * a strength meter that scored but never blocked, so "password" was accepted.
 *
 * NOTE ON SCOPE: this is a local policy. It cannot know whether a password has
 * appeared in a breach corpus. Supabase ships that check (Authentication →
 * Providers → Email → "Prevent use of leaked passwords", HIBP k-anonymity) and
 * it applies to *every* GoTrue path including ones we do not own. Enable it in
 * the dashboard; do not reimplement it here.
 */

export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 72 // bcrypt truncates past 72 bytes; reject rather than silently cut

/**
 * Passwords that satisfy every mechanical rule below and are still worthless.
 * Deliberately short: this is a speed bump for the laziest choices, not a
 * breach corpus. Compared case-insensitively against the whole password.
 */
const DENYLIST = new Set([
  'password12', 'password123', 'password1234', 'password!1', 'passw0rd12', 'passw0rd123',
  'qwerty12345', 'qwertyuiop1', 'qwerty123456', '1qaz2wsx3edc', 'zaq12wsxcde3',
  'iloveyou123', 'letmein1234', 'welcome1234', 'welcome12345', 'admin12345',
  'trustno1234', 'monkey12345', 'dragon12345', 'football123', 'baseball123',
  'sunshine123', 'princess123', 'superman123', 'starwars123', 'michael123',
  'abcd1234567', 'abc123456789', '12345678910', '1234567890a', 'a1234567890',
  'tradingsocial', 'tradingsocial1', 'tradingsocial123', 'trading1234', 'trader12345',
])

/**
 * The single source of truth for "is this password acceptable".
 * Returns a human-readable problem, or null when the password passes.
 *
 * `identifiers` are values the password must not contain (email local part,
 * username). Passing them is optional — omitting them only relaxes that one
 * rule, so a caller that does not have them still gets every other check.
 */
export function passwordProblem(password: string, identifiers: (string | null | undefined)[] = []): string | null {
  if (!password) return 'Please choose a password.'
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  // Measured in bytes, not characters: bcrypt's limit is 72 *bytes*, so an
  // emoji-heavy password can blow the limit well under 72 characters.
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) {
    return `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`
  }
  if (!/[A-Za-z]/.test(password)) return 'Password must include at least one letter.'
  if (!/\d/.test(password)) return 'Password must include at least one number.'

  const lower = password.toLowerCase()
  if (DENYLIST.has(lower)) return 'That password is too common. Please choose another.'

  // A single repeated character ("aaaaaaaaaa1") clears length + letter + digit.
  if (/^(.)\1+\d*$/.test(password)) return 'That password is too easy to guess. Please choose another.'

  for (const raw of identifiers) {
    const id = normaliseIdentifier(raw)
    // Below 4 characters the containment test throws false positives on
    // ordinary passwords, so short usernames are simply not checked.
    if (id.length >= 4 && lower.includes(id)) {
      return 'Password must not contain your email address or username.'
    }
  }

  return null
}

/** Email -> local part, lowercased and trimmed. Anything else -> lowercased. */
function normaliseIdentifier(raw: string | null | undefined): string {
  if (!raw) return ''
  const s = raw.trim().toLowerCase()
  const at = s.indexOf('@')
  return at > 0 ? s.slice(0, at) : s
}

/**
 * 0-4 strength score driving the meter. ADVISORY ONLY — it is a nudge toward a
 * better password, never the gate. The forms disable submit on
 * `passwordProblem() !== null`, so there is exactly one rule and the meter can
 * never disagree with the server.
 */
export function scorePassword(password: string): number {
  if (!password) return 0
  let s = 0
  if (password.length >= PASSWORD_MIN_LENGTH) s++
  if (password.length >= 14) s++
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) s++
  return Math.min(s, 4)
}

export const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'] as const
