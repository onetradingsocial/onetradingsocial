# Review — second pass

Checked 22 September 2026, against the edits made after `REVIEW.md`. Same
constraints: nothing edited, nothing committed, nothing published.

I did not re-derive the whole set. I checked each of the 21 claimed fixes,
re-ran the mechanical audit in full, re-opened the sources that any *new or
altered* sentence depends on, and scanned all six files for editing seams.

**Headline: 18 of 21 fixes landed cleanly. Three did not, and one of those is a
repeat of the most serious finding in the first review — the replacement
sentence for F1 is still false, on two counts, about the same two named
companies.**

---

## Verdicts

| Draft | Pass 1 | Pass 2 |
|---|---|---|
| `prop-firm-drawdown-rules-explained.md` | publish after fixes | **publish** |
| `how-to-calculate-trading-expectancy.md` | publish after fixes | **publish after fixes** (one sentence) |
| `what-an-mt5-statement-contains.md` | publish after fixes | **publish after fixes** (one source line) |
| `what-to-record-in-every-journal-entry.md` | needs rework | **publish after fixes** |
| `the-twenty-minute-weekly-review.md` | needs rework | **publish after fixes** |
| `why-your-backtest-lies-about-drawdown.md` | needs rework | **needs rework** |

---

## The three fixes that did not land

### 1. F1's replacement is still false — `why-your-backtest-lies-about-drawdown.md`, line 92

The fabricated percentages are gone, which was the important half. But the
sentence that replaced them makes two fresh claims, and I checked both pages
again:

> "both cover slippage, commission and psychology; **neither treats drawdown as
> an extreme-order statistic or addresses multiple testing**, which is where
> this post concentrates."

| Claim | LuxAlgo page | PineConnector page |
|---|---|---|
| covers slippage | yes | yes |
| covers commission | yes | yes |
| covers psychology | **no** — the body is fill models, liquidity and cost sensitivity; the only psychology on the page is a "READ NEXT" sidebar link to a different article | yes — "Emotions: Fear, greed, and impatience influence how traders stick to their strategies" |
| treats drawdown as an extreme-order statistic | no | no |
| **addresses multiple testing** | **yes** | **yes** |

LuxAlgo, under "Validate Beyond the Original Sample": **"Track how many
parameter combinations you tried: selecting the best historical result can
overfit both the trading rules and the cost assumptions."**

PineConnector: **"Perhaps the biggest pitfall, overfitting occurs when traders
tweak parameters until results look perfect on past data. These strategies often
collapse in live markets because they are too tailored to history."**

So the post tells the reader that neither page addresses the count of
configurations tried — while one of them instructs the reader, in those words,
to track the count of parameter combinations tried. That is the same failure
mode as F1: an accusation in the differentiation claim that the accused page
disproves in its own text. It is milder than fabricated quotation marks, but it
is the second time this sentence has gone out wrong, and it is the sentence a
competitor would read first.

**The only clause that survives checking for both pages is "neither treats
drawdown as an extreme-order statistic".** That is a real and sufficient
difference — it is the post's actual thesis.

*Fix:* cut the sentence to "both cover slippage, commission and execution
realism; neither treats drawdown as an extreme-order statistic, which is where
this post concentrates." Drop "psychology" and drop "multiple testing"
entirely. If a multiple-testing contrast is still wanted, the honest version is
that both name overfitting while neither connects it to the drawdown figure
specifically — but it is simpler to say nothing.

### 2. The Baron & Hershey flag is still there, and it is now untrue — `the-twenty-minute-weekly-review.md`, line 81

> "[UNVERIFIED: the file is live but served as a download, so I could not read
> it directly. The description of its method and finding in this post comes from
> the 2023 replication below, which restates both.]"

**I read that PDF in the first pass.** It downloads as a valid 11-page PDF
(HTTP 200, 1,158,204 bytes) and extracts to text cleanly. `REVIEW.md` quotes its
abstract in full. So the bracket now asserts something that is not the case,
inside a sources block, in a post about not stating things you have not checked.

The abstract, verbatim, supports the draft's line 22 exactly: "In 5 studies,
undergraduate subjects were given descriptions and outcomes of decisions made by
others under conditions of uncertainty… Subjects rated the thinking as better,
rated the decision maker as more competent, or indicated greater willingness to
yield the decision when the outcome was favorable than when it was
unfavorable."

*Fix:* delete the bracket and add the citation the source line still lacks —
*Journal of Personality and Social Psychology*, 1988, 54(4), 569–579. One
caveat worth keeping in the body if you want it: those were undergraduates
rating other people's decisions with the probabilities disclosed, which is a
cleaner setup than a trader grading themselves, and if anything strengthens the
point.

