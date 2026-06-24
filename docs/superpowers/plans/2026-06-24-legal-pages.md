# Legal Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Terms, Privacy, and Risk Disclaimer static pages on the marketing site and wire them into the footer + signup consent, replacing today's dead `#` links.

**Architecture:** Three self-contained static HTML pages matching the existing Bubble-export marketing pages (each page carries its own inline `<head>` CSS, shared nav header, shared footer). A small `.legal` CSS block is added to each new page for prose styling. Footer Legal links across all marketing pages and the signup checkbox label are pointed at the new clean URLs. A file-reading vitest test verifies presence + wiring.

**Tech Stack:** Static HTML/CSS (no framework, no JS logic on these pages), Next.js client component edit for signup, vitest (file-content assertions). Pages drafted for Australian law.

## Global Constraints

- Jurisdiction: **South Australia, Australia** (Terms governing-law clause).
- Entity referred to as **"TradingSocial"** (brand only — no formal entity/ABN yet).
- Contact email: **onetradingsocial@gmail.com**.
- Effective / Last updated: **2026-06-24**.
- Clean URLs: `terms.html`→`/terms`, `privacy.html`→`/privacy`, `disclaimer.html`→`/disclaimer` (served like `pricing.html`→`/pricing`).
- Each new page reuses, copied verbatim from `pricing.html`: the entire `<head>` (inline CSS, fonts, gtag, favicon), the `<header class="nav">…</header>` block, and the `<footer class="footer">…</footer>` block.
- New-page footers use the CORRECT legal links from the start; Task 4 fixes only the pre-existing marketing pages.
- Content is assistant-drafted starter text; it is NOT legal advice and must be reviewed by an Australian solicitor before the business relies on it. Do not add a visible "DRAFT" banner to the live pages.
- Signup legal links must be absolute to the marketing domain via `process.env.NEXT_PUBLIC_SITE_URL` (the app runs on its own origin since basePath was dropped, so root-relative links would 404).

---

### Task 1: Risk Disclaimer page (`disclaimer.html`)

Establishes the page pattern and the `.legal` CSS block. Smallest document; expands the wording already in the marketing footer disclaimer paragraph.

**Files:**
- Create: `disclaimer.html`

**Interfaces:**
- Produces: the `/disclaimer` page and the reusable `.legal` CSS block (Tasks 2–3 copy the same block) and the `<main class="legal">` structure pattern.

- [ ] **Step 1: Scaffold the page from the marketing template**

Copy `pricing.html` to `disclaimer.html`. Then keep only its `<head>`, `<header class="nav">…</header>`, and `<footer class="footer">…</footer>`; delete the page-body sections between header and footer (the pricing hero/cards/etc). Change `<title>` to `TradingSocial — Financial Disclaimer` and the `<meta name="description">` to `TradingSocial financial and risk disclaimer. General information only — not financial advice.` Update `<link rel="canonical">` to end in `/disclaimer`.

- [ ] **Step 2: Add the `.legal` CSS block**

Inside the page's existing `<style>` (end of it), append:

```css
.legal { padding-block: 72px 64px; }
.legal .wrap { max-width: 760px; }
.legal h1 { font-size: clamp(28px, 4vw, 40px); line-height: 1.1; margin: 0 0 8px; }
.legal .legal-updated { color: var(--muted, #8a90a6); font-size: 14px; margin: 0 0 32px; }
.legal h2 { font-size: 20px; margin: 36px 0 10px; }
.legal p, .legal li { color: var(--text-2, #c7ccda); line-height: 1.7; font-size: 15.5px; }
.legal p { margin: 0 0 14px; }
.legal ul { margin: 0 0 14px; padding-left: 22px; }
.legal li { margin: 0 0 7px; }
.legal a { color: var(--accent, #6c8cff); text-decoration: underline; }
.legal .legal-contact { margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border); }
```

- [ ] **Step 3: Add the disclaimer content**

Between `</header>` and `<footer …>`, insert:

