/**
 * Which version of the legal documents a user was shown.
 *
 * ── WHY A VERSION AT ALL ─────────────────────────────────────────────────────
 *
 * A bare `terms_accepted_at` is weak evidence. `terms.html` was rewritten twice
 * in the week before this shipped — the subscription sections went in, then §9
 * was corrected on what deletion actually does — so "accepted at 10:04 on the
 * 18th" does not say what was accepted. The record has to name the document.
 *
 * ── WHY A DATE AND NOT A HASH ────────────────────────────────────────────────
 *
 * Three options were on the table.
 *
 *   1. A content hash computed at build time. Rejected on deployment shape, not
 *      on principle: the marketing site (repo root) and the app (`app/`) are two
 *      separate Vercel deployables — `app/vercel.json` exists and carries its
 *      own crons — so the app builds with its root at `app/` and `../terms.html`
 *      is not reliably on disk when `next build` runs. A version scheme that
 *      resolves to `undefined` in production is worse than no scheme. A whole-
 *      file hash is also far too twitchy: of the 15 commits that have touched
 *      `terms.html`, most were analytics snippets, pixels, nav and favicons —
 *      every one would have minted a "new version" of an unchanged contract.
 *
 *   2. A hand-bumped constant. Rejected because nothing ties it to the file. It
 *      is the scheme that goes stale in silence, which is the failure mode worth
 *      designing against.
 *
 *   3. The `Last updated` date the document publishes about itself. Chosen.
 *      It is the identifier the *user* can see on the page they read, it is the
 *      identifier `terms.html` §16's variation clause already points at, and it
 *      is legible on its face — which matters, because the entire purpose of
 *      this record is to be produced to someone in a dispute. "terms=2026-08-18"
 *      needs no lookup table; a truncated SHA does.
 *
 * ── HOW IT STAYS CORRECT ─────────────────────────────────────────────────────
 *
 * A date is only trustworthy if it moves when the text moves, and the whole
 * objection to option 2 is that a human has to remember. So the date is not
 * trusted — it is *guarded*, by `tests/unit/terms-acceptance.test.ts`, which
 * reads the three HTML files off disk and asserts two things per document:
 *
 *   - the `version` below equals the `Last updated` line in the file, and
 *   - the `bodyHash` below equals the hash of the normalised legal body.
 *
 * `normaliseLegalBody` deliberately strips HTML comments and the `Last updated`
 * paragraph and collapses whitespace, so reformatting, retitling a comment or
 * bumping the date alone does NOT trip the hash — only a change to the words a
 * user reads does. The two assertions therefore fail in opposite directions and
 * between them there is no silent path:
 *
 *   edit the body, forget the date  → bodyHash fails. You cannot make it pass
 *                                     without opening this file, and the only
 *                                     honest edit here is to bump BOTH fields.
 *   edit the date, not the body     → version fails until synced.
 *   reformat / edit a comment       → nothing fails, correctly.
 *
 * The residual gap is honest and worth stating: a developer who updates the
 * hash without the date defeats it. That is a deliberate act in a file whose
 * comment says not to, not an oversight — which is the most a checked-in guard
 * can achieve without coupling the app build to a file it does not deploy.
 *
 * ── WHICH DOCUMENTS ──────────────────────────────────────────────────────────
 *
 * All three, because all three are what each surface actually names. The signup
 * checkbox reads "Terms, Privacy Policy and financial disclaimer"
 * (`signup/SignupForm.tsx`) and `OAuthLegalNotice` names the same three. Do not
 * add a document here that no consent surface mentions: the record must never
 * claim acceptance of something the user was not shown.
 */

/** Fixed order. `LEGAL_VERSION` is built from it, so changing it rewrites every
 *  future record's format — append, never reorder. */
export const LEGAL_DOC_KEYS = ['terms', 'privacy', 'disclaimer'] as const

export type LegalDocKey = (typeof LEGAL_DOC_KEYS)[number]

export type LegalDoc = {
  /** Path relative to the repo root. Used by the guard test only. */
  readonly file: string
  /** The document's own `Last updated` date, ISO. This is the version. */
  readonly version: string
  /** sha256 of `normaliseLegalBody(...)`, first 16 hex chars. Tripwire only. */
  readonly bodyHash: string
}

export const LEGAL_DOCUMENTS: Readonly<Record<LegalDocKey, LegalDoc>> = {
  terms: {
    file: 'terms.html',
    version: '2026-08-18',
    bodyHash: '7436428285a62715',
  },
  privacy: {
    file: 'privacy.html',
    version: '2026-08-18',
    bodyHash: '25e678e88523ade7',
  },
  disclaimer: {
    file: 'disclaimer.html',
    version: '2026-06-24',
    bodyHash: '9d6f42fafff27e02',
  },
} as const

/**
 * The string written to `profiles.terms_accepted_version`.
 *
 *   terms=2026-08-18,privacy=2026-08-18,disclaimer=2026-06-24
 *
 * Derived, never hand-written, so it cannot drift from the table above. Kept as
 * one readable text column rather than three columns or a jsonb blob: it is
 * evidence first and data second, and `like '%terms=2026-08-18%'` answers the
 * only query anyone will actually run against it.
 */
export const LEGAL_VERSION: string = LEGAL_DOC_KEYS
  .map((key) => `${key}=${LEGAL_DOCUMENTS[key].version}`)
  .join(',')

/** `<main class="legal"> … </main>` — the legal body of a marketing page. */
const LEGAL_BODY = /<main class="legal">([\s\S]*?)<\/main>/
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const UPDATED_LINE = /<p class="legal-updated">[\s\S]*?<\/p>/

/**
 * Reduce a legal page to the text a reader actually sees, so the guard hash is
 * sensitive to substance and blind to everything else.
 *
 * Stripped, and why:
 *   - everything outside `<main class="legal">` — nav, footer, pixels, GTM. This
 *     is where nearly every historical commit to these files landed.
 *   - HTML comments — including the commented-out legal-entity clause in
 *     `terms.html`. Uncommenting it still trips the hash, because it becomes
 *     body text at that point; editing the prose *of* a comment does not.
 *   - the `Last updated` paragraph — the version is asserted separately, and
 *     leaving it in would make a date bump look like a text change.
 *
 * Returns null when the page has no legal body, so the guard fails loudly
 * instead of hashing an empty string into a false pass.
 */
export function normaliseLegalBody(html: string): string | null {
  const match = html.match(LEGAL_BODY)
  if (!match) return null
  return match[1]
    .replace(HTML_COMMENT, ' ')
    .replace(UPDATED_LINE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The `Last updated: 18 August 2026` line, as an ISO date. Null if absent. */
export function publishedVersion(html: string): string | null {
  const m = html.match(/Last updated:\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
  if (!m) return null
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ]
  const month = months.indexOf(m[2].toLowerCase())
  if (month < 0) return null
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}
