# Review — six blog drafts

Reviewed 22 September 2026. Every cited URL was opened on that date. Every
quotation was checked character by character against the source. Every number,
formula and worked example was recomputed independently; the expectancy
examples were checked against the actual script in
`tools/expectancy-calculator.html` (lines 2003–2112), not against the prose on
that page.

Nothing in the drafts was edited. This file is the only thing written.

---

## Verdicts

| Draft | Verdict |
|---|---|
| `how-to-calculate-trading-expectancy.md` | **publish after fixes** |
| `prop-firm-drawdown-rules-explained.md` | **publish after fixes** |
| `what-an-mt5-statement-contains.md` | **publish after fixes** |
| `what-to-record-in-every-journal-entry.md` | **needs rework** |
| `the-twenty-minute-weekly-review.md` | **needs rework** |
| `why-your-backtest-lies-about-drawdown.md` | **needs rework** |

**`how-to-calculate-trading-expectancy.md` — publish after fixes.** The
strongest draft on arithmetic in the set. Every figure in both worked examples
reproduces exactly against the calculator's script, including the rounding
behaviour of `toFixed(2)` and `toFixed(1)`, and the long-way cross-check
(34 × $412 = $14,008; 46 × $188 = $8,648; $5,360 ÷ 80 = $67.00) is internally
consistent. Both MetaQuotes quotations and the NIST quotation are verbatim. Its
"read for coverage" block is the only one in the set that survives checking. The
fixes are a locale bug in a reproducibility claim, an unsupported attribution to
Van Tharp, and a decision about overlap with the already-published
`/blog/win-rate-is-lying-to-you`.

**`prop-firm-drawdown-rules-explained.md` — publish after fixes.** The
highest-risk material and the best-executed sourcing. All nine cited pages
loaded and all eleven direct quotations are verbatim, including the Apex page
that refuses automated fetching (read in a browser instead). The Topstep dollar
figures, the Apex trailing distances, the FTMO percentages and reset times and
The5ers 0.5% profitable-day definition all match the firms' own pages today. The
Apex 50K worked example ($50,000 / $48,000 / peak $52,500 / threshold $50,500)
is arithmetically correct on Apex's published distances. It cannot publish as
drafted because it carries an editorial `[UNVERIFIED: …]` bracket in the
reader-facing body, and because one row of its comparison table omits the axis
the whole article is built on.

**`what-an-mt5-statement-contains.md` — publish after fixes.** Almost all of the
MetaQuotes material checks out verbatim — the Details block statistics, the full
deals column list, the Positions view fields, the `ReportHistory.htm` template,
the netting/hedging distinction, the build 4150 export note. One sentence is
flatly wrong about what its own cited source says, one file-format claim is
unsupported, the product paragraphs omit the plan gates, and it too has an
`[UNVERIFIED: …]` bracket in the body — which is resolvable, because the
official help page states the menu label outright.

**`what-to-record-in-every-journal-entry.md` — needs rework.** Not because of
its facts — Fischhoff, Roese & Vohs, FTMO and MetaQuotes all check out — but
because it re-writes a post that is already published under the same byline.
`/blog/why-a-trading-journal` already contains a section called "What a useful
entry actually contains" with the same field list and, in the emotion field, the
same words in the same construction. It also makes a product claim the site's
own truthfulness tests exist to prevent, and describes two paid features in a
post that says the journal is free to start. Reposition it against the published
post or fold it in; it cannot ship alongside it as-is.

**`the-twenty-minute-weekly-review.md` — needs rework.** Its academic sourcing
is good — Baron & Hershey, the Aiyer replication and Thaler et al. all verify,
and the Thaler caveat is handled honestly. But it contradicts a published post
under the same byline head-on: `/blog/why-a-trading-journal` recommends a
ten-minute *daily* review, and this draft opens by arguing that a day is "the
worst possible unit to draw a conclusion from". It also makes three false
statements about a named competitor's page — statements that happen to be the
post's entire claim to differentiation, and all three are wrong.

**`why-your-backtest-lies-about-drawdown.md` — needs rework.** The academic spine
is sound: Magdon-Ismail et al., Harvey/Liu/Zhu, Brown et al. and the SNB
reporting all verify verbatim. But its Sources block puts quotation marks around
two figures and attributes them to two named companies' pages, and neither
figure appears on either page. One of those pages argues the exact opposite. In
a post whose thesis is that unreported numbers are the problem, that is
disqualifying until it is removed.

---

## Findings, by severity

### Factual errors

**F1 — Fabricated quotations attributed to two named companies.**
`why-your-backtest-lies-about-drawdown.md`, Sources, ~line 92:

> "both quote unsourced degradation percentages ("live results are 60–70% of
> backtest", "10–30% worse")"

Both pages were opened today. **Neither contains either figure, or any
percentage of that kind.** The LuxAlgo page argues the reverse of what is
attributed to it — it tells the reader to "test adverse scenarios instead of
treating an unsourced market-wide percentage table as a forecast". The
PineConnector page uses only qualitative language.

This is the most serious problem in the set. It is a false statement of fact
about two named businesses, dressed in quotation marks, published under the
founder's name, on a site whose pitch is that its numbers are checkable — and
the sentence's whole rhetorical purpose is to accuse those two pages of the sin
the post is about.

*Fix:* delete the parenthetical and its claim entirely. If a contrast with those
pages is still wanted, say only what is verifiable: that neither treats drawdown
as an extreme-order statistic or addresses multiple testing. Do not paraphrase
either page's numbers, because it has none.

**F2 — The cited source says the opposite.**
`what-an-mt5-statement-contains.md`, ~line 42:

> "MQL5's own documentation notes there is no way to obtain the server's time
> zone programmatically."

The cited page (`mql5.com/en/book/common/timing/timing_local_server`) says no
such thing. It says the offset *is* obtainable: "The built-in function
TimeTradeServer calculates like this: TimeLocal() - shiftInHours * 3600", and
the page's own example function derives "the difference between local and server
time in hours (that is, the time zone difference)".

*Fix:* the defensible version is narrower. The file carries no time-zone field,
and what a program can recover is an offset in hours, not a named zone with DST
rules — so a statement read months later cannot be mapped back to a session
reliably. Rewrite to that, keeping the same citation, which does support it.