```html
<main class="legal">
  <div class="wrap">
    <h1>Financial &amp; Risk Disclaimer</h1>
    <p class="legal-updated">Last updated: 24 June 2026</p>

    <p>TradingSocial is an education and performance-tracking platform. The information,
    tools, journals, leaderboards and community content available through TradingSocial are
    provided for general informational and educational purposes only.</p>

    <h2>Not financial advice</h2>
    <p>Nothing on TradingSocial constitutes financial product advice, investment advice, or a
    recommendation to buy, sell, or hold any financial product. TradingSocial does not hold an
    Australian Financial Services Licence (AFSL) and does not provide personal financial advice.
    We do not take into account your objectives, financial situation, or needs.</p>

    <h2>Seek your own advice</h2>
    <p>Before making any financial or trading decision, you should consider whether it is
    appropriate for your circumstances and seek advice from a licensed financial adviser,
    accountant, or other qualified professional.</p>

    <h2>Trading involves risk</h2>
    <p>Trading and investing carry a high level of risk and are not suitable for everyone. You
    can lose some or all of your capital, and with leveraged products you may lose more than your
    initial investment. Only trade with money you can afford to lose.</p>

    <h2>Past performance</h2>
    <p>Leaderboards, shared journals, statistics and any results displayed on TradingSocial are
    for education and community purposes only. Past performance is not a reliable indicator of
    future results. Performance shown is self-reported by users and is not verified by us.</p>

    <h2>No liability</h2>
    <p>To the maximum extent permitted by law, TradingSocial is not liable for any loss or damage
    arising from your use of the platform or any decision made in reliance on its content. This
    does not limit any rights you have under the Australian Consumer Law that cannot be excluded.</p>

    <div class="legal-contact">
      <p>Questions? Contact us at <a href="mailto:onetradingsocial@gmail.com">onetradingsocial@gmail.com</a>.</p>
    </div>
  </div>
</main>
```

- [ ] **Step 4: Fix this page's footer Legal links**

In the footer block you copied, set the four Legal column links: "Terms of service" → `/terms`, "Privacy policy" → `/privacy`, "Financial disclaimer" → `/disclaimer`, "Risk warning" → `/disclaimer`.

- [ ] **Step 5: Verify in a browser / serve**

Run: `npx http-server . -p 8080 -s` (from repo root) and open `http://localhost:8080/disclaimer.html`. Confirm nav + footer render, prose is styled and readable, footer legal links point to the new URLs. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add disclaimer.html
git commit -m "feat: add financial/risk disclaimer page"
```

---

### Task 2: Privacy Policy page (`privacy.html`)

**Files:**
- Create: `privacy.html`

**Interfaces:**
- Consumes: the page pattern + `.legal` CSS from Task 1.

- [ ] **Step 1: Scaffold from Task 1's pattern**

Copy `disclaimer.html` to `privacy.html` (it already has the `.legal` CSS, nav, footer, and corrected footer links). Replace the `<main class="legal">…</main>` content with the privacy content (Step 2). Change `<title>` to `TradingSocial — Privacy Policy`, `<meta name="description">` to `How TradingSocial collects, uses and protects your personal information under the Australian Privacy Principles.`, and the canonical to end in `/privacy`.

- [ ] **Step 2: Add the privacy content**

Replace the `<main class="legal">` block with:

```html
<main class="legal">
  <div class="wrap">
    <h1>Privacy Policy</h1>
    <p class="legal-updated">Last updated: 24 June 2026</p>

    <p>This policy explains how TradingSocial collects, uses, discloses and protects your
    personal information. We handle personal information in accordance with the Privacy Act 1988
    (Cth) and the Australian Privacy Principles (APPs).</p>

    <h2>Information we collect</h2>
    <ul>
      <li><strong>Account &amp; sign-in:</strong> your email address and password (managed by our
      authentication provider). If you sign in with Google, we receive your name and profile photo.</li>
      <li><strong>Profile:</strong> username, display name, avatar, bio, trading goals and the
      markets you select.</li>
      <li><strong>Trading journal:</strong> the trades you log — instrument, entries and exits,
      profit/loss, risk multiples, notes, and any screenshots you upload.</li>
      <li><strong>Social activity:</strong> posts, comments, likes and the accounts you follow.</li>
      <li><strong>Learning:</strong> lessons you complete and your quiz answers.</li>
      <li><strong>Support:</strong> feedback and messages you send us.</li>
      <li><strong>Technical:</strong> usage and log data, device/browser information, cookies and
      analytics data.</li>
    </ul>

    <h2>How we use your information</h2>
    <p>We use your information to operate and provide the platform (including leaderboards and
    social features), authenticate you, respond to support requests, keep the service secure, and
    improve our features.</p>

    <h2>Disclosure and service providers</h2>
    <p>We do not sell your personal information. We share it with service providers who help us
    run TradingSocial, including Vercel (website hosting), Supabase (database, authentication and
    file storage) and Google (sign-in and analytics). Some of these providers may store data
    outside Australia; where that occurs we take reasonable steps to ensure your information is
    handled consistently with the APPs.</p>

    <h2>Cookies and analytics</h2>
    <p>We use cookies and similar technologies, including Google Analytics, to understand how the
    site is used and to improve it. You can control cookies through your browser settings.</p>

    <h2>Security</h2>
    <p>We take reasonable steps to protect your personal information from misuse, loss and
    unauthorised access. No method of transmission or storage is completely secure, and we cannot
    guarantee absolute security.</p>

    <h2>Access, correction and complaints</h2>
    <p>You may request access to, or correction of, the personal information we hold about you by
    contacting us. If you have a privacy complaint, contact us first and we will respond. If you
    are not satisfied, you may contact the Office of the Australian Information Commissioner (OAIC)
    at <a href="https://www.oaic.gov.au">oaic.gov.au</a>.</p>

    <h2>Retention and deletion</h2>
    <p>We keep your information for as long as your account is active or as needed to provide the
    service and meet legal obligations. You can request deletion of your account and associated
    data by contacting us.</p>

    <h2>Children</h2>
    <p>TradingSocial is not directed at people under 18, and we do not knowingly collect their
    personal information.</p>

    <h2>Changes to this policy</h2>
    <p>We may update this policy from time to time. The "last updated" date above reflects the
    latest version.</p>

    <div class="legal-contact">
      <p>Privacy questions or requests? Contact us at
      <a href="mailto:onetradingsocial@gmail.com">onetradingsocial@gmail.com</a>.</p>
    </div>
  </div>
