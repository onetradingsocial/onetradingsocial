# Phase 7c — Legal Pages (Design)

**Date:** 2026-06-24
**Status:** Approved, ready for implementation plan
**Depends on:** existing marketing static site (`index.html`, `pricing.html`, shared CSS/nav/footer)

## Goal

Publish the three legal documents the product references but does not yet have:
Terms of Service, Privacy Policy (with cookie notice), and a Risk / Financial
Disclaimer. Wire them into the marketing footer (currently dead `#` links) and the
signup consent checkbox (which already enforces consent server-side but links
nowhere). Pages are static HTML on the marketing site, matching existing pages.

## Authoring & Legal Posture

- Content is **drafted by the assistant** as Australia-appropriate starter text,
  grounded in the app's actual data practices. **It is not legal advice.** A note in
  the implementation handoff (not on the live page) flags that an Australian
  solicitor should review before the business relies on it — material because the
  product is trading-adjacent (ASIC / Corporations Act financial-advice exposure).
- **Jurisdiction:** South Australia, Australia (governing law clause).
- **Entity:** referred to as "TradingSocial" (brand). No formal entity name / ABN
  embedded yet; an ABN line can be added later.
- **Contact:** onetradingsocial@gmail.com.
- **Effective / Last updated:** 2026-06-24.

## Non-Goals (YAGNI)

- No consent-versioning or per-user consent audit record (signup already enforces
  the checkbox server-side; no DB column, no migration).
- No separate cookie-policy page (folded into Privacy).
- No app-side (Next.js) legal routes — pages live only on the marketing site.
- No CMS / admin editor for legal copy — static HTML, edited in-repo.
- No multi-language.

## Pages & Required Sections

Clean URLs (served like `/pricing` → `pricing.html`):

### `/terms` (terms.html)
1. Acceptance of terms; eligibility (18+, capacity).
2. The service is education + performance-tracking, **not financial advice**
   (cross-link to /disclaimer).
3. Accounts: accurate info, security, one account, suspension/termination.
4. Acceptable use: no unlawful/abusive content, no scraping, no manipulation of
   leaderboards/social features.
5. User content: ownership stays with user; user grants TradingSocial a licence to
   host/display it for operating the service; responsibility for shared content.
6. Intellectual property (TradingSocial marks/content).
7. **Australian Consumer Law:** nothing excludes non-excludable consumer guarantees
   under the ACL; liability otherwise limited to the extent permitted by law.
8. Disclaimers & limitation of liability (service "as is"; no liability for trading
   losses).
9. Changes to the terms; how users are notified.
10. Governing law: South Australia, Australia.
11. Contact.

### `/privacy` (privacy.html)
1. Who we are; scope (Privacy Act 1988 (Cth) and the Australian Privacy Principles).
2. **What we collect**, grounded in actual schema/auth:
   - Account/auth: email, password (via Supabase Auth); Google OAuth profile
     (avatar URL, name) when used.
   - Profile: username, display name, avatar, bio, trading goal, markets.
   - Trades: instrument, entries/exits, P/L, R-multiple, notes, **screenshots**
     (stored in Supabase Storage).
   - Social: posts, comments, likes, follows.
   - Learning: lesson completions, quiz answers.
   - Feedback messages.
   - Technical: log/usage data, cookies, analytics (Google Analytics / gtag).
3. How we use it (operate the service, leaderboards/social, support, improve).
4. Disclosure & sub-processors: Vercel (hosting), Supabase (database/auth/storage),
   Google (OAuth, Analytics). Possible overseas storage disclosure (APP 8).
5. Cookies & analytics section.
6. Security (reasonable steps; no absolute guarantee).
7. **Your rights:** access and correction; how to request; complaints to us and then
   to the OAIC.
8. Data retention & account deletion.
9. Children (not directed at under-18s).
10. Changes to this policy; contact.

### `/disclaimer` (disclaimer.html)
1. General information only — **not financial product advice**; TradingSocial does
   not hold an Australian Financial Services Licence (AFSL).
2. Not personal advice; consider your own circumstances / seek licensed advice.
3. Trading risk warning; you can lose more than you invest (leverage).
4. Past performance / leaderboards / shared results are not indicative of future
   results and are for education and community only.
5. No liability for decisions made from platform content.
6. Reuses the wording already in the marketing footer disclaimer paragraph as the
   basis, expanded.

## Page Architecture

- Each page is a standalone static HTML document reusing, from `pricing.html`:
  the `<head>` (same stylesheet link, fonts, gtag snippet, favicon), the `<header
  class="nav">` block, and the `<footer class="footer">` block (with the corrected
  Legal links — see Wiring).
- New content region: `<main class="legal"><div class="wrap">…</div></main>` with a
  page title, "Last updated" line, and the prose sections.
- New CSS appended to the shared stylesheet (the file `pricing.html`/`index.html`
  link): a `.legal` block — constrained measure (~720px), heading scale, paragraph
  spacing, list styling, anchor styling — consistent with the existing design
  tokens (`--border`, `--bg-2`, etc. already used in the footer).
- `<title>` and meta description per page; pages remain indexable.

## Wiring

1. **Marketing footers** — every page that contains the footer Legal column
   (`index.html`, `pricing.html`, `blog.html`, `blog-post.html`, `404.html` if
   present): replace the four `href="#"` legal links with:
   - "Terms of service" → `/terms`
   - "Privacy policy" → `/privacy`
   - "Financial disclaimer" → `/disclaimer`
   - "Risk warning" → `/disclaimer`
2. **Signup checkbox** (`app/src/app/signup/SignupForm.tsx`): turn the inline words
   "Terms" and "financial disclaimer" into links to the public-domain absolute URLs
   (`https://www.tradingsocial.io/terms` and `/disclaimer`, opened in a new tab) so
   they resolve from the app origin. Exact base URL confirmed during implementation
   from the marketing domain already used in nav links
   (`https://app.tradingsocial.io` is the app; the public marketing root is the
   apex — verify and use it).
3. **`sitemap.xml`** — add `/terms`, `/privacy`, `/disclaimer` entries.

## Error Handling / Edge Cases

- Pure content pages — no runtime failure modes. Broken-link risk is the main
  concern, covered by the link-wiring check below.

## Testing

No JS logic to unit-test. A lightweight verification:
- Assert the three HTML files exist and each contains its required top-level section
  headings (e.g. "Governing law", "Australian Privacy Principles" / "OAIC",
  "Australian Financial Services Licence").
- Assert no marketing page footer still contains `href="#"` within the Legal column.
- Assert `SignupForm.tsx` links to `/terms` and `/disclaimer`.
- Manual visual pass at each URL (nav/footer render, prose readable, mobile width).

This can be a small Node/script-based check or a few assertions in the existing test
runner; the plan picks the lightest fit (likely a vitest test reading the files, or
a grep-based check) — no new heavy dependency.

## File Manifest

New:
- `terms.html`
- `privacy.html`
- `disclaimer.html`

Modified:
- shared stylesheet (append `.legal` styles) — exact file resolved from the
  `<link rel="stylesheet">` in `pricing.html`.
- `index.html`, `pricing.html`, `blog.html`, `blog-post.html`, `404.html` — footer
  Legal links.
- `app/src/app/signup/SignupForm.tsx` — consent label links.
- `sitemap.xml` — three new URLs.

## Open Questions

None blocking. ABN can be added to all three pages later in one pass.