### 3. F2's correction did not reach the Sources block — `what-an-mt5-statement-contains.md`, line 80

The body is now right. Line 42 reads "Inside the terminal a program can recover
the offset — MQL5's own documentation derives it as the difference in hours
between local and server time — but an offset in hours is not a named zone with
daylight-saving rules attached, and a saved file has neither." That matches the
cited page precisely, including its own phrasing ("the difference between local
and server time in hours (that is, the time zone difference)"). Good fix.

But line 80 still says the page is the source for:

> "server time versus local time in MetaTrader, **and the absence of any way to
> read the broker's time zone**."

That is the exact claim F2 removed from the body, left intact one screen lower.
Anyone who checks the citation lands on a page that contradicts it.

*Fix:* "— server time versus local time in MetaTrader, and how the terminal
derives the offset in hours rather than a named zone."

---

## Residual issues, ranked

**R1 — The AMS `[UNVERIFIED]` bracket is still in the backtest draft's Sources
(line 86), in tooling language.** "the PDF would not render as text through the
fetch tool" is a reviewer's note, not reader copy, and `PUBLISHING.md` says the
Sources blocks may ship. It also credits "the SSRN abstract" as read; SSRN
refused automated access to me, and I confirmed the abstract from indexed copies
instead. I still could not read the AMS PDF — the host runs an automated bot
check I will not work around — so the substance of the flag stands.
*Fix:* reader-facing wording, e.g. "The paper is paywalled behind a bot check;
the figure below is quoted from the publisher's own press release rather than
read off the paper." Keep the honesty, lose the tool names.

**R2 — F4's parenthetical has a dangling referent and is wrong about R mode.**
`how-to-calculate-trading-expectancy.md`, line 40:

> "(Pick a currency and the tool formats it the way your browser's region does,
> so **the symbol you see may differ from the one above**; pick R and the units
> stay plain.)"

Two problems. First, there is no symbol above any more — the fix correctly
stripped them, so "the one above" points at nothing. Second, "pick R and the
units stay plain" is not what the script does. Line 2033 of
`tools/expectancy-calculator.html` is
`(n >= 0 ? '' : '−') + Math.abs(n).toFixed(2) + 'R'` — R mode appends "R" and
has no thousands separator. So:

| Mode | What the tool actually prints |
|---|---|
| R | `67.00R` and `5360.00R over 80 trades` — note no comma |
| USD, en-US browser | `$67.00` and `$5,360.00` |
| USD, en-AU browser | `USD 67.00` and `USD 5,360.00` |
| USD, en-GB browser | `US$67.00` and `US$5,360.00` |

The draft's figures — "67.00" and "5,360.00" — match none of these exactly. They
are the currency-mode digits with the symbol removed.
*Fix:* "(The tool prints a currency symbol formatted for your browser's region,
or a trailing R if you measure in R, so the digits below are what to match, not
the symbols.)" The arithmetic itself is untouched and I re-verified all
fourteen figures — every one still reproduces exactly.

**R3 — `what-to-record-in-every-journal-entry.md` still shares 3 of its 4 tags
with two published posts.** Tags are now `[journaling, process, mistakes,
discipline]`; `/blog/why-a-trading-journal` is `[journaling, process, review,
discipline]` and `/blog/how-to-tag-your-trading-mistakes` is `[journaling,
mistakes, process, tags]`. E1/E5 landed well elsewhere — the expectancy post
went from sharing 5 of 5 tags with `win-rate-is-lying-to-you` to 2 of 4, and the
MT5 post now shares 1 — but this one is materially unchanged. The weekly-review
and backtest drafts also sit at 3 of 4 with a published post, which I am less
worried about because both now explicitly position themselves as companions to
those posts and link them in the body.
*Fix:* swap one of `process`/`discipline` for something the post actually owns —
`fields`, `thesis` or `record-keeping`.

**R4 — Plan name inconsistency between the two product paragraphs.** C2 landed
in both drafts, correctly. But `what-an-mt5-statement-contains.md` line 60 says
"a **Pro Trader** feature" while `what-to-record-in-every-journal-entry.md`
line 33 says "syncs a connected MT5 account **on Pro**". `pricing.html` names
the plan **Pro Trader** (line 1742); the product pages use "Pro" as shorthand.
Both are defensible, but two posts publishing in the same batch should pick one.