</main>
```

- [ ] **Step 3: Verify in a browser**

Serve the repo root and open `http://localhost:8080/privacy.html`. Confirm rendering + footer links.

- [ ] **Step 4: Commit**

```bash
git add privacy.html
git commit -m "feat: add privacy policy page"
```

---

### Task 3: Terms of Service page (`terms.html`)

**Files:**
- Create: `terms.html`

**Interfaces:**
- Consumes: the page pattern + `.legal` CSS from Task 1.

- [ ] **Step 1: Scaffold from the pattern**

Copy `disclaimer.html` to `terms.html`. Replace the `<main class="legal">` content with the terms content (Step 2). Change `<title>` to `TradingSocial — Terms of Service`, `<meta name="description">` to `The terms governing your use of TradingSocial.`, and the canonical to end in `/terms`.

- [ ] **Step 2: Add the terms content**

Replace the `<main class="legal">` block with:

```html
<main class="legal">
  <div class="wrap">
    <h1>Terms of Service</h1>
    <p class="legal-updated">Last updated: 24 June 2026</p>

    <p>These terms govern your access to and use of TradingSocial. By creating an account or using
    the platform, you agree to these terms. If you do not agree, do not use TradingSocial.</p>

    <h2>1. Eligibility</h2>
    <p>You must be at least 18 years old and able to form a binding contract to use TradingSocial.</p>

    <h2>2. The service is not financial advice</h2>
    <p>TradingSocial is an education and performance-tracking platform. It does not provide
    financial, investment or trading advice. Please read our
    <a href="/disclaimer">Financial &amp; Risk Disclaimer</a>, which forms part of these terms.</p>

    <h2>3. Your account</h2>
    <p>You are responsible for providing accurate information, keeping your login credentials
    secure, and all activity under your account. You may hold one account unless we agree
    otherwise. We may suspend or terminate accounts that breach these terms.</p>

    <h2>4. Acceptable use</h2>
    <ul>
      <li>Do not use TradingSocial for any unlawful purpose or to post unlawful, misleading,
      harassing or abusive content.</li>
      <li>Do not attempt to manipulate leaderboards, rankings, or social features.</li>
      <li>Do not scrape, copy, or reverse engineer the platform, or interfere with its operation
      or security.</li>
    </ul>

    <h2>5. Your content</h2>
    <p>You retain ownership of the content you create (journals, posts, comments). You grant
    TradingSocial a non-exclusive, worldwide, royalty-free licence to host, store and display your
    content as needed to operate the platform, including showing content you choose to share with
    other users. You are responsible for the content you post and for ensuring you have the right
    to share it.</p>

    <h2>6. Our intellectual property</h2>
    <p>TradingSocial, its name, logo, design and software are owned by us or our licensors. These
    terms do not grant you any rights to them except as needed to use the platform.</p>

    <h2>7. Australian Consumer Law</h2>
    <p>Our services come with guarantees that cannot be excluded under the Australian Consumer Law.
    Nothing in these terms excludes, restricts or modifies those guarantees. To the extent
    permitted by law, our liability for failing to meet a consumer guarantee is limited to
    re-supplying the service or paying the cost of re-supply.</p>

    <h2>8. Disclaimers and limitation of liability</h2>
    <p>The platform is provided "as is" and "as available". To the maximum extent permitted by law,
    and subject to the Australian Consumer Law, TradingSocial is not liable for any loss or damage
    (including trading losses) arising from your use of, or reliance on, the platform.</p>

    <h2>9. Changes to the service or terms</h2>
    <p>We may update the platform and these terms from time to time. We will update the "last
    updated" date, and significant changes may be notified in-app or by email. Continued use after
    changes means you accept the updated terms.</p>

    <h2>10. Governing law</h2>
    <p>These terms are governed by the laws of South Australia, Australia, and you submit to the
    non-exclusive jurisdiction of the courts of that state.</p>

    <div class="legal-contact">
      <p>Questions about these terms? Contact us at
      <a href="mailto:onetradingsocial@gmail.com">onetradingsocial@gmail.com</a>.</p>
    </div>
  </div>
</main>
```

