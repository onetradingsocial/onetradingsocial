---
slug: how-to-calculate-trading-expectancy
title: How to calculate trading expectancy
excerpt: The formula, a worked example you can reproduce, the break-even win rate hiding inside it, and why the trade count matters more than the number.
category: Analytics
tags: [expectancy, profit factor, sample size, analytics]
readtime: 7 min
---

Expectancy is the number that decides whether a strategy makes money, and the one most often quoted without the context that makes it mean anything — the count of trades behind it.

Most explanations stop at the formula and a tidy example. Here is the arithmetic, a worked example you can reproduce in the [expectancy calculator](/tools/expectancy-calculator), the second formula that catches people out, and the five ways the figure goes quietly wrong.

## The formula, and what each term has to mean

> Expectancy = (win rate × average win) − (loss rate × average loss)

That is the whole thing. It returns the average result of one trade across the set you measured, no more and no less.

The definitions matter more than the multiplication:

- **Win rate** is winners divided by *all* closed trades, not winners divided by losers. Decide once what happens to a trade that closes at exactly zero and never change it mid-sample. **Loss rate** is 1 − win rate.
- **Average win** is the sum of the winners divided by the number of winners; **average loss** is the same for losers, entered positive. The minus sign is already in the formula.
- Both averages must be in the **same unit**: all R, or all currency. Never a mix.

MetaTrader 5 reports this on every account history as Expected Payoff, "a statistically calculated value showing the average return of one deal". Note what it counts: the platform nets commission, fees and swap into each deal before averaging, so costs sit inside the figures *before* the average is taken. Yours should too.

## A worked example you can check

Eighty closed trades, 34 of them winners, so a win rate of 42.5%. The winners averaged $412, the losers $188.

    Expectancy = (0.425 × 412) − (0.575 × 188)
               = 175.10 − 108.10
               = $67.00 per trade

Now check it the long way. Gross profit is 34 × $412 = $14,008. Gross loss is 46 × $188 = $8,648. Net is $5,360, and $5,360 ÷ 80 = $67.00.

Two routes, one answer. If they disagree, your win rate and your averages came from different sets of trades — usually because some rows were filtered out of one and not the other.