**F3 — A named competitor's page mischaracterised on three counts.**
`the-twenty-minute-weekly-review.md`, Sources, ~line 82:

> "It gives a good minute-by-minute budget and a metric list, but does not
> address why weekly rather than daily, what sample size makes a pattern real,
> or what to deliberately ignore, which is where this post concentrates."

The page (TradeZella, "How to Review Your Trades: A 30-Minute Weekly Framework",
dated 2 April 2026) addresses all three. On daily versus weekly: "Daily reviews
tend to be too reactive, one bad trade feels like a crisis. Monthly reviews are
too infrequent". On sample size: "aim for at least 15-20 trades per review
period". On what to skip: it directs the reader to "aggregate patterns" rather
than "every single trade in detail".

This matters twice — it is false about a named third party, and it is the
sentence in which the draft states its reason to exist. If the gap it claims is
not there, the post needs a different angle, not a corrected footnote.

*Fix:* re-read the page and re-state the actual difference (this draft argues
from outcome bias and from a three-trade daily sample; that one does not), or
drop the comparison.

**F4 — A reproducibility claim that fails for Australian and British readers.**
`how-to-calculate-trading-expectancy.md`, ~line 40:

> "Type 42.5, 412, 188 and 80 into the expectancy calculator with USD selected
> and it returns exactly that: expectancy $67.00, reward-to-risk 2.19 : 1,
> break-even win rate 31.3%, profit factor 1.62, and $5,360.00 over 80 trades."

The maths is right — I reproduced all five outputs from the script. The
*formatting* is not. The calculator formats currency with
`new Intl.NumberFormat(undefined, …)` (line 2036), which takes the reader's
browser locale. Checked:

| Browser locale | What the page actually prints |
|---|---|
| en-US | `$67.00` / `$5,360.00` |
| **en-AU** | **`USD 67.00` / `USD 5,360.00`** |
| **en-GB** | **`US$67.00` / `US$5,360.00`** |

On a site priced in A$ and written in Australian English, most readers who
follow the instruction will not see "exactly that".

*Fix:* either select R for the worked example (R formatting is hard-coded at
line 2033 and is locale-independent), or change "it returns exactly that" to
name the figures without the currency symbol — "expectancy 67.00 per trade,
reward-to-risk 2.19 : 1, break-even 31.3%, profit factor 1.62, 5,360.00 over 80
trades" — and note that the symbol follows the reader's browser.

**F5 — A second competitor page mischaracterised.**
`what-to-record-in-every-journal-entry.md`, Sources, ~line 88:

> "Both are representative of what ranks: a column list, emotions mentioned as a
> "notes" field…"

True of the TradeZella template page. Not true of `howtotrade.com`, which gives
emotions a dedicated heading — "Emotions and Behavior" — covering feelings
before, during and after trades, emotional triggers and distractions, alongside
separate "Trade Information", "Trading Strategy" and "Comments and Notes"
groups.

*Fix:* the shared, accurate criticism of both pages is the one the draft already
makes second — that neither explains which later question any field answers.
Lead with that and drop the "notes field" characterisation.

**F6 — A finding restated more strongly than the paper states it.**
`why-your-backtest-lies-about-drawdown.md`, ~line 44:

> "Most strategies with more than about 50% monthly turnover, they found,
> produce no significant net returns at all."

Novy-Marx & Velikov's abstract: "Most of the anomalies that we consider with
**one-sided** monthly turnover lower than 50% continue to generate statistically
significant net spreads, **at least when designed to mitigate transaction
costs**. Few of the strategies with higher turnover do."

Three drifts: "one-sided" is dropped, which roughly halves the threshold being
quoted; the mitigation qualifier is dropped; and "few … do [generate significant
net spreads]" becomes "produce no significant net returns at all", which is
stronger and changes "spreads" to "returns".

*Fix:* "Few of the anomalies with one-sided monthly turnover above 50% generate
a statistically significant net spread, even when the strategy is designed to
mitigate costs."

The quotation immediately above it — "in all cases transaction costs reduce the
strategies' profitability and its associated statistical significance" — is
verbatim and correct.

**F7 — An export-format claim the cited page does not make.**
`what-an-mt5-statement-contains.md`, ~line 18: "It saves as HTML or XLSX."

The cited history-report page states only "To save the report, select 'Report'
in the context menu of the History tab" and that "HTML reports are generated
from a template ReportHistory.htm". XLSX is not mentioned. (`for/mt5.html`
claims TradingSocial *reads* HTML, XLSX and CSV — a different claim about a
different product.)

*Fix:* either cite a page that states the formats, or write "It saves as HTML;
the terminal also offers a spreadsheet export."

**F8 — A conditional result stated unconditionally.**
`why-your-backtest-lies-about-drawdown.md`, ~line 24:

> "with five years of data, examining as few as 45 configurations is enough that
> one of them will stand out with an attractive Sharpe ratio in sample and a
> dismal one out of sample."

The result holds for strategies with no genuine edge — it is a statement about
what a search over noise will throw up, not a guarantee about any 45
configurations. The publisher's own release words it as "for a model based on 5
years of data, one can be misled by looking at even as few as 45 sample
configurations".

*Fix:* add the condition — "…enough that one of them will look good in sample
even when none of them has any real edge."

### Unsourced claims

**U1 — The thesis sentence has no support.**
`why-your-backtest-lies-about-drawdown.md`, ~line 10: "maximum drawdown holds up
worst — worse than win rate, worse than profit factor, worse than expectancy".
Presented as established fact. No source, and no comparative evidence anywhere
in the post; what follows are mechanisms specific to drawdown, not a ranking
against the other three.

*Fix:* "degrades for reasons the other figures do not share", then let the
sections make the case.

**U2 — An absolute statistical claim, unsourced and false as written.**
`the-twenty-minute-weekly-review.md`, ~line 18: "Nothing you observe in three
trades is distinguishable from chance." Three trades can be distinguishable from
chance given a sufficiently extreme outcome; what is true is that nothing
*useful about a tendency* can be inferred.

*Fix:* "Almost nothing you can observe in three trades separates a tendency from
chance."

**U3 — A primary claim carried by a third-party prep provider.**
`why-your-backtest-lies-about-drawdown.md`, ~line 36: "The CFA curriculum splits
it into three". The citation is AnalystPrep study notes, not CFA Institute.
AnalystPrep does give the three sub-types verbatim and names the reading
(Level II, Reading 42), so the content is right, but the sentence claims the
curriculum and cites a summary of it.

