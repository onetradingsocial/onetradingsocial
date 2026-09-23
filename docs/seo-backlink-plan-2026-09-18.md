# Backlink and off-site visibility plan — 2026-09-18

Checklist item 19 in `seo-audit-2026-09-18.md`. Sized for one founder at 3–4 h/week, A$0 cash. Research only; nothing below has been submitted, posted or signed up for.

**Frame.** `acquisition-2026-09-14.md` shows day-2 retention, not traffic, is the binding constraint. Backlinks compound slowly, so this plan caps the time spent on them and front-loads one-off, permanent work.

**Before promoting anything**, fix two audit items: seed accounts are indexable as "verified track record" profiles (audit #3), and blog posts only become crawlable once branch `fix/seo-static-blog-posts` is live (audit #1).

## 1. Assets worth linking to

| Asset | Status | Why someone links to it |
|---|---|---|
| `/blog/win-rate-is-lying-to-you` (R-multiples, expectancy) | exists | Answers a question people keep asking in forums; easy to cite in threads |
| `/blog/position-sizing-101` | exists | Evergreen risk maths; pairs with the calculator below |
| `/compare/vs-trading-journal-spreadsheet` | exists | Honest, and says where Excel wins. Fits the "spreadsheet template" threads |
| `/compare/best-prop-firm-trading-journal`, `/compare/best-mt5-trading-journal` | exists | "How to choose" guides rather than sales pages; suit prop-firm communities |
| `app.tradingsocial.io/demo` | exists | A populated journal anyone can open without signing up. Required for Show HN |
| Public profiles with OG cards (`api/og/profile`) | exists | Traders link to their own records. This matters only after audit #3 is fixed |
| **Position-size + expectancy calculator** (a static page on www, client-side JS) | **build** | Cheapest link magnet: no backend, uses maths the two posts already contain, and qualifies for Show HN. It must present the maths only, not recommend a risk %, and carry the disclaimer |
| **Prop-firm drawdown / daily-loss calculator** (same page family) | **build** | Serves the beachhead audience. It can be a second tab on the same page |
| **Embeddable "verified track record" badge** (small image route next to the OG route, plus a copy-paste snippet) | **build, later** | Links from educators' sites back to their profiles. Build it only once the plan's decision #7 fixes the wording of what "verified" certifies |
| Public stats page | exists as `/api/stats`; **hold** | With about 31 real users it would advertise how small the product is. Revisit at hundreds of users |

## 2. Directories and listings

I verified that each one exists and fits (searched 2026-09-18). Link type is "unknown" wherever I couldn't confirm it; several sites block automated fetches.

| Place | Cost | Link type | Effort | Needed from founder |
|---|---|---|---|---|
| [SaaSHub](https://www.saashub.com/tradersync-alternatives) (TraderSync's page lists 14+ journal alternatives) | Free; paid promotion exists | **Uncertain**: sources disagree on whether free listings are dofollow | 30 min | Domain email to verify; list TradeZella/TraderSync/Edgewonk as competitors ([submit rules](https://www.saashub.com/services/submit)) |
| [AlternativeTo](https://alternativeto.net/software/tickerscribe/) (active trading-journal cluster, updated Aug 2026) | Free | Unknown | 30 min | Account; "alternative to" tags |
| [Slashdot / SourceForge "Trading Journals"](https://slashdot.org/software/trading-journals/) (TradeZella, TraderSync and Tradervue listed) | Free listing; paid ads | Unknown | 30 min | Vendor account ("Add Your Software") |
| [Product Hunt](https://www.producthunt.com/categories/stock-trading) | Free | Nofollow/ugc on the product link, [per a July 2026 check](https://linkbuildingjournal.co.uk/product-hunt-link-building/) | High (launch day) | Hold until Q2, per the plan's Move 5 |
| [BetaList](https://betalist.com/criteria) | Free | Unknown | 30 min | Product must be "relatively new"; custom landing page (you have both) |
| [Indie Hackers products](https://www.indiehackers.com/products) | Free | Unknown | 30 min | Founder account; a journey post, not an ad |
| [G2](https://sell.g2.com/create-a-profile) | Free profile | Unknown | 1 h | Business email. **Low priority:** B2B buyer audience |
| [Capterra](https://www.capterra.com.au/company/vendors) | Free listing; PPC from $2/click, $500/mo floor ([source](https://www.spotsaas.com/blog/capterra-advertising)) | Unknown | 1 h | **Low priority:** journals are filed under "Investment Management" there. No PPC |

**Not applicable:**
- **MQL5 Market** lists MT5 programs. TradingSocial syncs through an investor password and has no EA to list.
- **cTrader Store:** no cTrader support.
- **TradingView:** scripts and ideas may not contain links, and signature links need Premium ([rules](https://www.tradingview.com/support/solutions/43000472770-am-i-allowed-to-include-links-to-3rd-party-sites-in-my-signature/)).

## 3. Competitor backlink gap

The compare pages target **TradeZella** (tradezella.com), **TraderSync** (tradersync.com) and **Edgewonk** (edgewonk.com). The spreadsheet page targets no competitor. I don't know their full backlink profiles.

**How to find their referring domains for free:**
- [Ahrefs Backlink Checker](https://ahrefs.com/backlink-checker): a limited sample per domain.
- Moz Link Explorer and Semrush: a small number of free queries each, with an account. Limits vary by source.
- Seobility: 3 checks/day, no account.
- Search operators, e.g. `"tradezella" "best trading journal" -site:tradezella.com`.
- YouTube search for "tradezella review", then check the description links.

Put every domain that links to two or more of the three competitors in a sheet. That overlap is the target list.

**Likely categories:**
- Affiliate "best trading journal" listicles
- Prop-firm blogs
- Review sites
- YouTube descriptions carrying affiliate codes
- Forum threads
- Software directories

**Real listicles found (checked 2026-09-18):**
1. https://www.stockbrokers.com/guides/best-trading-journals: independent, updated Aug 2026
2. https://fundedtrading.com/best-trading-journal/: prop-focused, updated Aug 2026. It discloses free Pro access from vendors and "no payment for placement". **Best first pitch**
3. https://propfirmapp.com/trading-tools/trading-journals: prop and futures
4. https://daytradingz.com/best-trading-journal/: affiliate links disclosed
5. https://tradeify.co/post/best-trading-journals-2026: published by a prop firm
6. https://slashdot.org/software/trading-journals/: directory
7. https://tradeciety.com/best-online-trading-journals: owned by Edgewonk's makers. Not pitchable, but worth mining for who links to it
8. https://www.tradezella.com/best-trading-journal: competitor-owned, for mining only
9. https://www.tradervue.com/blog/best-trading-journal: competitor-owned, for mining only

**What this shows:** independent listicles run largely on affiliate codes or free reviewer access. Without an affiliate offer, the realistic way in is free Pro access with disclosure (decision 4).

## 4. Communities

The rule for every community below: participate as a trader who built a tool, disclose it every time, and give no trade or financial advice. Per `disclaimer.html`, TradingSocial holds no AFSL and gives no personal advice. No sockpuppets, no vote requests, and no reviews from anyone connected to the company.

| Community | Self-promotion rules | Checked? |
|---|---|---|
| r/propfirm, r/Forex, r/Daytrading, r/FuturesTrading, r/Trading | **Not checked.** Reddit blocks automated access. Read each sidebar and wiki before the first post. Reddit's content policy bans spam and vote manipulation, and the common 9:1 contribution ratio is a convention, not an official rule ([summary](https://redship.io/blog/reddit-self-promotion-rules)) | No |
| r/SideProject, r/indiehackers | r/indiehackers reportedly allows one "Show IH" post per product, framed as a request for feedback ([third-party](https://gofindevo.com/subreddits/indiehackers)) | Indirectly |
| [Forex Factory](https://www.forexfactory.com/thread/509062-rules-for-commercial-members) | Promotion only by designated Commercial Members, in the Commercial Content forum. Affiliation must be obvious, and suspected shills are banned without proof | Via search; the page blocks fetches |
| [BabyPips forum](https://www.babypips.com/forum-policy) | No commercial links outside the Commercial category, one commercial topic at a time, and affiliation disclosed in the post and profile | Via search; the page blocks fetches |
| [Hacker News, Show HN](https://news.ycombinator.com/showhn.html) | Must be something people can try without signing up. No landing pages or reading material | Yes |
| Indie Hackers | Journey and lessons posts are welcome; pure ads get downvoted | Indirectly |
| Prop-firm YouTube comments and Discords | Per-server rules. Answer questions; don't drop links | No |

## 5. Digital PR sources (verified to exist in 2026)

- **[HARO](https://www.helpareporter.com/):** Featured.com relaunched it free in April 2025 ([report](https://www.stanventures.com/news/help-a-reporter-out-haro-to-shut-down-in-december-2024-1218/)). The site rate-limited my check, so how active it is now is uncertain.
- **[Source of Sources](https://www.buzzstream.com/blog/source-of-sources-podcast/):** Peter Shankman's free service, with up to three query emails a day. Irrelevant replies get you permanently removed.
- **[Qwoted](https://www.qwoted.com/pricing/):** the free Basic plan allows 2 pitches/month with a 2-hour delay. Pro is $149/month; skip it.
- **Featured.com:** limited free tier (third-party reports).
- **#journorequest on X and Bluesky:** free.

**Caveat:** PR needs a real, named expert. The four blog bylines (Maya Okonkwo, Daniel Reyes, Priya Anand, Leo Carter) appear to be placeholders for a founder-only company. That is **uncertain; please confirm**. Pitches must go out under your real name, and answers must stay educational: journaling, process, statistics, never "what to trade".

## 6. 90-day sequence (3–4 h/week)

- **Wk 1:** Get audit #3 (seed profiles) fixed and the blog pre-render live. Verify Search Console and baseline the Links report.
- **Wk 2:** Write one reusable listing kit: 50/160-word descriptions, 4 screenshots, logo, the competitor list, and the demo URL.
- **Wk 3:** SaaSHub, AlternativeTo, Slashdot/SourceForge.
- **Wk 4:** BetaList, Indie Hackers product page. Subscribe to SOS and HARO, and set a 15-minute daily filter for trading, fintech and personal-finance queries.
- **Wk 5:** Competitor gap sheet (§3), 1 hour. Read the Reddit and forum rules pages yourself.
- **Wk 6:** Build the calculator (Claude drafts it; you review the maths and disclaimer).
- **Wk 7:** Link the calculator from the two posts and the compare pages. Start community answers at 3 per week, linking only where the link genuinely helps.
- **Wk 8:** Pitch fundedtrading.com and stockbrokers.com: an honest one-paragraph note, the demo link, free Pro for testing, disclosed.
- **Wk 9:** Show HN with the calculator (no signup). Indie Hackers journey post.
- **Wk 10:** Pitch 2 more listicles from the gap sheet. Answer 2 journalist queries.
- **Wk 11:** Second calculator tab (prop-firm drawdown). Link it from `/for/prop-firm`.
- **Wk 12:** G2 and Capterra free profiles, if time allows. Check referring domains in Search Console.
- **Wk 13:** Review: which links arrived, which referrals the app saw. Decide whether to keep 3 h/week or move it to retention.

## 7. Decisions needed from you

1. **Byline: your name or the brand?** *Recommend:* your real name for PR and communities, where it is required anyway. Also confirm whether the four blog authors are real people. If they aren't, re-attribute the posts.
2. **Build the calculator?** *Recommend:* yes. One static page, about a day of work, and the only asset on this list that can earn links without outreach.
3. **Budget for paid listings?** *Recommend:* A$0. Every place above has a free tier. No Capterra PPC, no paid "featured" slots, and never paid links.
4. **Affiliate or referral offer for creators and reviewers?** *Recommend:* no cash affiliate until there is revenue. Offer disclosed free Pro access to reviewers now, and extend the existing give-get `/referrals` to creators later.
5. **When to launch on Product Hunt?** *Recommend:* hold for the verified-sync milestone (plan Move 5).
6. **Badge wording.** *Recommend:* no badge until "what verified certifies" is written down and, ideally, read by a lawyer.