Type 42.5, 412, 188 and 80 into the [expectancy calculator](/tools/expectancy-calculator) and it returns the same figures: expectancy 67.00 per trade, reward-to-risk 2.19 : 1, break-even win rate 31.3%, profit factor 1.62, and 5,360.00 over 80 trades. (The tool prints a currency symbol formatted for your browser's region, or a trailing R if you measure in R, so match the digits rather than the symbols.) Everything below uses those numbers, so you can follow along in the tool rather than take it on trust.

## The break-even win rate is the second line

Set expectancy to zero and solve for the win rate. The two averages cancel down to a single ratio:

    Break-even win rate = 1 ÷ (1 + reward-to-risk)

At 2.19 : 1 that is 1 ÷ 3.19 = 31.3%. The example system wins 42.5% of the time, so it clears break-even by about eleven percentage points. That margin, not the win rate itself, is the part worth watching.

Run it the other way and the trap appears. A system winning 72% of the time with $80 average winners and $260 average losers has a reward-to-risk of 0.31 : 1, which puts break-even at 76.5%. Winning nearly three trades in four is not enough: expectancy is −$15.20 a trade and profit factor is 0.79. That asymmetry is the subject of [win rate is lying to you](/blog/win-rate-is-lying-to-you); the break-even formula is the compact version of it.

None of which says which ratio to trade. Win rate and reward-to-risk come out of one system together, so moving one usually moves the other; the arithmetic only tells you where the line sits.

## Profit factor is the same information, rotated

Profit factor is gross profit divided by gross loss. MetaTrader 5's definition is the standard one: "ratio of the gross profit to the gross loss. A value of one means that these parameters are equal." Here, $14,008 ÷ $8,648 = 1.62.

The two are algebraically linked:

    Profit factor = 1 + expectancy ÷ (loss rate × average loss)

So they cross their break-even points together — expectancy through zero, profit factor through 1.0 — and neither can be positive while the other is negative.

Both are still worth keeping. Expectancy carries a unit and scales with the trade count, which is what makes "$5,360 over 80 trades" sayable. Profit factor is unitless, so it compares a futures account against a forex account with nothing to convert.

## Sample size decides whether any of it means anything

An expectancy is a mean, and a mean from a small sample is unstable. Its precision improves with the square root of the number of observations — as the NIST Engineering Statistics Handbook puts it, "as N increases, the interval gets narrower from the √N term". The consequence is unforgiving: to halve your uncertainty, quadruple your trade count.

Here is what that looks like in the worked example. Suppose the largest winner was $3,000 — more than a fifth of the gross profit in one trade — and suppose it had instead stopped out at the average loss. Winners fall to 33 and gross profit to $11,008, so the average win becomes $333.58; losers rise to 47 and gross loss to $8,836. Expectancy is now $27.15, profit factor 1.25.

One trade out of eighty moved the headline figure by nearly 60%, and nothing about the strategy changed. That is the problem with quoting an early number as though it were a measurement, and why the calculator prints a warning rather than a verdict on any run under a hundred trades.

## Five ways the number goes quietly wrong

**Mixing R and currency in one average.** R is the risk you took on a trade — entry to initial stop, fixed before you were in it — and [win rate is lying to you](/blog/win-rate-is-lying-to-you) works through why. The consequence here is that a +2R winner on one instrument is comparable with a +2R winner on another. A dollar figure is not comparable across position sizes, and a column where some rows are R and some are dollars averages to nothing at all. One unit per calculation; if you want both, calculate twice.

**Leaving the worst trades out.** "That one doesn't count, I wasn't really trading" is the most expensive sentence in performance review. The demonstration above runs both ways: a sample sensitive enough for one $3,000 winner to move expectancy by 60% is just as sensitive to one excluded disaster. If it was executed on the account it belongs in the set — and if it belongs to a different system, it belongs in a different set, not in the bin.

**Quoting expectancy without the trade count.** "My expectancy is 0.4R" is not a claim anyone can evaluate. Over 40 trades it is an indication; over 600 it is closer to a measurement. The count is half the statement, not a footnote.

**Leaving costs outside the averages.** Commission, swap and slippage come off every trade, so at the same gross expectancy they hit a high-frequency system harder than a low-frequency one. A figure built from planned rather than filled prices is a backtest — a different thing, covered in [backtesting vs forward testing](/blog/backtesting-vs-forward-testing).

**Averaging setups that are not one system.** A portfolio expectancy of +0.1R can easily be one setup at +0.5R and another at −0.3R, kept afloat by the first. The aggregate hides the leak; segmenting finds it. Which is why a [journal that records the setup](/for/journal) is worth more later than a broker export.

## What the number still cannot tell you

MetaTrader's help describes Expected Payoff as showing "the expected return of the next trade". Read that carefully. It is an average over trades that have already happened, and it carries forward only while your strategy, your execution and the market stay as they were.

Results also arrive in streaks rather than in averages. A positive expectancy is entirely compatible with a long losing run, and whether you are still trading at the end of that run is a question about position size, not expectancy — which is why the [position size calculator](/tools/position-size-calculator) and [position sizing 101](/blog/position-sizing-101) sit alongside this.

Run your own numbers through the [expectancy calculator](/tools/expectancy-calculator); it prints the break-even win rate and profit factor next to the figure. The calculation takes a minute. Collecting a sample large enough for it to mean something takes a lot longer, and there is no version of this where that part gets skipped.

## Sources

- <https://www.metatrader5.com/en/terminal/help/algotrading/testing_report> — MetaQuotes' own definitions of Profit Factor ("ratio of the gross profit to the gross loss. A value of one means that these parameters are equal"), Expected Payoff, Gross Profit and Gross Loss.
- <https://www.metatrader5.com/en/terminal/help/trading_advanced/history_report> — the account history report definitions, including that each deal's result is calculated as "profit (loss) - commission - fees - swap", and the description of Expected Payoff as the expected return of the next trade.
- <https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm> — NIST/SEMATECH Engineering Statistics Handbook on confidence intervals for the mean: "as N increases, the interval gets narrower from the √N term". Supports the quadruple-the-sample-to-halve-the-uncertainty point.
- <https://vantharpinstitute.com/tharp-think-trading-concepts/> — Van Tharp Institute. Source for 1R as the initial risk on a trade ("your initial risk is $10 per share, so in this case, 1R is equal to $10") and for expectancy as the mean of a system's R-multiple distribution. Checked 22 September 2026. It does not claim to have coined the term, and this post makes no claim about who did.
- <https://www.tradingsocial.io/tools/expectancy-calculator> — the calculator used for every figure in the worked example; it states the same two formulas (expectancy, and break-even win rate = 1 ÷ (1 + reward-to-risk)) and produced the outputs quoted.
- <https://www.tradezella.com/blog/trading-expectancy> and <https://www.pineconnector.com/blogs/pico-blog/what-is-expectancy-ratio> — read for coverage, not cited for fact. Both give the formula and an example; neither derives the break-even win rate, and PineConnector covers neither profit factor nor sample size. That gap is what this post is aimed at.