- [ ] **Step 3: Verify in a browser**

Serve the repo root and open `http://localhost:8080/terms.html`. Confirm rendering, footer links, and that the in-text `/disclaimer` link works.

- [ ] **Step 4: Commit**

```bash
git add terms.html
git commit -m "feat: add terms of service page"
```

---

### Task 4: Wire marketing footers + sitemap

Replace the dead `#` legal links on the PRE-EXISTING marketing pages and add the new URLs to the sitemap. (The new legal pages already have correct footers from Tasks 1–3.)

**Files:**
- Modify: every pre-existing marketing page containing the footer Legal column — at minimum `index.html`; also `pricing.html`, `blog.html`, `blog-post.html`, and `404.html` if they contain the same block.
- Modify: `sitemap.xml`

- [ ] **Step 1: Find the affected pages**

Run: `grep -rl 'Terms of service' index.html pricing.html blog.html blog-post.html 404.html`
For each match, locate the footer Legal column (four `<a href="#">` links: Terms of service / Privacy policy / Financial disclaimer / Risk warning).

- [ ] **Step 2: Replace the dead links**

In each affected file, change the four Legal links to:
- `<a href="/terms">Terms of service</a>`
- `<a href="/privacy">Privacy policy</a>`
- `<a href="/disclaimer">Financial disclaimer</a>`
- `<a href="/disclaimer">Risk warning</a>`

- [ ] **Step 3: Confirm no dead legal links remain**

Run: `grep -rn 'href="#">\(Terms\|Privacy\|Financial\|Risk\)' index.html pricing.html blog.html blog-post.html 404.html`
Expected: no matches.

- [ ] **Step 4: Add the pages to `sitemap.xml`**

Open `sitemap.xml`, copy the structure of an existing `<url>` entry, and add three entries for `/terms`, `/privacy`, `/disclaimer` (use the same domain the existing entries use; `lastmod` = `2026-06-24`).

- [ ] **Step 5: Commit**

```bash
git add index.html pricing.html blog.html blog-post.html 404.html sitemap.xml
git commit -m "feat: wire footer legal links + sitemap to new pages"
```

(Only `git add` the files that actually changed.)

---

### Task 5: Signup consent links

Turn the inline "Terms" and "financial disclaimer" words in the signup checkbox label into links to the marketing legal pages, using the existing site-URL env so they resolve from the app's own origin.

**Files:**
- Modify: `app/src/app/signup/SignupForm.tsx`

**Interfaces:**
- Consumes: `process.env.NEXT_PUBLIC_SITE_URL` (already set; used by auth routes).

- [ ] **Step 1: Add a site-base constant and link the label**

In `app/src/app/signup/SignupForm.tsx`, add near the top (after imports):

```tsx
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? ''
```

Then replace the checkbox label span:

```tsx
            <span>
              I agree to the Terms and financial disclaimer. TradingSocial is an education and
              performance-tracking platform and does not provide financial advice.
            </span>
```

with:

```tsx
            <span>
              I agree to the{' '}
              <a href={`${SITE}/terms`} target="_blank" rel="noopener noreferrer">Terms</a>{' '}
              and{' '}
              <a href={`${SITE}/disclaimer`} target="_blank" rel="noopener noreferrer">financial disclaimer</a>.
              TradingSocial is an education and performance-tracking platform and does not provide
              financial advice.
            </span>
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/signup/SignupForm.tsx
git commit -m "feat(app): link signup consent to terms + disclaimer pages"
```