**R5 — The TradeZella time estimate is still slightly understated.**
`what-to-record-in-every-journal-entry.md` line 92: "TradeZella's page does
estimate manual entry at 20–60 minutes a day." The page says 5 trades ≈ 20
minutes, 10 trades ≈ 40 minutes, and "At 20+ trades per day (common for
scalpers), you're looking at **over an hour**." This was in `REVIEW.md` and was
not on the fix list, so it may be deliberate. It understates the source in the
post's own favour, which is the direction not to err in.
*Fix:* "at twenty minutes to over an hour a day".

**R6 — The `profit (loss) - commission - fees - swap` quotation moved the
opposite way to the plan.** E4 was meant to leave that verbatim quotation in the
MT5 post only. What happened is that all three bodies now paraphrase it (MT5
line 32 "profit, less commission, less fees, less swap"; expectancy line 26 "the
platform nets commission, fees and swap into each deal"; journal-entry line 31
"with commission, fees and swap netted into each deal") — which is good, the
triplication is gone — but the verbatim string now survives only in the *Sources
blocks* of the expectancy draft (line 97) and the journal-entry draft (line 91),
and nowhere in the MT5 post at all. Not an error, and arguably fine. Worth a
deliberate decision rather than an accident.

**R7 — One cosmetic inconsistency in quotation punctuation.** The set otherwise
applies the logical/British rule correctly: the full stop sits inside the
quotation marks only when the source sentence ends there (expectancy line 56,
prop lines 26, 32, 54) and outside for partial quotes. The exception is
`prop-firm-drawdown-rules-explained.md` line 40, where a complete quoted
sentence takes the stop outside: `…bounces back to a profit".` One character.

---

## Fixes confirmed landed

