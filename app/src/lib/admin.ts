/** Parse ADMIN_EMAILS: comma-separated, trimmed, lowercased, empties dropped.
 *  Entries may be an exact email or a "@domain" suffix match. */
export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function emailIsAdmin(email: string | null | undefined, allow: string[]): boolean {
  if (!email) return false
  const e = email.toLowerCase()
  return allow.some((entry) => (entry.startsWith('@') ? e.endsWith(entry) : e === entry))
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