---

### Task 6: Verification test

A file-reading test that locks in presence, required sections, and wiring so they can't silently regress.

**Files:**
- Create: `app/tests/unit/legal.test.ts`

**Interfaces:**
- Consumes: the repo-root HTML files (read via `fs`) and `SignupForm.tsx`.

- [ ] **Step 1: Write the test**

```ts
// app/tests/unit/legal.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// repo root is three levels up from app/tests/unit
const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('legal pages exist with required content', () => {
  it('disclaimer covers AFSL + not financial advice', () => {
    const html = read('disclaimer.html')
    expect(html).toContain('Australian Financial Services Licence')
    expect(html).toContain('financial product advice')
    expect(html).toMatch(/onetradingsocial@gmail\.com/)
  })
  it('privacy covers the APPs and OAIC', () => {
    const html = read('privacy.html')
    expect(html).toContain('Australian Privacy Principles')
    expect(html).toContain('OAIC')
  })
  it('terms covers governing law (South Australia) and the ACL', () => {
    const html = read('terms.html')
    expect(html).toContain('South Australia')
    expect(html).toContain('Australian Consumer Law')
  })
})

describe('footer legal links are wired (no dead anchors)', () => {
  for (const page of ['index.html', 'disclaimer.html']) {
    it(`${page} links to /terms, /privacy, /disclaimer`, () => {
      const html = read(page)
      expect(html).toContain('href="/terms"')
      expect(html).toContain('href="/privacy"')
      expect(html).toContain('href="/disclaimer"')
    })
  }
  it('index.html has no dead legal anchors', () => {
    const html = read('index.html')
    expect(html).not.toMatch(/href="#">(Terms|Privacy|Financial|Risk)/)
  })
})

describe('signup consent links to the legal pages', () => {
  it('SignupForm references /terms and /disclaimer', () => {
    const tsx = read('app/src/app/signup/SignupForm.tsx')
    expect(tsx).toContain('/terms')
    expect(tsx).toContain('/disclaimer')
  })
})
```

- [ ] **Step 2: Run the test**

Run: `cd app && npx vitest run tests/unit/legal.test.ts`
Expected: PASS (all assertions). If any fail, the corresponding page/wiring from Tasks 1–5 is missing — fix it, do not weaken the assertion.

- [ ] **Step 3: Commit**

```bash
git add app/tests/unit/legal.test.ts
git commit -m "test: verify legal pages content + footer/signup wiring"
```

---

## Self-Review

**Spec coverage:**
- Terms / Privacy / Disclaimer pages with required sections → Tasks 1–3. ✓
- Australian jurisdiction (SA), ACL, APPs/OAIC, AFSL, contact, effective date → embedded in Tasks 1–3 content + asserted in Task 6. ✓
- Cookie notice folded into Privacy → Task 2 "Cookies and analytics". ✓
- Reuse marketing head/nav/footer; `.legal` CSS → Task 1 Steps 1–2, reused in 2–3. ✓
- Footer legal links wired across marketing pages → Task 4. ✓
- Signup consent links via `NEXT_PUBLIC_SITE_URL` → Task 5. ✓
- sitemap entries → Task 4 Step 4. ✓
- Indexable (no noindex) → pages keep the standard `<head>`; canonical updated, no robots meta added. ✓
- Lightweight verification (files exist + sections + no `#` links + signup links) → Task 6. ✓
- No migration, no separate cookie page, no app routes, no consent versioning → nothing in any task adds these. ✓

**Placeholder scan:** No TBD/TODO. Content blocks are complete prose. "If they contain the same block" in Task 4 is a real conditional with a grep to resolve it, not a placeholder. ✓

**Type consistency:** `.legal` CSS class names used in Task 1 content match the CSS block (`legal-updated`, `legal-contact`, `wrap`). `SITE` constant defined and used in Task 5. Task 6 assertions reference strings that actually appear in the Task 1–3 / Task 5 content (`Australian Financial Services Licence`, `Australian Privacy Principles`, `OAIC`, `South Australia`, `Australian Consumer Law`, `/terms`, `/disclaimer`). ✓

**Note:** Drafted legal text is starter content pending review by an Australian solicitor (flagged in Global Constraints) — not a code concern, surfaced to the user at handoff.