| # | Fix | Where | Verdict |
|---|---|---|---|
| F1 | fabricated percentages deleted | backtest 92 | **half** — quotes gone, replacement claim false (see above) |
| F2 | time-zone paragraph rewritten | MT5 42 | landed in body; **not in Sources** (see above) |
| F3 | TradeZella weekly-review re-characterised | weekly 84 | **landed** — all three attributions re-checked and correct: "daily reviews tend to be too reactive" ✓, "15-20 trades per review period" ✓, aggregate patterns ✓. The stated difference (outcome bias, size of a day's sample, capture vs judgement) is genuinely what this post does and that page does not |
| F4 | currency symbols dropped | expectancy 40 | **mostly** — figures correct, parenthetical wrong (R2) |
| F5 | TradeZella vs howtotrade.com distinguished | journal 92 | **landed** — matches what I found: TradeZella folds emotion into notes, howtotrade.com has a dedicated "Emotions and Behavior" section |
| F6 | Novy-Marx restated | backtest 44 | **landed** — "one-sided monthly turnover above 50%" and "even when the strategy is designed to mitigate costs" both now present and both faithful to the abstract |
| F8 | AMS result conditioned | backtest 24 | **landed** — "even when none of them has any real edge" |
| U1 | thesis de-ranked | backtest 10, excerpt | **landed** — "degrades for reasons the others do not share", and the excerpt was updated to match |
| U2 | three-trade claim softened | weekly 20 | **landed**, exact wording |
| U3 | CFA attribution | backtest 36 | **landed** in body ("CFA Level II study notes on backtesting"). Sources line 90 still says "curriculum notes" — borderline, worth aligning |
| U4 | The5ers row | prop 64 | **landed, and improved on what I suggested** — it states the gap and turns it into the article's point rather than dropping the row |
| U5 | Orders list generic, Direction quoted | MT5 30, 32 | **landed** — "MetaQuotes documents its values as 'in', 'out' or 'in/out' — the deal's direction relative to the current position in that symbol" is now exactly what the page says, and the "reversal" gloss is gone. Sources line 78 still credits article 211 with the entry types, which it does not define; the real source is `performing_deals` on line 77 |
| U6 | Van Tharp line | expectancy 99 | **landed well** — quotes the page verbatim ("your initial risk is $10 per share, so in this case, 1R is equal to $10" ✓), claims only what it supports, and disclaims the coinage explicitly |
| C1 | three-value system label | journal 33 | **landed** — "typed, imported from a statement file, or synced from a connected broker — and the label is set by the system rather than chosen… three different strengths of evidence, not one badge". Matches `verification.ts` |
| C2 | plans named | MT5 58/60, journal 33 | **landed** in both; see R4 on naming |
| C3 | rule examples made arbitrary | weekly 58 | **landed** — "Those two are arbitrary examples, not suggestions" |
| C4 | body brackets rewritten | prop 44, MT5 22 | **landed in both.** The prop-firm one keeps the substance, names no firm, and turns it into advice ("that is the question to ask support before you need the answer"). The MT5 one is now supported by `fxjournalstats.com`, which itself notes "the menu text may vary slightly" |
| C5 | badge sentence | MT5 68 | **landed**, exact wording |
| P1 | field list → question table | journal 35–44 | **landed well** — the table is a genuine improvement, the shared emotion-word list is gone, and line 35 credits and links the published post |
| P2 | homework sentence | journal 62 | **landed** — rewritten, metaphor gone |
| P3 | "one lesson, not ten" credited | weekly 71 | **landed**, with a link and a real distinction (a week is long enough to have tested the last change) |
| P4 | MetaQuotes field dumps trimmed | MT5 18 | **landed** — the Details block is now four examples plus a link; the Deals list is still full, which is right, it is the load-bearing one |
| P5 | taxonomy credited | prop 14 | **landed** — credits The5ers' explainer in the body and states what this post adds |
| S2 | dated parentheticals consolidated | prop 12 | **landed** — one dated line; the remaining five are bare domain names. Note line 12 says "the firms' own rules pages" while one source is FTMO's blog — disclosed in context at line 40, so fine |
| E1/E5/E6 | tags, R defined once, MT5 recategorised | all | **mostly landed** — MT5 is now Analytics; R is defined once in the expectancy post (line 76) and deferred to the published post everywhere else; tag differentiation worked except R3 |
| E2 | weekly/daily reconciled | weekly 10–14 | **landed, and it is the best edit in the set.** "Capture daily, judge weekly" resolves the contradiction, links the published post, and makes the new post read as the second half of an argument rather than a rebuttal. The heading change to "Why conclusions wait for the week" carries it through |
| E8 | cross-links | journal 31 | **landed, but see PUBLISHING.md below** — exactly one cross-draft link exists |

---

## Mechanics after the edits — all still hold

| Draft | Title | Excerpt | Category | Words | 200 wpm | Stated | Links |
|---|---|---|---|---|---|---|---|
| expectancy | 35 | 144 | Analytics | 1,438 | 7.2 | 7 min | 9 |
| prop firm | 35 | 143 | Risk & Sizing | 1,486 | 7.4 | 7 min | 3 |
| weekly review | 35 | 131 | Journaling | 1,385 | 6.9 | 7 min | 6 |
| MT5 statement | 39 | 141 | Analytics | 1,363 | 6.8 | 7 min | 4 |
| journal entry | 43 | 150 | Journaling | 1,475 | 7.4 | 7 min | 9 |
| backtest | 37 | 128 | Strategy | 1,420 | 7.1 | 7 min | 5 |

- **Titles** all ≤ 60. **Excerpts** all ≤ 155. **Categories** all from the
  permitted set. ✓
- **Read times** all honest at 200 wpm. The weekly-review post correctly went
  6 → 7 min after the reconciliation paragraph was added; that was the only one
  that needed changing and it was changed. ✓
- **Headings** `##` only, no `###`, no `#`. **No exclamation marks** anywhere. ✓
- **Internal links** — every one resolves. The only new target is
  `/blog/what-an-mt5-statement-contains`, which matches that draft's `slug`
  exactly. All others are in `sitemap.xml` and `data/posts.json`. ✓
- **Seam scan** — no doubled words, no broken sentences, no stray double spaces,
  no missing spaces after full stops, no orphaned clauses. The hand edits are
  clean. The only casualty is the dangling "the one above" in R2. ✓
- **Spelling** — British/Australian in authorial prose throughout; source
  spellings correctly preserved inside quotations ("realized"/"unrealized" in
  the Topstep and Apex quotes, "realised"/"unrealised" elsewhere). ✓
- **Frontmatter** parses in all six and carries every field `data/posts.json`
  needs except the ones `PUBLISHING.md` lists. ✓

One observation rather than a defect: all six now state "7 min". They are each
individually honest, but six consecutive 7-minute posts on the blog index looks
templated. The true figures span 6.8 to 7.4, so one or two could round to 6 or 8
without dishonesty if you want the index to look less uniform.

---

## Things worth checking now that the edits made relevant

**The new cross-link is the only one.** `what-to-record-in-every-journal-entry.md`
line 31 links `/blog/what-an-mt5-statement-contains`. Nothing else in the set
links to anything else in the set. So there is exactly one ordering constraint,
not a web of them.

**Re-verified because the sentence around them changed:**

- The Van Tharp quotation at expectancy line 99 — re-opened, verbatim ✓.
- The TradeZella weekly-review attributions at weekly line 84 — re-opened, all
  three verbatim or faithful ✓.
- The howtotrade.com/TradeZella distinction at journal line 92 — re-opened,
  correct ✓.
- The MQL5 offset derivation at MT5 line 42 — re-read the page, the new sentence
  matches it ✓.
- The Direction values at MT5 line 32 — re-checked against `performing_deals`,
  exact ✓.
- The two competitor pages at backtest line 92 — re-opened, and the new claim
  fails (see above).

**Not re-verified, because the sentences containing them are unchanged:** the
FTMO, Topstep, Apex and The5ers quotations in the prop-firm post. I confirmed
the quoted strings in the file are byte-identical to what I checked against the
firms' own pages earlier today, so they carry forward. They will not carry
forward past today — see `PUBLISHING.md`, which is right about this.

---

## `PUBLISHING.md`

**The follow-ups are right. The order section is not quite.**

**Order — needs correcting.** It says "The drafts cross-link, so publish in this
order or the links 404", then lists all six, flagging only items 5 and 6 as
having "no inbound dependency". There is exactly **one** cross-draft link in the
whole set: journal-entry → MT5 statement. So:

- The only real constraint is **`what-an-mt5-statement-contains` before (or with)
  `what-to-record-in-every-journal-entry`**. That part is correct and correctly
  explained at line 10.
- **`how-to-calculate-trading-expectancy` (3) and `the-twenty-minute-weekly-review`
  (4) have no inbound dependency either**, and the file implies they do by
  listing them inside the constrained block and reserving the "no inbound
  dependency" note for 5 and 6. Both can ship in any order, alone.
- Line 17, "Publishing 1–4 in one batch is fine; they only need to land
  together", is therefore stronger than the facts require. Only 1 and 2 need to
  land together.

Suggested rewrite: one constrained pair (MT5 → journal entry) and four
independent posts, with the *recommended* order stated as an editorial
preference rather than a technical one.

**I would also change the recommended order itself.** `PUBLISHING.md` puts the
prop-firm post fifth. It is the only draft I would publish today without further
work, and it is the only one whose value decays — every quotation is dated
22 September 2026 and prop firms revise terms without notice. Publishing it
fifth maximises the chance it ships stale. Put it first or second; the
MT5 → journal-entry pair has no urgency attached to it.

**Prop-firm shelf life (lines 29–33)** — correct, and the instruction "do not
carry the date forward" is exactly right. Add that Apex's help centre refuses
automated fetching (403), so whoever re-checks will need a real browser for that
one.

**Follow-up 1 (the 0.2R–0.6R benchmark)** — correct, and correctly quoted from
`/blog/win-rate-is-lying-to-you`. Still worth doing independently of these
drafts.

**Follow-up 2 (three URLs competing)** — correct. The `for/journal.html` FAQ
answer is schema-marked, as stated.

**Follow-up 3 (published read times)** — I did not raise this one, and it is a
good catch. Confirmed, with a small correction to the range: the ten published
posts run **271 to 752 words** (not 275–770), with stated read times of 5–10
minutes against true times of **1.4 to 3.8 minutes** at 200 wpm. The worst is
`backtesting-vs-forward-testing` — 349 words, labelled 10 min, a true 1.7. This
matters more once these drafts ship: a genuinely 7-minute 1,400-word post will
sit on the index next to a 271-word post claiming 6 minutes, and the honest one
will look like the outlier. Fix `data/posts.json` before or with the first
publish, not after.

**"What the review could not settle" (lines 55–65)** — all three are accurately
stated. I would add the fourth from `REVIEW.md`: whether the MT5 history report
can be saved as XLSX. The body now says "It saves as HTML; the terminal also
offers a spreadsheet export", which is the right hedge, but no cited page states
the format list.

---

## Where this leaves the set

Five of six are one or two line-edits from publishable, and three of those
edits are in Sources blocks rather than body copy. The prop-firm post is ready.

The backtest post is the exception, and it is the same sentence as last time.
The pattern across both passes is worth naming: every factual error found in
either review has been in a "read for coverage, not cited for fact" block —
F1, F3 and F5 in pass 1, and F1's replacement in pass 2. Those blocks describe
pages nobody re-reads, about competitors, in a register that invites a summary
from memory. Four of the six drafts now carry accurate ones, which took two
rounds of checking. Before anything ships, re-open the cited page for every
sentence in those blocks, and treat a coverage claim as a factual claim needing
a citation — because that is what it is.
