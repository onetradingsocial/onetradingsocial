# Review — third pass

Checked 22 September 2026. Review only; nothing edited, committed or published.

**All ten items landed. No new seams. The set is publishable as it stands.**

## Verdicts

| Draft | Verdict |
|---|---|
| `prop-firm-drawdown-rules-explained.md` | **publish** |
| `what-an-mt5-statement-contains.md` | **publish** |
| `what-to-record-in-every-journal-entry.md` | **publish** |
| `how-to-calculate-trading-expectancy.md` | **publish** |
| `the-twenty-minute-weekly-review.md` | **publish** |
| `why-your-backtest-lies-about-drawdown.md` | **publish** |

## The ten items

1. **F1 — confirmed true of both pages.** The surviving clause, "Neither treats
   drawdown as an extreme-order statistic", holds: LuxAlgo handles drawdown only
   inside a cost-sensitivity comparison, PineConnector as a general performance
   metric, and neither distinguishes a single worst path from an average. The
   two claims that failed last time — psychology, and multiple testing — are
   gone. This is the first version of this sentence that survives checking.
2. **R1 — landed.** Reader-facing, no tool names, no SSRN claim, and it still
   says plainly that the figure comes from the press release.
3. **Baron & Hershey — correct.** The PDF masthead reads "Journal of Personality
   and Social Psychology 1988, Vol. 54, No. 4, 569-579". Volume, issue and pages
   all match. Flag removed, and "identical decisions being rated better when the
   outcome was good" is faithful to the abstract.
4. **F2 residual — landed.** The source line now matches both the MQL5 page
   (which derives the offset in hours via `TimeTradeServer`) and the corrected
   body at line 42. The contradiction between body and Sources is gone.
5. **R2 — landed.** Nothing dangles, and it is true of both modes: currency
   mode formats the symbol by browser region, R mode appends a trailing R. One
   hairline, not worth acting on: in R mode the tool prints `5360.00R` with no
   thousands separator against the draft's `5,360.00`. The digit sequence is
   identical and "match the digits rather than the symbols" covers it.
6. **R3 — landed.** `[journaling, fields, thesis, mistakes]` now shares one tag
   with `/blog/why-a-trading-journal` (was three) and two with
   `/blog/how-to-tag-your-trading-mistakes` (was three).
7. **R4 — landed.** "Pro Trader" in both posts.
8. **R5 — landed.** "twenty minutes to over an hour a day" matches the source.
9. **R7 — landed.** Stop inside the quotation at prop-firm line 40, consistent
   with the other three full-sentence quotes.
10. **PUBLISHING.md — landed, and the order is now right.** One real dependency
    (journal-entry → MT5), prop-firm first for shelf life, range corrected to
    271–752 words, and the Sources-discipline line added.

## New seams

None. Automated scan for doubled words, stray punctuation, missing spaces after
full stops and orphaned parentheses returns zero across all six files. I also
re-read every edited line in context; the hand edits are clean.

## Mechanics — all still hold

Titles 35–43 chars, excerpts 128–150, categories valid, `##` only, no
exclamation marks, no `[UNVERIFIED]` anywhere in any draft, every internal link
resolves (including `/blog/what-an-mt5-statement-contains`, which matches that
draft's slug). Word counts 1,363–1,485; every "7 min" is honest at 200 wpm.

## Two optional tidies, only if the Sources blocks ship

Neither is an error in any article, and `PUBLISHING.md` leaves open whether
these blocks publish at all.

- `why-your-backtest-lies-about-drawdown.md`, Sources: "CFA Level II curriculum
  notes". The body correctly says "study notes"; AnalystPrep is a prep provider,
  not the curriculum. One word.
- `what-an-mt5-statement-contains.md`, Sources: the `mql5.com/en/articles/211`
  line still credits that article with "deal entry types in/out/inout", which it
  does not define. The body now relies on `performing_deals` (the line above),
  which does. Move the clause up a line.

Also cosmetic, in `PUBLISHING.md` itself: line 3 says "all 35 review findings",
which was the pass-one count — pass two added ten more.

## Judgement

Yes, publish. The three rounds did what they were for: every factual claim in
all six drafts now rests on a source I opened and checked, every quotation is
verbatim, every number reproduces, the product claims match `verification.ts`
and the entitlement gates, and the two contradictions with already-published
posts are resolved rather than papered over.

The one thing that is time-bound: the prop-firm post's eleven quotations were
verified today and are dated today. `PUBLISHING.md` is right to put it first and
right to say not to carry the date forward. If it slips more than a few days,
re-open all four firms' pages before it goes out — and note that Apex refuses
automated fetching, so that one needs a real browser.
