/**
 * Display masking for identifiers on the admin surface. Audit item 18, F3.
 *
 * Pure and client-safe on purpose: the mask has to be applied in the same
 * component that renders the value, and some of those are client components
 * (the reveal control). Nothing here is a security boundary — the unmasked
 * value is one authorised server action away. What it buys is that the
 * *default* state of an admin screen is not a bulk PII export, and that every
 * time an admin actually needs an address there is a deliberate act to log.
 *
 * ## Why the domain survives and the local part does not
 *
 * The local part is the identifier: it names a person and it is what you would
 * paste into another system. The domain is a class: `gmail.com` is shared by
 * billions and `tradingsocial.io` is shared by the seed data. On this product's
 * admin screens the domain is also the operationally useful half — it is how an
 * admin recognises a seed/test row, a disposable-mail signup, or the owner's own
 * account, at a glance and without revealing anybody. So the mask keeps the
 * domain and the first character of the local part, and hides the rest.
 *
 * Masking the domain too would be more private and would make the directory
 * unreadable, which is its own failure: an admin tool nobody can scan gets
 * replaced by a SQL console, which logs nothing at all.
 */

const DOT = '•' // •

/** Fixed-width run of dots — never leaks the true length of the local part. */
const RUN = DOT.repeat(3)

/**
 * `edrian@gmail.com` -> `e•••@gmail.com`.
 *
 * A single-character local part becomes `•••@domain` rather than echoing the
 * only character there is. Anything that is not a plausible address is
 * returned as a bare em dash: an admin screen should never render a
 * half-parsed identifier and imply it is real.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '—'
  const trimmed = email.trim()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0 || at === trimmed.length - 1) return '—'
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  const head = local.length > 1 ? local[0] : ''
  return `${head}${RUN}@${domain}`
}

/**
 * Trailing-digits mask for an account number at a third party — the MT5 broker
 * `login` on /admin/verification. `51234567` -> `••••4567`.
 *
 * Last-4 is the support convention for a reason: it is enough for an admin and
 * the user to agree they are talking about the same account, and not enough to
 * be the account. Values shorter than `keep + 1` are masked entirely, because
 * "last 4 of a 4-digit number" is not a mask.
 */
export function maskAccountId(value: string | number | null | undefined, keep = 4): string {
  if (value === null || value === undefined) return '—'
  const s = String(value).trim()
  if (!s) return '—'
  if (s.length <= keep) return RUN
  return `${DOT.repeat(4)}${s.slice(-keep)}`
}

/**
 * Label for an admin whose own account has been deleted, where `actor_email`
 * has been replaced by a salted hash (F7, same pattern as WS3's
 * `trade_reports.reported_user_hash`). The first 8 hex characters are a stable
 * pseudonym: two rows from the same departed admin still read as the same
 * person, and nothing in the string is their address.
 */
export function deletedActorLabel(hash: string | null | undefined): string {
  if (!hash) return 'deleted admin'
  return `deleted admin (${hash.slice(0, 8)})`
}
