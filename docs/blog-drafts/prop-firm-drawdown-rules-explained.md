---
slug: prop-firm-drawdown-rules-explained
title: Prop firm drawdown rules, explained
excerpt: Static, end-of-day trailing and intraday trailing drawdown are three different rules wearing the same number. Here is how each one is measured.
category: Risk & Sizing
tags: [drawdown, risk management, prop firm, rules]
readtime: 7 min
---

Two traders tell you they are on a "10% drawdown" account. One can lose ten per cent of their starting balance over six months and still be trading. The other can be closed out on a day they finished in profit, never having been down ten per cent of anything.

Both describe their rules accurately. The percentage is the least informative part. What decides your room is three things it does not tell you: what the limit is measured against, what counts as the measurement, and when it moves. Everything below is quoted from the firms' own rules pages, checked on 22 September 2026. Prop firms change these terms, so treat this as a guide to reading your own contract rather than a replacement for it.

The categories below — static, end-of-day trailing, intraday trailing, and balance versus equity — are the ones the industry already uses; The5ers' own explainer sets them out in much the same shape. What follows attaches each one to a named firm's published wording.

## Static drawdown: the floor is nailed down

A fixed floor is set from your starting capital on day one and never moves again. FTMO's 2-Step Challenge works this way. Its Maximum Loss is 10% of the Initial Simulated Capital, "calculated as the difference between: the **Initial Simulated Capital** and the **Maximum Loss Amount**", and the page defines it as a limit "below which your account **equity**... cannot drop".

Every unit of profit you keep widens the buffer one for one: up six per cent, and sixteen per cent sits between your equity and a floor nothing can move.

## End-of-day trailing: the floor follows your closed days

Here the floor rises as the account grows, but only at a fixed point in the day. Topstep publishes this plainly: "The MLL is a trailing limit. It rises as your end-of-day balance grows, but never moves down", and "Once it reaches your starting balance, it locks permanently". The published limits are $2,000 on a $50K account, $3,000 on $100K and $4,500 on $150K (help.topstep.com).

The detail people miss is the next sentence. "The MLL updates at the end of each trading day but is monitored in real time throughout the session. Both realized and unrealized P&L count toward it." The floor moves once a day. The breach can happen on any tick.

FTMO's 1-Step Challenge uses this shape too, which is the cleanest illustration of the problem. Its Maximum Loss is also 10%, but the page describes it as "an **end-of-day trailing** limit", recalculated daily at 00:00 CE(S)T from "the highest **account balance** achieved at 00:00 CE(S)T of any preceding trading day". Same firm, same word, same percentage, different rule.

## Intraday trailing: the floor follows your best tick

The strictest of the three: the floor tracks the account's highest value at any moment, including profit on positions you have not closed. Apex Trader Funding documents it directly: "It maintains a fixed dollar distance behind the peak based on account size and never decreases, even if the account balance later declines", and "The threshold is enforced in real time, including unrealized PnL." The published distances on evaluations are $1,000 on 25K, $2,000 on 50K, $3,000 on 100K and $4,000 on 150K (apextraderfunding.com).

Follow those numbers through a 50K evaluation. You start at $50,000 with the threshold at $48,000. A trade runs $2,500 in your favour before you close anything, so Peak Balance is $52,500 and the threshold moves to $50,500. Give that open profit back and your stop-out sits $500 above where you started, on a ledger that has never shown a realised loss.

When the trailing stops is published too, and it is not one answer: on a Performance Account "Once the Intraday Threshold reaches Starting Balance + $100, it stops increasing", while on Tradovate evaluations it "trails indefinitely with the peak account balance". One firm, different behaviour by platform.

## Closed balance or floating equity

Cutting across all three shapes: does the rule read balance or equity? Balance is closed trades only. Equity adds the live profit and loss of everything still open, so a rule written against equity can be breached by a position that later recovers fully. FTMO says so on its own blog: "If your floating (open) losses drag your real-time equity below your daily limit, the rule is violated, regardless of whether that trade later bounces back to a profit."

Check your rules against closed P&L only, and you are checking a number your firm may not be reading.

Some firms are described elsewhere as measuring daily drawdown on closed balance alone. I could not find that stated unambiguously on any firm's own rules page, so no firm is named for it here — which is itself the point: if your terms do not say which basis applies, that is the question to ask support before you need the answer.

## Daily loss limits run on a different clock

A daily loss limit is not a smaller maximum drawdown but a separate rule, with its own reset and its own consequence. FTMO's Maximum Daily Loss is 5% of Initial Simulated Capital on the 2-Step and 3% on the 1-Step, "recalculated daily at 00:00 CE(S)T" against "the **account balance** recorded at 00:00 CE(S)T of the current day". Note which figure the reset reads: profit still open at midnight is not in the balance, so it does not widen today's allowance.

