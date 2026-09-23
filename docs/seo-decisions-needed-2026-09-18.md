# SEO work: decisions needed from you, 2026-09-18

> **Status 2026-09-23 (final).** Everything I can do without your accounts is
> done and live: PRs #61, #63–#81. D18 (IndexNow) is wired and the first
> submission was accepted. The D15 cross-links are in, written so they become
> links on the day each scheduled post publishes. **Left for you: D5** — three
> directory listings and Show HN, with paste-ready copy in
> [listings-copy-2026-09-23.md](listings-copy-2026-09-23.md). Deferred with
> reasons: D7, D8, D11.

Everything that could be decided safely is being done in PRs. This file lists only what needs your call. Each item includes a recommendation, so a one-word answer is enough.

## Work in progress

| PR | What | State |
|---|---|---|
| [#61](https://github.com/onetradingsocial/onetradingsocial/pull/61) | Blog posts pre-rendered: 10 real pages instead of 1 shared page | **Merged 2026-09-19, verified live** |
| [#63](https://github.com/onetradingsocial/onetradingsocial/pull/63) | App: robots.txt, sitemap, noindex on auth and gated pages, internal accounts noindexed, profile H1 | Open. Held until a production check confirms no existing username contains a dot or matches a route name, because those profiles would start returning "not found". See D6–D9 |
| [#65](https://github.com/onetradingsocial/onetradingsocial/pull/65) | Site: crawlable blog index, heading hierarchy, JSON-LD on pricing and blog, footer compare links, sitemap dates from git, llms.txt | **Merged 2026-09-19, verified live**, see D12 |
| [#64](https://github.com/onetradingsocial/onetradingsocial/pull/64) | Site images: home page first-load images 4.35 MB → 86 KB, identical layout | **Merged 2026-09-19, verified live**, see D10–D11 |
| — | Backlink strategy draft ([docs/seo-backlink-plan-2026-09-18.md](seo-backlink-plan-2026-09-18.md)) | Done, see D4 and D5 |

**#61, #65 and #64 are live.** D2 (Search Console) can be done now.

## Decisions

### D1. Shorter titles and descriptions: approve, edit or reject

**Decided 2026-09-21: applied as drafted — #68, live.**

Google cuts titles at about 60 characters and descriptions at about 155–160. Everything below keeps the existing wording and claims, just shortened. Nothing has been changed yet.

**Titles over 60 characters**

| Page | Now | Proposed |
|---|---|---|
| for/educators | Trading Educator Platform for Verified Proof — TradingSocial (62) | Verified Track Records for Trading Educators — TradingSocial (60) |
| for/forex | Forex Trading Journal for Pairs and Sessions — TradingSocial (62) | Forex Trading Journal for Pairs & Sessions — TradingSocial (58) |
| compare/best-mt5-trading-journal | Best MT5 Trading Journal — How to Choose One \| TradingSocial (62) | Best MT5 Trading Journal: How to Choose \| TradingSocial (55) |
| compare/best-prop-firm-trading-journal | Best Prop Firm Trading Journal — How to Choose One \| TradingSocial (68) | Best Prop Firm Trading Journal: How to Pick \| TradingSocial (59) |
| compare/edgewonk-alternative | Edgewonk Alternative — An Honest Comparison \| TradingSocial (61) | Edgewonk Alternative: An Honest Comparison \| TradingSocial (58) |
| compare/tradersync-alternative | TraderSync Alternative — An Honest Comparison \| TradingSocial (63) | TraderSync Alternative: An Honest Comparison \| TradingSocial (60) |
| compare/tradezella-alternative | TradeZella Alternative — An Honest Comparison \| TradingSocial (63) | TradeZella Alternative: An Honest Comparison \| TradingSocial (60) |
| compare/vs-trading-journal-spreadsheet | Trading Journal vs Spreadsheet — Which Should You Use? \| TradingSocial (72) | Trading Journal vs Spreadsheet: Which to Use \| TradingSocial (60) |

**Descriptions over 160 characters, or too thin**

| Page | Proposed |
|---|---|
| index (170 → 155) | The social trading journal for serious traders. Journal trades, track real performance, follow traders and compete on leaderboards that label every source. |
| pricing (186 → 153) | Pricing in Australian dollars: Free forever, Trader at A$30/month, Pro Trader at A$50/month. 14 days of Pro free — cancel before it ends and pay nothing. |
| for/mt5 (164 → 153) | Import your MT5 statement, or connect your account on Pro: closed trades sync hourly, verified and locked so imported prices and results can't be edited. |
| compare/best-mt5 (163 → 153) | Sync or statement import? What MetaTrader 5 actually exposes, six questions to ask before you pick an MT5 trading journal, and where TradingSocial lands. |
| compare/best-prop-firm (178 → 148) | Seven things a prop firm trading journal must do during an evaluation, and an honest account of where TradingSocial meets them and where it doesn't. |
| compare/edgewonk (169 → 155) | Looking for an Edgewonk alternative? A fair comparison of psychology tracking, broker coverage and reporting — and the one difference that isn't a feature. |
| compare/tradersync (158 → 149) | Looking for a TraderSync alternative? A fair comparison of broker coverage, rule tracking and analytics, and the one difference that isn't a feature. |
| compare/tradezella (172 → 148) | Looking for a TradeZella alternative? A fair look at what each does well, where TradeZella is stronger, and the one difference that isn't a feature. |
| compare/vs-spreadsheet (163 → 147) | A trading journal spreadsheet vs a dedicated journal: what Excel genuinely does better, where it quietly costs you, and how to decide which to use. |
| terms (46 → ~150) | The terms for using TradingSocial: eligibility, your account, plans and payment, the 14-day free trial, cancelling, refunds and Australian Consumer Law. |

**Recommendation:** approve as written. This is low risk, and the pricing line keeps the exact trial wording already on the page. The blog post titles (several over 60 characters) are not included; say if you want those too.

### D2. Search Console: only you can do this

**Decided 2026-09-21: both sitemaps submitted; 5 URLs queued for recrawl.**

After the PRs merge:
1. Submit `https://www.tradingsocial.io/sitemap.xml`, and the app sitemap once that PR lands, in Google Search Console and Bing Webmaster Tools.
2. Use URL Inspection → Request indexing on 3–4 blog posts.

This needs your Google login. **Recommendation:** do it the day #61 is live.

### D3. Are the four blog authors real people?

**Decided 2026-09-21: all 10 posts credited to Nathan Maiolo, "Founder · TradingSocial" — #66, live.**

The posts are credited to Maya Okonkwo, Daniel Reyes, Priya Anand and Leo Carter, each with a bio. The company is founder-only. Google's quality guidelines weigh real, identifiable authors, and the `BlogPosting` structured data in #61 now states each one as a `Person`.

If they're personas, that is a trust problem, not just an SEO one.

**Recommendation:** credit all 10 posts to you by name, or to "TradingSocial team" if you'd rather not. Either way it's one edit to `data/posts.json` plus a rebuild, which I can do as soon as you choose.

### D4. Build a free position-size and expectancy calculator?

**Decided 2026-09-21/22: both tools built and live — /tools/position-size-calculator (#71) and /tools/expectancy-calculator (#72).**

This comes from the backlink plan ([docs/seo-backlink-plan-2026-09-18.md](seo-backlink-plan-2026-09-18.md)). It's one static page with no backend, reusing the maths already in two posts. It's the only asset that can earn links without outreach, and the only thing eligible for Show HN.

**Recommendation:** yes. I can build it once you say so.

### D5. Backlink plan: remaining calls

**Still yours, and the only open item. The copy for all three listings and for Show HN is written: [listings-copy-2026-09-23.md](listings-copy-2026-09-23.md). I cannot create accounts or post as you.**

These are the plan's section 7, in short:

- **Paid listings:** A$0.
- **Creator affiliate:** no cash affiliate yet; offer disclosed free Pro to reviewers.
- **Product Hunt:** hold for the verified-sync milestone.
- **"Verified" badges:** none until what "verified" certifies is written down.
- **Directory sign-ups** (SaaSHub, AlternativeTo, Slashdot/SourceForge): these need your accounts, so only you can do them.

**Recommendation:** accept the plan's defaults.

### D6. The word "verified" on public profiles

**Decided 2026-09-21: wording is now conditional on trade source — #67, live.**

Every public profile's search title reads "… — verified trading track record", and its description says "verified trading performance". That includes profiles whose trades were all entered by hand. This is what Google shows for every profile.

**Recommendation:** use "verified" only where the trades were broker-synced. Otherwise say "trading track record". This is the same question as the "verified" badges in D5, so decide both together. #63 does not change this wording.

### D7. Real redirects for login-only pages

**Decided 2026-09-21: deferred. The noindex tags do the SEO job; middleware runs on every request and wants a staging test.**

Today, `/leaderboard`, `/learn`, `/journal`, `/messages`, `/referrals`, `/achievements` and `/feature-board` show logged-out visitors a blank page with status 200, which then bounces to `/login`. #63 marks them "don't index", and search engines are allowed to fetch them so they actually read that tag.

The proper fix is a real redirect in `middleware.ts`. Middleware runs on every request, so this needs a staging test.

**Recommendation:** do it after #63 has been live for a couple of weeks, then block those pages in robots.txt.

### D8. Validate usernames at signup

**Decided 2026-09-21: deferred. Needs a migration and nothing is broken today.**

The signup trigger accepts any username that's sent to it directly. #63 stops dotted or reserved names from rendering as profiles, but fixing it properly needs a database migration.

**Recommendation:** yes, as a small migration applied before merging, per the usual process.

### D9. Public profiles with no trades in the sitemap

**Decided 2026-09-21: sitemap lists only profiles with a public closed trade — #70, live. It dropped the app sitemap from 38 URLs to 6, i.e. only 3 of 35 profiles have any public closed trades.**

#63 lists every public, onboarded, non-internal profile, including ones with no trades. Thin pages can drag down how Google rates the whole app domain.

**Recommendation:** list only profiles with at least one closed trade. This is a one-line filter I can add once you agree.

_Resolved without you:_

- robots.txt no longer blocks the pages it marks "don't index". Blocking them would have stopped Google from ever reading the tag.
- The profile canonical base already matches production, because live canonicals are `https://app.tradingsocial.io/<user>`.
- `/llms.txt` on the app is left as not-found; the marketing site gets the real one.

### D10. Re-encode the hero video?

**Decided 2026-09-21: re-encode skipped (no ffmpeg on this machine); phones and reduced-motion visitors no longer download the video at all — #69, live.**

The home page background video is 1920×1080 and 50 seconds long: 16.8 MB as MP4, 11.2 MB as WebM. It's shown at about 1150 px wide and 38% opacity, and because it autoplays, all of it downloads.

**Recommendation:** re-encode at 1280 px and about 1 Mbps. That's roughly 6 MB, and at 38% opacity it should look the same. I can do it and compare the frames side by side. Your call, because it's a brand asset.

### D11. Load `consent.js` without blocking the page?

**Decided 2026-09-21: deferred. Small gain, and it is the legal consent gate.**

It loads synchronously in `<head>` on every page, which delays first paint. Deferring it could change *when* the consent gate runs relative to tags, and that gate exists for legal reasons.

**Recommendation:** leave it for now. The benefit is small next to the image work, and the risk is a consent regression.

### D12. Footer and small copy choices in #65

**Decided 2026-09-21: accepted as built.**

- **Compare links:** a "Compare" group now sits under Product in every footer, linking all six compare pages. The footer is about 150 px taller on desktop and 225 px on phones.
- **Link labels:** two labels were shortened ("Prop firm trading journal", "MT5 trading journal").
- **Author name:** in blog posts, the author's name is now a styled line rather than a heading.
- **Blog name:** the blog's structured data names it "The TradingSocial Journal", taken from the blog hero.

**Recommendation:** accept all four; each is a one-line change if you want it different.

_All the work that could proceed without you is now in PRs. Everything left is on this list._
