/**
 * Parse ADMIN_EMAILS: comma-separated, trimmed, lowercased.
 *
 * **Exact addresses only.** An entry must have a local part *and* a domain.
 * Anything else — an empty string, a bare `@domain`, a domain with no `@` — is
 * dropped here rather than at match time.
 *
 * This function used to accept a leading `@` as a *domain suffix wildcard*, so
 * `@admin.tradingsocial.test` made every address under that domain a full
 * production admin. `.test` is an RFC 6761 reserved TLD: no one can ever
 * receive mail there, so every address under it is permanently unclaimed, and
 * with open signup and email confirmation off, "unclaimed" meant "registerable
 * by anyone". The wildcard was never in the production environment, but the
 * mechanism permitted it, and the explanation was published in a public repo.
 *
 * Dropping malformed entries at parse time is deliberate: an operator who
 * copies the old wildcard value into an env var gets **no** admins from that
 * entry rather than an entire namespace of them. Fail closed, not open.
 */
export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(isExactAddress)
}

/** local@domain, both non-empty, exactly one `@`, no whitespace. */
function isExactAddress(entry: string): boolean {
  const at = entry.indexOf('@')
  return (
    at > 0 &&
    at === entry.lastIndexOf('@') &&
    at < entry.length - 1 &&
    !/\s/.test(entry)
  )
}

/**
 * Exact, case-insensitive address match against the allowlist. There is no
 * wildcard, prefix, or suffix form — admin is granted to named addresses only.
 */
export function emailIsAdmin(email: string | null | undefined, allow: string[]): boolean {
  if (!email) return false
  const e = email.trim().toLowerCase()
  if (!isExactAddress(e)) return false
  return allow.some((entry) => e === entry)
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function validateSlug(s: string): string | null {
  if (!s) return 'Slug is required.'
  if (s.length > 60) return 'Slug is too long (60 max).'
  if (!SLUG_RE.test(s)) return 'Slug must be lowercase letters, numbers, and single hyphens.'
  return null
}

export function validateNonNegInt(n: unknown): string | null {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return 'Must be a non-negative whole number.'
  return null
}

export function validateQuizOptions(opts: { label: string; isCorrect: boolean }[]): string | null {
  if (opts.length < 2) return 'A question needs at least 2 options.'
  if (opts.some((o) => !o.label.trim())) return 'Every option needs a label.'
  if (opts.filter((o) => o.isCorrect).length !== 1) return 'Exactly one option must be correct.'
  return null
}