Topstep's daily rule is a different kind of thing. Its Daily Loss Limit "is optional in the Trading Combine® and Express Funded Account® (XFA)" and automatic in the Live Funded Account, and "Triggering it is not a rule violation — it's a forced break for the rest of that session" (help.topstep.com). The same phrase means terminal failure at one firm and a cooldown at another.

## Consistency rules: passing and getting paid are separate tests

Some firms apply a rule that has nothing to do with losing and everything to do with how your profit is distributed. Apex publishes a 50% requirement: "no single trading day accounts for more than 50% of your total accumulated profit at the time of a payout request." The consequence is specific — "the payout request option will not be available. The account remains active" (apextraderfunding.com).

Topstep applies consistency at two points. In the Trading Combine, "Your single best day of profit must stay at or below 55% of your Profit Target", and exceeding it raises the profit target rather than failing the account. On an Express Funded Account, "Your Consistency % must be 40% or below to be Payout eligible" (help.topstep.com). A related constraint is the minimum-days rule: The5ers' High Stakes programme requires three profitable days, defined as days on which "the closed positions made a positive profit of at least 0.5% of the initial balance" (the5ers.com).

## Why "10% drawdown" is not a comparable number

Four of those rules side by side:

- **FTMO 2-Step** — 10%, static against initial capital, read on equity.
- **FTMO 1-Step** — 10%, end-of-day trailing against the highest midnight balance, read on equity.
- **The5ers High Stakes** — 10% maximum loss and 5% daily, with three profitable days required. Their published spec table gives the percentages; I could not confirm on their own site whether that 10% is static or trailing, or whether it reads balance or equity, which is exactly the gap this article is about.
- **Apex 100K evaluation** — $3,000, or three per cent, trailing your peak in real time including unrealised profit.

The Apex figure is the smallest percentage there and, on those published mechanics, the least forgiving of a round trip. The FTMO 2-Step figure is the largest and the only one your own good day cannot tighten. Ranking these by percentage sorts them backwards.

## What you can hold in your own records

None of this tells you how to trade — only which rule you are under, which is a more answerable question. The firm's dashboard is the authority on your breach status.

What a journal can do is keep the inputs honest. Sizing in R before the trade makes a losing day a bounded number you chose rather than one you discover — the [position size calculator](/tools/position-size-calculator) does that arithmetic, and [position sizing 101](/blog/position-sizing-101) covers the reasoning. Reviewing your own max drawdown weekly records how close you ran to the limits on the days you did not breach them. TradingSocial's [prop-firm journal](/for/prop-firm) lets you set your own rules and scores your logged trades against them; it does not connect to any firm's dashboard, and it does not read, detect or enforce a firm's rule set.

Read your firm's rule page properly, once, before the account is live. It is the cheapest twenty minutes in the process.

## Sources

- https://ftmo.com/en/trading-objectives/ — FTMO's own Trading Objectives page; source for the 10% Maximum Loss on both 1-Step and 2-Step, the static versus end-of-day-trailing distinction between them, the 5%/3% Maximum Daily Loss, the 00:00 CE(S)T reset, and the equity-based wording. Checked 22 September 2026.
- https://ftmo.com/en/blog/watch-out-for-open-losses/ — FTMO's own explanation of why floating losses count toward the limits even if the trade recovers. Checked 22 September 2026.
- https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit — Topstep's help centre; source for the end-of-day trailing Maximum Loss Limit, the permanent lock at starting balance, real-time monitoring including unrealised P&L, and the $2,000/$3,000/$4,500 figures. Checked 22 September 2026.
- https://help.topstep.com/en/articles/8284207-what-is-the-daily-loss-limit-and-what-happens-if-i-exceed-it — Topstep's help centre; source for the Daily Loss Limit being optional in the Combine and XFA, automatic in the LFA, and not a rule violation. Checked 22 September 2026.
- https://help.topstep.com/en/articles/8284208-consistency-at-topstep — Topstep's help centre; source for the 55% Combine consistency threshold and the 40% XFA payout threshold. Checked 22 September 2026.
- https://apextraderfunding.com/help-center/intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-explained/ — Apex Trader Funding's help centre; source for the intraday trailing threshold following Peak Balance including unrealised PnL, the per-account-size trailing distances, and the three different lock behaviours across Performance Accounts, Rithmic/WealthCharts and Tradovate. Checked 22 September 2026.
- https://apextraderfunding.com/help-center/additional-helpful-items/50-consistency-requirement/ — Apex Trader Funding's help centre; source for the 50% consistency requirement and its consequence at payout request. Checked 22 September 2026.
- https://the5ers.com/high-stakes/ — The5ers' own High Stakes programme page; source for the 5% maximum daily loss, 10% maximum loss, profit targets and the minimum-profitable-days definition. Checked 22 September 2026.
- https://the5ers.com/prop-firm-drawdown-rules-explained-daily-max-and-trailing-limits-in-2026/ — read for coverage comparison only. It explains the four model categories well but names no firm and cites no firm's published rules, which is the gap this post sets out to fill.
