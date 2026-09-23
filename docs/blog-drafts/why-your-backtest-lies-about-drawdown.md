---
slug: why-your-backtest-lies-about-drawdown
title: Why your backtest lies about drawdown
excerpt: Of every number a backtest reports, maximum drawdown degrades live for reasons the others do not share. Here is each one, named.
category: Strategy
tags: [backtesting, forward testing, drawdown, validation]
readtime: 7 min
---

We have already argued that [a backtest is a hypothesis, not proof](/blog/backtesting-vs-forward-testing), and that walk-forward and forward testing are how you find out which. This post is narrower. Of all the figures a backtest hands back, maximum drawdown degrades for reasons the others do not share, and those reasons are specific enough to name one at a time.

## Maximum drawdown is a sample extreme, not an average

Win rate is an average over hundreds of trades, so it is reasonably stable. Maximum drawdown is a single worst peak-to-trough on a single path — one number, from one sequence of events that happened once.

Extremes behave badly. Magdon-Ismail, Atiya, Pratap and Abu-Mostafa worked out the expected maximum drawdown of a Brownian motion and found the limiting behaviour "can be logarithmic (for positive drift), square root (for zero drift) or linear (for negative drift)". The practical reading: for a process with no real edge, expected worst drawdown keeps growing with the length of the record. It does not converge to a number your strategy "has" — run the test longer and it gets worse, with no change to the strategy at all.

So a three-year backtest reporting a 14% maximum drawdown is not saying your strategy's drawdown is 14%. It is saying that in three years of one particular path, the worst stretch was 14%. Year four is under no obligation.

## You chose the strategy using the same data that produced the drawdown

This is the big one, and it compounds everything below.

When you tune parameters you are not only maximising return — you are, implicitly, minimising apparent drawdown, because the configurations that survive your screening are the ones where the bad stretch happened to be shallow. Bailey, Borwein, López de Prado and Zhu put a number on that in the *Notices of the American Mathematical Society*: with five years of data, examining as few as 45 configurations is enough that one of them will look good in sample even when none of them has any real edge — an attractive Sharpe ratio in the test and a dismal one out of it. Most people try more than 45 before lunch.

Their sharpest point is not the maths but the reporting: the number of configurations tried is almost never disclosed, so nobody reading the backtest can judge how overfit it is. If you cannot say how many variants you tried, you cannot say what your drawdown figure means.

The same problem produced Harvey, Liu and Zhu's conclusion that, after accounting for the hundreds of factors people have tested, a newly discovered one "needs to clear a much higher hurdle, with a t-ratio greater than 3.0" — and that "most claimed research findings in financial economics are likely false". That is a field with peer review and published data. A spreadsheet of parameter sweeps has neither.

## The data has already been filtered

Survivorship is usually explained with delisted stocks, and that is the clean case: Brown, Goetzmann, Ibbotson and Ross showed in 1992 that truncating a sample by survival produces the *appearance* of predictability where none exists. Test on the instruments that still exist and you have excluded every one that stopped existing — a delisted currency pair, a crypto perpetual that was wound down, a symbol whose spec changed mid-history. None are in the file you downloaded, and the missing ones are disproportionately those that would have supplied the ugly stretch.

## Look-ahead, including the kind you do not notice

The obvious version is using information that did not exist yet. CFA Level II study notes on backtesting split it into three: reporting lag, data revisions, and index additions, where a vendor backfills a company's history once it joins an index.

The retail versions are subtler and mostly about bars. A signal computed on a bar's close and filled at that same close assumes you knew the close before it closed. An indicator that repaints. A stop assumed to have triggered at the bar's low when the high came first — inside one bar there is no ordering, and the backtest picks one. All of these tighten drawdown specifically, because they let you exit trouble at prices only visible afterwards.

## Fills you would not have got

Backtests fill at the price in the data. Live, you cross a spread that widens exactly when you most want out, you pay commission and swap, and on anything illiquid you move the price yourself.

Novy-Marx and Velikov measured this across the published anomaly literature and found that "in all cases transaction costs reduce the strategies' profitability and its associated statistical significance" — costs do not only shave returns, they weaken the evidence. Few of the anomalies with one-sided monthly turnover above 50% generate a statistically significant net spread, they report, even when the strategy is designed to mitigate costs. A slow strategy loses a little to costs; a fast one loses its entire case.

## Gaps do not respect your stop

A stop loss is an instruction to sell at the market once a price trades. It is not a promise of that price. When the intervening levels never print, the fill is wherever the market reopens.

On 15 January 2015 the Swiss National Bank abandoned its EUR/CHF floor and the pair fell through stops without printing on the way down. FXCM said clients owed $225 million in negative balances; Alpari (UK) went into insolvency. Traders who had defined their risk precisely found that defining it and enforcing it are different operations.