*Fix:* "CFA Level II study notes on backtesting split it into three", or cite
CFA Institute directly.

**U4 — A comparison row missing the axis the article is built on.**
`prop-firm-drawdown-rules-explained.md`, ~line 62: "**The5ers High Stakes** —
10% maximum loss, 5% daily, three profitable days required." The other three
rows all state what the limit is measured against and when it moves — which the
section exists to demonstrate. This one does not, and I could not establish from
The5ers' own High Stakes page whether its 10% is static or trailing, or whether
it reads balance or equity.

*Fix:* either confirm and state the basis, or drop the row. As it stands it is
the one line in a four-row table that does not do the table's job.

**U5 — Domain knowledge presented as sourced.**
`what-an-mt5-statement-contains.md`, ~line 32: "in, out, or in/out for a
reversal". The cited page gives the three values — "direction of the deal
relative to the current position of a particular symbol: 'in', 'out' or
'in/out'" — but not "for a reversal". Separately, the Orders column list at
~line 30 (Time, Order, ID, Symbol, Type, Volume, Price, S/L, T/P, Comment,
State) was not confirmed on either cited page; the Deals and Positions lists
were, exactly.

**U6 — An origin claim the source does not make.**
`how-to-calculate-trading-expectancy.md`, Sources, ~line 99, is flagged
`[UNVERIFIED]` on the grounds that the page would not load. **It loads now.**
It supports R as initial risk ("your initial risk is $10 per share, so in this
case, 1R is equal to $10") and expectancy as the mean R-multiple ("the mean … of
a system's R-multiple distribution equals the system's expectancy"). It does
**not** credit Tharp with originating the R-multiple vocabulary, which is what
the source line claims it is cited for.

*Fix:* re-word the source line to what the page supports, and drop "origin of
the R-multiple vocabulary" unless a primary citation for the coinage is found.
The body does not depend on it.

### Compliance risks

Checked against `app/tests/unit/copy-claims.test.ts`, `app/src/lib/verification.ts`,
`app/src/lib/entitlements.ts`, `index.html`, `pricing.html`, `for/journal.html`,
`for/prop-firm.html` and `for/mt5.html`.

**C1 — A product claim the site's own truthfulness tests exist to prevent.**
`what-to-record-in-every-journal-entry.md`, ~line 33:

> "imported numbers carry a badge saying they came from the broker rather than
> the keyboard."

For a **statement import** that is not what the label means or what the product
can support. `copy-claims.test.ts` states the boundary in its own comment: "an
MT5 statement can be altered before it is uploaded". `verification.ts` labels
that source `statement_imported` — "Statement imported" — precisely because it
is not "from the broker". The sibling draft gets this exactly right
(`what-an-mt5-statement-contains.md`, ~line 58: "the file passed through your
machine on the way in, so the label says exactly that and no more"), so the two
posts contradict each other on the product's central claim.

*Fix:* "imported numbers carry a label saying how they arrived — from a
statement file or from a broker connection — rather than from the keyboard."

**C2 — Paid features described without their plan, in posts that say "free".**
Two places:

- `what-to-record-in-every-journal-entry.md`, ~line 33: "TradingSocial reads an
  MT5 statement, or syncs a connected MT5 account, and lands closed trades in
  the journal…" — with no plan named, in a post that closes (~line 80) with
  "the journal is free to start".
- `what-an-mt5-statement-contains.md`, ~lines 58–60: both statement import and
  broker connection described with no plan named.

The gates: `mt5_import: 'trader'`, `mt5_autosync: 'pro'`
(`app/src/lib/entitlements.ts`). `for/mt5.html` says it plainly — "Statement
import is available on Trader; automatic sync is a Pro-plan feature." A reader
who signs up Free on the strength of either paragraph cannot do the thing the
paragraph describes.

*Fix:* name the plans, as the weekly-review draft correctly does ("on the Trader
plan and above", "personalised insights (Pro)"). Plan names are Free, Trader,
Pro Trader (`pricing.html`, lines 1740–1742) — note the third is **Pro Trader**,
not "Pro", although the product pages do use "Pro" as shorthand.

**C3 — Two sentences that read as trading instructions.**
`the-twenty-minute-weekly-review.md`, ~line 56: "'No entries in the first five
minutes of the session' is a rule. So is 'no second trade on an instrument that
has already stopped me out today'." They are offered as examples of
*well-formed* rules rather than recommended ones, and the surrounding sentences
make that clear. But this is the only draft of the six with no explicit
disclaiming line — the other five each carry one ("None of which says which
ratio to trade"; "None of this tells you how to trade — only which rule you are
under"; "TradingSocial does not read or enforce any firm's rule set"). The site
footer disclaims globally, and `index.html` hides the Learning Hub with the
comment "we are not financial advisors".

*Fix:* one sentence making the examples explicitly arbitrary — "The content of
the rule is yours; the test is only whether a row can be marked against it."

**C4 — Editorial brackets in reader-facing body copy.**
`prop-firm-drawdown-rules-explained.md` line 42 and
`what-an-mt5-statement-contains.md` line 22 both carry `[UNVERIFIED: …]` blocks
in the article body, not in Sources. These read as internal notes and cannot
publish under a byline.

The prop-firm one should be *kept as content, reworded*: I could not confirm it
either. The balance-based model is described on aggregator pages and on City
Traders Imperium's own site — "A Balance-Based drawdown is calculated using your
account's closed trade results only. It ignores any floating (unrealised)
profits or losses" — but that same page then says "Floating losses always count
… your account will be stopped out even with trades still open", which
contradicts it. So the draft's decision to name no firm is correct and worth
saying in the reader's voice: "Some firms are described elsewhere as measuring
daily drawdown on closed balance alone. I could not find that stated
unambiguously on any firm's own rules page, so no firm is named for it here."

The MT5 one is **resolvable and should be resolved**: MetaQuotes' own help says
"select 'Report' in the context menu of the History tab". "Save as Detailed
Report" is the MT4 label, not an MT5 variant. `fxjournalstats.com` does note
that "the menu text may vary slightly" by broker and build, which supports a
one-clause hedge rather than a three-way list.

**C5 — Disowning the product's own UI word.**
`what-an-mt5-statement-contains.md`, ~line 68: "the honest answer is a label,
not a badge." The product ships a "verified badge" (`for/mt5.html`, three
separate places). Saying in a blog post that a badge would be dishonest, while
the product displays one, is an own-goal — and it is not what the draft means,
since it goes on to describe exactly the three-way labelling the product does.

*Fix:* "the honest answer is how it arrived, not a verdict on the trader."

### Close paraphrase

**P1 — A published post's field list, re-ordered.**
`what-to-record-in-every-journal-entry.md`, ~lines 37–40 against
`/blog/why-a-trading-journal` (`data/posts.json`), section "What a useful entry
actually contains":

| Published post | Draft |
|---|---|
| "**The setup** — what pattern or thesis made this a trade, in one line." | "**The thesis.** Why this trade, in one sentence, written before the outcome." |
| "**Risk** — where your stop was and what fraction of your account it risked." | "**The planned risk.** Where the initial stop was and what that distance is worth" |
| "**Emotion** — one word for your state: calm, rushed, bored, revenge." | "**Emotional state.** One word at entry: calm, rushed, bored, certain, behind." |
| "**Mistake tags** — if you broke a rule, name it." | "**Rule followed or broken.** A yes or no, plus a named tag when it is a no." |

Same four fields, same order, same construction, and three of the four emotion
words identical. This is the site's own earlier post, so it is not a third-party
copyright problem — it is a duplication and cannibalisation problem (see E4).

**P2 — A recycled sentence.** Draft ~line 58: "An entry gets abandoned when it
feels like homework." Published: "Journaling fails when it feels like homework."

**P3 — A recycled rhetorical beat.**
`the-twenty-minute-weekly-review.md`, section "Why one change and not ten"
(~line 65), against the published post's "**Pick one lesson.** Not ten. One."
The draft's argument (attributability of a single change) is genuinely new; the
framing is not, and the draft does not acknowledge it.

**P4 — Bulk transcription of a source's field names.**
`what-an-mt5-statement-contains.md`, ~lines 18 and 30 reproduce roughly forty
MetaQuotes field and statistic names verbatim in two runs, one of which is a
127-word paragraph. Field names are factual labels and the copyright risk is
low, but reproducing a documentation page's lists wholesale is not the same as
explaining the file, and it is the least readable part of an otherwise good
post.

*Fix:* keep the structural point (header, three tables, Summary, Details), name
four or five representative statistics, and link out for the rest.

**P5 — An unattributed taxonomy.** `prop-firm-drawdown-rules-explained.md`
organises itself as static / end-of-day trailing / intraday trailing /
balance-versus-equity. The5ers' page — which the draft names in Sources and
describes as explaining "the four model categories well" — uses Static /
Trailing / Balance-Based / Equity-Based plus an intraday-versus-end-of-day
distinction. The draft's contribution is real (it attaches each category to a
named firm's published wording, which The5ers' page does not do), but the
framework is borrowed and the borrowing is disclosed only in a footnote.

*Fix:* one clause in the body crediting the categories, or restructure around
the three questions the intro already poses ("what the limit is measured
against, what counts as the measurement, and when it moves"), which is the
draft's own and is better.

### Style

House style is otherwise clean across all six: no exclamation marks anywhere,
`##` headings only (no `###`, no `#`), sentence-case headings, British/
Australian spelling in the authors' own prose with source spellings correctly
preserved inside quotations ("realized"/"unrealized" in the Topstep and Apex
quotes, "realised"/"unrealised" elsewhere), no marketing verbs — a scan for
unlock / supercharge / powerful / seamless / effortless / leverage / robust /
empower returns nothing.

**S1 — Paragraph length drifts above house norm.** Average paragraph lengths:
expectancy 36 words, journal entry 46, weekly review 48, backtest 52, MT5 54,
prop firm 58. The two heaviest run to 127 words (`what-an-mt5-statement-contains.md`
~line 18) and 104 words (`prop-firm-drawdown-rules-explained.md`). Published
posts sit noticeably shorter. Split the worst half-dozen.

**S2 — A repeated parenthetical.** `prop-firm-drawdown-rules-explained.md` ends
six separate sentences with "(ftmo.com, as published on 22 September 2026)" or
its equivalent. The discipline is right; the repetition reads like a compliance
artefact. One dated line under the heading — "Rules as published on the firms'
own pages, checked 22 September 2026" — carries the same weight once.

**S3 — Date durability.** Every "as published on 22 September 2026" is accurate
today, and prop-firm rules change often. If publication slips, the dates must be
re-checked, not carried forward. That is a process note, not a defect.

### SEO mechanics

All six pass the mechanical checks. Frontmatter is present and parses; all six
slugs are unique and absent from `data/posts.json` and `sitemap.xml`; every
category is from the permitted set; `readtime` matches the word count at 200 wpm
in every case.

| Draft | Title (chars) | Excerpt (chars) | Category | Words | 200 wpm | Stated | Internal links |
|---|---|---|---|---|---|---|---|
| expectancy | 35 | 144 | Analytics | 1,382 | 6.9 | 7 min | 8 |
| journal entry | 43 | 150 | Journaling | 1,381 | 6.9 | 7 min | 7 |
| prop firm | 35 | 143 | Risk & Sizing | 1,428 | 7.1 | 7 min | 3 |
| weekly review | 35 | 139 | Journaling | 1,241 | 6.2 | 6 min | 4 |
| MT5 statement | 39 | 141 | Journaling | 1,303 | 6.5 | 7 min | 4 |
| backtest | 37 | 122 | Strategy | 1,402 | 7.0 | 7 min | 5 |

Word counts exclude the Sources block. Every internal link resolves: all of
`/tools/expectancy-calculator`, `/tools/position-size-calculator`, `/for/journal`,
`/for/mt5`, `/for/prop-firm` and the five `/blog/<slug>` targets
(`win-rate-is-lying-to-you`, `backtesting-vs-forward-testing`,
`position-sizing-101`, `how-to-tag-your-trading-mistakes`, `why-a-trading-journal`,
`from-demo-to-live`) are present in both `sitemap.xml` and `data/posts.json`.

**E1 — Cannibalisation: expectancy draft against a published post.**
`how-to-calculate-trading-expectancy` and the published
`/blog/win-rate-is-lying-to-you` share a category (Analytics) and an almost
identical tag set:

- published: `['win rate', 'R-multiple', 'expectancy', 'risk-reward', 'analytics']`
- draft: `[expectancy, R-multiple, win rate, risk-reward, analytics]`

Same five tags, re-ordered. The published post carries the full R-multiple and
expectancy explanation, including the formula and two worked examples. The draft
does link to it, and its genuinely distinct material (the break-even win rate
derivation, profit factor's algebraic link, the outlier sensitivity
demonstration) is real — but two posts with the same five tags in the same
category will compete.

*Fix before publishing:* differentiate the tag sets, and consider trimming the
published post's expectancy section to a link. Note also that the published post
contains "most profitable retail strategies produce expectancy between 0.2R and
0.6R per trade. Anything above 0.5R sustained over 100+ trades is a genuinely
strong edge" — an unsourced benchmark that directly contradicts the calculator
page's stated position ("We do not publish a target"). The new draft is right
and the published post is wrong; that is worth fixing in the same pass, though
it is outside this review's scope.

**E2 — Contradiction: weekly-review draft against a published post.**
`/blog/why-a-trading-journal` has a section headed "The ten-minute daily review"
that says "Keep the daily loop tight enough that you'll actually do it after
every session" and "Daily review keeps you honest; weekly review is where the
strategy decisions live."

`the-twenty-minute-weekly-review.md` opens (~line 10) with "a single day is the
worst possible unit to draw a conclusion from" and argues at ~line 18 that "a
daily review is a three-trade sample". The draft never mentions the published
post and does not link to it.

Two posts under Nathan's name giving opposite advice on the same page of the
same blog is exactly the failure mode the site's positioning cannot afford.

*Fix:* reconcile explicitly. The positions are compatible — log daily, *judge*
weekly — and saying so in the draft ("the daily loop is for capture, not for
conclusions; see [why a trading journal]") turns a contradiction into a
sharpening. That reconciliation needs to be written before either publishes.

**E3 — Cannibalisation: journal-entry draft against a published post and a
money page.** `what-to-record-in-every-journal-entry` targets the query already
answered by `/blog/why-a-trading-journal`'s "What a useful entry actually
contains" section *and* by `for/journal.html`'s FAQ, which carries the
schema-marked question "What should I record in a trading journal?" with a
complete answer. Three URLs competing for one query, one of them a conversion
page.

*Fix:* decide which URL should own the query before publishing. If it is the new
post, the published post's section should be shortened to a link and the FAQ
answer should point at it.

**E4 — Overlapping explanations across the set.** The three writers could not
see each other's work and it shows:

- *R defined* in three drafts: expectancy (~line 76, "R is the distance from
  your entry to your initial stop, decided before the trade"), journal entry
  (~line 38, "Where the initial stop was and what that distance is worth — your
  R"), and assumed without definition in the weekly review (~line 46). Plus the
  published post. Definitions agree — no contradiction — but the fourth
  explanation adds nothing.
- *Expectancy explained* in the expectancy draft (in full) and the weekly review
  (~lines 46–50). Consistent.
- *The same MetaQuotes quotation* — "profit (loss) - commission - fees - swap" —
  appears in three of the six drafts (expectancy ~line 26, journal entry ~line
  31, MT5 ~line 32) and is cited to the same URL in all three.

*Fix:* nominate one canonical location for each (R → published win-rate post;
the deal-result quotation → MT5 post) and have the others link.

**E5 — Tag inconsistency across the set.** `analytics` is used as a tag on three
drafts for three different things; `review` appears on two but `process` on
four; `validation` on two of the three posts about provenance. Worth one pass to
normalise against the ten published posts before any of these ship.

**E6 — Category concentration.** Three of six are Journaling. The MT5 statement
post is about provenance and file structure and would sit more naturally in
Analytics, which would also balance the set.

**E7 — Head-on slug collision.** `prop-firm-drawdown-rules-explained` is the
exact leading segment of the competitor URL the draft cites for coverage
(`the5ers.com/prop-firm-drawdown-rules-explained-daily-max-and-trailing-limits-in-2026/`).
Not a defect — the draft is better sourced than that page, which names no firm —
but worth knowing that the target query is contested by a domain with far more
authority.

**E8 — No cross-draft links.** No draft links to any other draft. See
"Publication order and dependencies" below.

---

## Every source checked

Legend: **Loaded** — did the URL resolve to the claimed document on 22 Sep 2026.
**Supports** — does it support the sentence citing it. **Verbatim** — are the
quoted words in the draft identical to the source.

### `prop-firm-drawdown-rules-explained.md`

| URL | Loaded | Supports | Verbatim |
|---|---|---|---|
| `ftmo.com/en/trading-objectives/` | yes | yes | yes — "end-of-day trailing", "static", "below which your account **equity** … cannot drop", "Balance + Open Positions P/L ± Swaps – Commissions", "the highest **account balance** achieved at 00:00 CE(S)T of any preceding trading day", "the **account balance** recorded at 00:00 CE(S)T of the current day" all match. 10% / 10% / 5% / 3% all match |
| `ftmo.com/en/blog/watch-out-for-open-losses/` | yes | yes | yes — "If your floating (open) losses drag your real-time equity below your daily limit, the rule is violated, regardless of whether that trade later bounces back to a profit" is exact |
| `help.topstep.com/…/8284204-what-is-the-maximum-loss-limit` | yes | yes | yes — "The MLL is a trailing limit. It rises as your end-of-day balance grows, but never moves down"; "Once it reaches your starting balance, it locks permanently"; "The MLL updates at the end of each trading day but is monitored in real time throughout the session"; "Both realized and unrealized P&L count toward it". $2,000 / $3,000 / $4,500 confirmed |
| `help.topstep.com/…/8284207-what-is-the-daily-loss-limit…` | yes | yes | yes — "is optional in the Trading Combine® and Express Funded Account® (XFA)"; "Triggering it is not a rule violation — it's a forced break for the rest of that session" |
| `help.topstep.com/…/8284208-consistency-at-topstep` | yes | yes | yes — "Your single best day of profit must stay at or below 55% of your Profit Target"; "Your Consistency % must be 40% or below to be Payout eligible". Profit-target-increases-rather-than-fails confirmed |
| `apextraderfunding.com/…/intraday-trailing-drawdown-explained/` | yes (403 to automated fetch; read in browser) | yes | yes — "It maintains a fixed dollar distance behind the peak based on account size and never decreases, even if the account balance later declines"; "The threshold is enforced in real time, including unrealized PnL"; "Once the Intraday Threshold reaches Starting Balance + $100, it stops increasing"; "trails indefinitely with the peak account balance". $1,000 / $2,000 / $3,000 / $4,000 for 25K/50K/100K/150K confirmed |
| `apextraderfunding.com/…/50-consistency-requirement/` | yes (browser) | yes | yes — "no single trading day accounts for more than 50% of your total accumulated profit at the time of a payout request"; "the payout request option will not be available"; "The account remains active" |
| `the5ers.com/high-stakes/` | yes | yes | yes — "the closed positions made a positive profit of at least 0.5% of the initial balance"; 5% daily, 10% max loss, 3 profitable days confirmed. **Does not state** whether the 10% is static or trailing (see U4) |
| `the5ers.com/prop-firm-drawdown-rules-explained-…-2026/` | yes | yes | n/a — confirmed: names no specific firm, cites no firm's published rules, describes four model categories |

### `how-to-calculate-trading-expectancy.md`

| URL | Loaded | Supports | Verbatim |
|---|---|---|---|
| `metatrader5.com/…/algotrading/testing_report` | yes | yes | yes — "ratio of the gross profit to the gross loss. A value of one means that these parameters are equal" |
| `metatrader5.com/…/trading_advanced/history_report` | yes | yes | yes — "profit (loss) - commission - fees - swap"; "a statistically calculated value showing the average return of one deal"; "the expected return of the next trade" |
| `itl.nist.gov/div898/handbook/eda/section3/eda352.htm` | yes | yes | yes — "As N increases, the interval gets narrower from the √N term", on the page "Confidence Limits for the Mean" |
| `vantharpinstitute.com/tharp-think-trading-concepts/` | **yes — it loads now** | **partly** — supports R as initial risk and expectancy as mean R-multiple; **does not** support "origin of the R-multiple vocabulary" | n/a |
| `vantharp.com/…/A_Short_Lesson_on_R_and_R-multiple.pdf` | not attempted — superseded, the live institute page covers the same ground | — | — |
| `tradingsocial.io/tools/expectancy-calculator` | read from repo source | yes on arithmetic; **no** on the currency formatting claim (F4) | n/a |
| `tradezella.com/blog/trading-expectancy` | yes | yes | n/a — gives formula and example, does **not** derive break-even win rate; does cover profit factor and sample size, which the draft does not claim it omits |
| `pineconnector.com/…/what-is-expectancy-ratio` | yes | yes | n/a — gives formula and example; covers neither break-even win rate, nor profit factor, nor sample size, exactly as the draft states |

**Calculator arithmetic, recomputed from `tools/expectancy-calculator.html`
lines 2075–2085:**

| Claim in draft | Script output | Match |
|---|---|---|
| Expectancy $67.00 from 42.5 / 412 / 188 | 0.425 × 412 − 0.575 × 188 = 175.10 − 108.10 = 67.00 | ✓ |
| Reward-to-risk 2.19 : 1 | 412 ÷ 188 = 2.19148… → `toFixed(2)` = 2.19 | ✓ |
| Break-even 31.3% | 100 ÷ (1 + 2.19148…) = 31.3333… → `toFixed(1)` = 31.3 | ✓ |
| Profit factor 1.62 | 175.10 ÷ 108.10 = 1.61980… → 1.62 | ✓ |
| $5,360.00 over 80 trades | 67.00 × 80 = 5,360 | ✓ (symbol locale-dependent — F4) |
| Long-way check: 34 × 412 = 14,008; 46 × 188 = 8,648; net 5,360 ÷ 80 = 67.00 | — | ✓ |
| Second example: 72% / $80 / $260 → RR 0.31 : 1, break-even 76.5%, expectancy −$15.20, PF 0.79 | 80÷260 = 0.3077 → 0.31; 100÷1.3077 = 76.470 → 76.5; 57.6 − 72.8 = −15.20; 57.6 ÷ 72.8 = 0.7912 → 0.79 | ✓ all four |
| Outlier example: winners 33, gross profit $11,008, average win $333.58, losers 47, gross loss $8,836, expectancy $27.15, PF 1.25 | 11,008 ÷ 33 = 333.5757 → 333.58; 8,648 + 188 = 8,836 (= 47 × 188 exactly); (11,008 − 8,836) ÷ 80 = 27.15; 11,008 ÷ 8,836 = 1.2458 → 1.25 | ✓ all six |
| "moved the headline figure by nearly 60%" | (67.00 − 27.15) ÷ 67.00 = 59.5% | ✓ |
| "$3,000 — more than a fifth of the gross profit" | 3,000 ÷ 14,008 = 21.4% | ✓ |
| "Profit factor = 1 + expectancy ÷ (loss rate × average loss)" | 1 + (pW − qL)/(qL) = pW/qL = PF | ✓ algebraically exact |
| "the calculator prints a warning … on any run under a hundred trades" | line 2099: fires only when a trade count is entered and is < 100; the field is optional | ✓ with a caveat worth one clause |

### `what-an-mt5-statement-contains.md`

| URL | Loaded | Supports | Verbatim |
|---|---|---|---|
| `metatrader5.com/…/trading_advanced/history_report` | yes | yes for structure and Details block; **no** for "saves as HTML or XLSX" (F7) | statistic names match exactly; `ReportHistory.htm` / `/Templates` confirmed |
| `metatrader5.com/…/trading/report` | yes | yes | tabs (Summary, Profit/Loss, Long/Short, Symbols, Risks), metrics (Sharpe, Profit Factor, Recovery Factor, Max. Drawdown, Max. Deposit Load, MFE, MAE), "Report \ Overview" and the View menu all confirmed |
| `metatrader5.com/en/releasenotes/terminal/2342` | yes | yes | "Added export of trading reports to HTML and PDF files… New export commands are available in the File menu and in the report menu" — build 4150 confirmed |
| `metatrader5.com/…/trading/performing_deals` | yes | yes | Deals columns match the draft's list exactly; Positions view fields match; "Direction — direction of the deal relative to the current position of a particular symbol: 'in', 'out' or 'in/out'". Orders column list not individually confirmed (U5) |
| `mql5.com/en/articles/211` | yes | yes | "a single order can generate a set of deals"; "The deals are always stored in the trading history and cannot be modified". Does **not** define in/out/inout (U5) |
| `metatrader5.com/…/trading/general_concept` | yes | yes | "you can have only one common position for a symbol at the same time" (netting); "you can have multiple open positions of one and the same symbol, including opposite positions" (hedging) |
| `mql5.com/en/book/common/timing/timing_local_server` | yes | **no — contradicts the citing sentence** (F2) | — |
| `metatrader5.com/en/mobile-trading/android/help/history` | yes | yes | Deal, Order, Swap, Commission, Fee all present |
| `mytradingjournal.io/guides/export-import-mt4-mt5-history` | yes | yes | n/a — click path only, as described |
| `fxjournalstats.com/guides/how-to-export-metatrader-5-trade-history-as-html…` | yes | yes | n/a — click path only; notes "the menu text may vary slightly" |

### `what-to-record-in-every-journal-entry.md`

| URL | Loaded | Supports | Verbatim |
|---|---|---|---|
| `psycnet.apa.org/record/1976-00159-001` (Fischhoff 1975) | record page is JavaScript-only and would not render; **claim verified against the published abstract elsewhere** | yes | yes — "largely unaware" is the abstract's own wording. Citation correct: *JEP: HPP*, 1(3), 288–299, DOI 10.1037/0096-1523.1.3.288. Note the paper's own title uses "≠", not "is not equal to". A freely readable copy exists at `web.mit.edu/curhan/www/docs/Articles/15341_Readings/Behavioral_Decision_Theory/Fischhoff_1975_Hindsight_is_not_equal_to_foresight.pdf` and would serve the reader better |
| `journals.sagepub.com/doi/abs/10.1177/1745691612454303` (Roese & Vohs 2012) | publisher blocks automated access; **claim verified against the abstract elsewhere** | yes | citation correct (*Perspectives on Psychological Science*, 7(5), 411–426). The paper describes three levels — memory distortion, inevitability, foreseeability; the draft names the first two and drops foreseeability. Accurate as far as it goes |
| `ftmo.com/en/trading-objectives/` | yes | yes | yes — equity floor, 00:00 CE(S)T recalculation from the balance recorded at that time, "Balance + Open Positions P/L ± Swaps – Commissions" |
| `metatrader5.com/…/trading_advanced/history_report` | yes | yes | yes |
| `tradezella.com/blog/your-free-trading-journal-template` | yes | partly | the page says "If you take 5 trades a day, that's roughly 20 minutes of data entry. At 10 trades, you're spending 40 minutes" and "At 20+ trades per day … you're looking at over an hour". The draft's "20–60 minutes a day" understates the top of the range |
| `howtotrade.com/blog/trading-journal-template/` | yes | **no** — emotions are a dedicated section, not a notes field (F5) | — |

### `the-twenty-minute-weekly-review.md`

| URL | Loaded | Supports | Verbatim |
|---|---|---|---|
| `sas.upenn.edu/~baron/papers/outcomebias.pdf` | **yes — I read the PDF** (the draft's `[UNVERIFIED]` flag can be removed) | yes | the abstract: "In 5 studies, undergraduate subjects were given descriptions and outcomes of decisions made by others under conditions of uncertainty… Subjects rated the thinking as better, rated the decision maker as more competent, or indicated greater willingness to yield the decision when the outcome was favorable than when it was unfavorable." The draft's description is accurate. **Add the citation** — *Journal of Personality and Social Psychology*, 1988, 54(4), 569–579 — which the Sources block omits |
| `rips-irsp.com/articles/10.5334/irsp.751` | yes | yes | "After considering the other three criteria, 692 participants remained"; effect larger than the original (physician condition: original *d* = 0.53, replication *d* = 1.1) |
| `academic.oup.com/qje/article-abstract/112/2/647/1870948` | publisher blocks automated access; **verified via the paper's own text and indexes** | yes | citation correct — Thaler, Tversky, Kahneman & Schwartz, *QJE* 112(2), 647–661 (1997). Finding direction confirmed: less frequent feedback → more risk taken |
| `tradezella.com/blog/weekly-trade-review-process` | yes | **no — wrong on all three counts** (F3) | — |
| `traderssecondbrain.com/guides/weekly-trading-review-guide` | yes | yes | "Treat 30 minutes as a timebox"; "promote only one supported observation into a reversible next step"; "Do not spend the decision block only on the three biggest winners and losers." Confirmed that it does **not** make the sample-size or outcome-bias argument |
| `tradingsocial.io/for/journal` | read from repo | yes | "Every week (Trader plan and above)… P&L, win rate, drawdown, your best setup and your costliest mistake"; "Personalised patterns (Pro) always state the sample size behind them". Plan attributions in the draft are correct |

### `why-your-backtest-lies-about-drawdown.md`

| URL | Loaded | Supports | Verbatim |
|---|---|---|---|
| `cambridge.org/…/on-the-maximum-drawdown-of-a-brownian-motion/…` | yes | yes | "can be logarithmic (for positive drift), square root (for zero drift) or linear (for negative drift)" is exact. Citation correct: *J. Appl. Prob.* 41(1), 147–161, 2004, four authors as named |
| `eurekalert.org/news-releases/817304` | yes | yes | "for a model based on 5 years of data, one can be misled by looking at even as few as 45 sample configurations". Paper, authors and issue confirmed |
| `ams.org/notices/201405/rnoti-p458.pdf` | **no — the host is behind an automated bot check I will not work around.** The draft's `[UNVERIFIED]` flag stands | the "number of configurations is not disclosed" argument is independently confirmed from the paper's abstract: "most financial analysts and academics rarely report the number of configurations tried for a given backtest" | — |
| `nber.org/papers/w20592` | yes | yes | "needs to clear a much higher hurdle, with a t-ratio greater than 3.0" and "most claimed research findings in financial economics are likely false" are both exact |
| `nber.org/papers/w20721` | yes | partly — first quotation exact, turnover claim drifts (F6) | "In all cases transaction costs reduce the strategies' profitability and its associated statistical significance" is exact |
| `academic.oup.com/rfs/article-abstract/5/4/553/1590264` | yes (abstract truncated on the publisher page; verified from indexes) | yes | Brown, Goetzmann, Ibbotson & Ross, *RFS* 5(4), 553–580, 1992. The finding — a survivorship-truncated sample "gives rise to the appearance of predictability" — supports the draft. Note the paper concerns mutual-fund managers excluded for performance, not delisted securities; the draft's "that is the clean case: … delisted stocks" reads as if the paper were about delistings |
| `analystprep.com/study-notes/cfa-level-2/problems-in-backtesting/` | yes | yes for the three-way split | reporting lag, data revisions, index additions all present. It is study notes, not the curriculum (U3) |
| `swissinfo.ch/eng/fxcm-faces-losses-as-swiss-shock-leaves-alpari-uk-insolvent/41219974` | yes | yes | article dated 16 January 2015. "Clients owe $225 million on their accounts after the Swiss National Bank's decision to abandon the franc's cap against the euro"; Alpari (UK) "entered into insolvency". The draft's "negative balances" is a fair gloss |
| `pineconnector.com/…/backtesting-vs-live-trading-…` | yes | **no — contains no such percentage** (F1) | — |
| `luxalgo.com/blog/backtesting-limitations-slippage-and-liquidity-explained/` | yes | **no — contains no such percentage, and argues against exactly that practice** (F1) | — |

---

## Publication order and dependencies

**No draft links to any other draft.** All twenty-nine internal links point at
pages and posts that already exist. So there is no hard ordering constraint
between the six, and any one of them can ship alone.

The dependencies that do exist are on *published* content, and they run the
other way:

1. **`the-twenty-minute-weekly-review` is blocked on a decision about
   `/blog/why-a-trading-journal`.** The published post recommends a daily
   review; this draft argues against one. Whichever ships first, the two must be
   reconciled in the same change — either by editing the published post's
   framing (daily for capture, weekly for judgement) or by writing that
   reconciliation into the draft. This is the only true blocker in the set.

2. **`what-to-record-in-every-journal-entry` is blocked on the same published
   post**, for a different reason: it duplicates that post's "What a useful
   entry actually contains" section, and both compete with
   `for/journal.html`'s FAQ. Decide the canonical URL first.

3. **`how-to-calculate-trading-expectancy` should ship after a tag and scope
   decision on `/blog/win-rate-is-lying-to-you`**, which shares its category and
   all five of its tags. It should also carry the fix to that post's unsourced
   0.2R–0.6R benchmark, which the new post implicitly contradicts.

4. **`prop-firm-drawdown-rules-explained` should ship first, or soon.** Its
   entire value is that its quotations are dated and current. Every week it sits
   in the folder is a week the "as published on 22 September 2026" line ages,
   and prop-firm rules change more often than the other five drafts' sources.
   It is also the draft closest to publishable.

5. **`what-an-mt5-statement-contains` and `why-your-backtest-lies-about-drawdown`
   are independent** of everything else, subject to their own fixes.

Suggested order once fixed: prop firm → MT5 statement → expectancy → backtest →
(journal entry and weekly review together, after the `why-a-trading-journal`
decision).

**Cross-links worth adding before publication** — all to already-live pages, so
none creates a dependency: the MT5 draft should link to the expectancy post once
both are live (it currently sends R-multiple readers to the published win-rate
post, which is fine but second-best); the weekly review should link to the
expectancy post rather than only the calculator; and both journal drafts should
link to `what-an-mt5-statement-contains` for the provenance argument instead of
restating it.

---

## What I could not verify

Stated as unresolved, not as confirmed or refuted either way.

1. **The AMS PDF itself** (`ams.org/notices/201405/rnoti-p458.pdf`). The host
   serves an automated bot check, and I did not attempt to get past it. Mirrors
   at `scholarworks.wmich.edu` and `davidhbailey.com` returned 403 and 404. The
   "45 configurations over five years" figure is corroborated by the publisher's
   own press release, and the "number of configurations is never disclosed"
   argument is corroborated by the paper's abstract — so both claims stand on
   secondary evidence from the publisher. The draft's `[UNVERIFIED]` flag is
   honest and should be reworded for publication rather than deleted: cite the
   press release as the source actually read.

2. **Whether The5ers' 10% maximum loss is static or trailing, and whether it
   reads balance or equity.** Not stated on the High Stakes page I checked. This
   is what makes the comparison row (U4) incomplete.

3. **Whether any prop firm states on its own rules page that daily drawdown is
   measured on closed balance only.** I could not confirm it, for the same
   reason the writer could not. City Traders Imperium's own page comes closest —
   "A Balance-Based drawdown is calculated using your account's closed trade
   results only. It ignores any floating (unrealised) profits or losses" — but
   the same page then says "Floating losses always count … your account will be
   stopped out even with trades still open". Naming no firm was the right call.

4. **Whether the MT5 history report can be saved as XLSX.** The cited page
   mentions only "Report" in the context menu and the HTML template. I did not
   find a MetaQuotes page stating the format list, and I have no MT5 terminal to
   check against.

5. **The Orders column list** in `what-an-mt5-statement-contains.md` (~line 30).
   The Deals and Positions lists are confirmed word for word on the cited page;
   the Orders list is not, though nothing in it looks wrong.

6. **Whether the Apex worked example in the draft (~line 32) parallels Apex's
   own worked example.** Apex's page has a section headed "Real-Time Intraday
   Trailing Example" whose contents did not render as text for me. The draft's
   numbers are arithmetically correct on Apex's published trailing distances
   regardless; I simply cannot say whether the illustration is independent of
   theirs.

7. **`vantharp.com/wp-content/uploads/2018/06/A_Short_Lesson_on_R_and_R-multiple.pdf`.**
   Not attempted — the live institute page supersedes it for everything the draft
   needs, and the one claim the draft rests on it (origin of the term) is not
   supported by either.

8. **Whether "R multiple" originates with Van Tharp.** Widely attributed to him;
   not claimed by the Van Tharp Institute's own page. Treat as unestablished.

9. **Two publisher paywalls** — `journals.sagepub.com` (Roese & Vohs) and
   `academic.oup.com` (Thaler et al., and the Brown et al. abstract) — refuse
   automated access. The citations, findings and page ranges were confirmed from
   the papers' abstracts and indexes elsewhere, but I did not read either paper's
   full text.