A backtest that fills stops at the stop price assigns that entire class of event a probability of zero. Weekend gaps are the same mechanism, smaller: the position sits through two days of news, and Monday's open is the fill.

## The chart compresses what you would have lived through

On paper, a 20% drawdown is a dip in a line whose right-hand side you can already see. Lived, it is an unknown number of months, any of which could be the start of something worse, with no right-hand side visible. Depth is what gets reported; duration is what gets felt. Time under water — from the old peak to the recovery — is barely ever quoted alongside the drawdown figure, and it is what decides whether you are still running the strategy at the bottom.

The backtest also never asks you to place the next order after eight consecutive losses, at the size the model assumes you kept.

## What forward testing fixes, and what it does not

Forward testing fixes a good list. Real spreads and real fills. Real gaps, in real time, with real weekends. Real sequencing. And genuinely unseen data, which is the only kind that tests anything.

It does not fix four things.

**Sample size.** To observe a six-month drawdown you need six months. A forward test that has not yet had a bad stretch has not measured your drawdown; it has measured the absence of one so far.

**Multiple testing, again.** Forward testing three strategies and keeping the best is the same selection problem on fresher data. The count of candidates still matters, and still goes unreported.

**Your own survivorship.** You remember the forward test you kept. The two abandoned in week three do not appear in the figure you now quote.

**Behaviour at size.** A simulated account and a funded one produce different decisions from the same person, which is why [going from demo to live](/blog/from-demo-to-live) is its own transition rather than a formality.

## The number that is not a simulation

The one drawdown figure with no modelling assumptions in it comes from trades you actually took. Peak to trough, on real equity, including the spread you paid, the gap you sat through and the entry you skipped because you did not like the look of it.

That is what a [journal](/for/journal) is for: a weekly review reporting P&L, win rate and drawdown off your own record rather than off a curve you fitted. For the arithmetic behind the other half — what a run of losses does to an account at a given size — the [position size calculator](/tools/position-size-calculator) and the [expectancy calculator](/tools/expectancy-calculator) work it out with no historical dataset to overfit.

None of this makes backtesting useless. It remains the cheapest way to rule things out. It is that the drawdown line is the one output to read as a floor rather than an estimate — the best case you found, on the data you looked at, among however many configurations you are not reporting.

## Sources

- https://www.cambridge.org/core/journals/journal-of-applied-probability/article/abs/on-the-maximum-drawdown-of-a-brownian-motion/F9E3B8A454B020DDEBF0AC3390EF7807 — Magdon-Ismail, Atiya, Pratap & Abu-Mostafa (2004), *Journal of Applied Probability* 41(1), 147–161. Source for expected maximum drawdown scaling logarithmically / as a square root / linearly with the horizon depending on drift.
- https://www.eurekalert.org/news-releases/817304 — press release for Bailey, Borwein, López de Prado & Zhu, *Notices of the AMS* (May 2014). Source for the "as few as 45 sample configurations" over a five-year dataset claim.
- https://www.ams.org/notices/201405/rnoti-p458.pdf — the paper itself, "Pseudo-Mathematics and Financial Charlatanism". Source for the argument that the number of configurations tried is the missing disclosure. The paper sits behind an automated bot check, so the figure quoted above is taken from the publisher's own press release rather than read off the paper.
- https://www.nber.org/papers/w20592 — Harvey, Liu & Zhu, "… and the Cross-Section of Expected Returns". Source for the t-ratio above 3.0 hurdle and "most claimed research findings in financial economics are likely false".
- https://www.nber.org/papers/w20721 — Novy-Marx & Velikov, "A Taxonomy of Anomalies and their Trading Costs". Source for costs reducing both profitability and statistical significance in all cases, and the ~50% monthly turnover threshold.
- https://academic.oup.com/rfs/article-abstract/5/4/553/1590264 — Brown, Goetzmann, Ibbotson & Ross (1992), "Survivorship Bias in Performance Studies". Source for a survivorship-truncated sample generating the appearance of predictability.
- https://analystprep.com/study-notes/cfa-level-2/problems-in-backtesting/ — CFA Level II study notes on backtesting. Source for the three-way split of look-ahead bias into reporting lag, data revisions and index additions.
- https://www.swissinfo.ch/eng/fxcm-faces-losses-as-swiss-shock-leaves-alpari-uk-insolvent/41219974 — contemporaneous reporting on 15 January 2015. Source for FXCM's $225 million in client negative balances and Alpari (UK)'s insolvency after EUR/CHF gapped through stops.
- https://www.pineconnector.com/blogs/pico-blog/backtesting-vs-live-trading-bridging-the-gap-between-strategy-and-reality and https://www.luxalgo.com/blog/backtesting-limitations-slippage-and-liquidity-explained/ — two pages currently ranking for backtest-versus-live queries. Read for coverage, not cited for fact. Neither treats drawdown as an extreme-order statistic, which is where this post concentrates. Both checked 22 September 2026.
