---
slug: what-to-record-in-every-journal-entry
title: What to record in every trade journal entry
excerpt: Every journal template is a column list. Here is the reasoning under it: which field answers which question later, and which ones only you can supply.
category: Journaling
tags: [journaling, fields, thesis, mistakes]
readtime: 7 min
---

Search for a trading journal template and you will get a dozen column lists. Date, symbol, direction, entry, exit, size, P&L, notes. They are all roughly the same list, and none of them tells you the thing that actually matters: what question each field is there to answer, months from now, when you have forgotten the trade entirely.

That is the test. A field earns its place in your entry if there is a question you will want to ask later that the field is the only way to answer. Everything else is typing.

## Start from the question, not the field

Here are the questions traders actually bring to a journal after a bad month. Each one implies the fields it needs:

- *Which of my setups is losing money?* — needs a setup name on every trade, spelled the same way every time.
- *Am I worse at some times of day than others?* — needs entry timestamps, in a timezone you fixed once.
- *Does my performance change after a loss?* — needs entries in sequence, with results, so a losing run can be reconstructed.
- *Is my edge real or is it one outlier?* — needs every trade, including the ones you would rather forget, and enough of them to count.
- *Do I actually follow my own rules?* — needs a yes or no from you on each trade, recorded at the time.
- *What was I thinking?* — needs a sentence that you wrote before you knew how it ended.

Work backwards from that list and the field set almost builds itself. Work forwards from a template and you end up with twenty columns, three of which you ever look at.

## Two kinds of field, and only one is your problem

The useful split is not "essential versus optional". It is **what the record already knows** against **what only you can supply**.

The first group is execution data. Instrument, direction, entry price, exit price, size, timestamps, fees, realised result. A broker statement contains all of it, and it is arithmetic from there: P&L, win rate, average win, average loss, profit factor. MetaTrader 5 already reports the aggregates on any account history, with commission, fees and swap netted into each deal — [what an MT5 statement actually contains](/blog/what-an-mt5-statement-contains) goes through the file field by field.

If you are typing those fields out of a terminal by hand, you are doing work a file could do. TradingSocial reads an [MT5 statement](/for/mt5) on the Trader plan, or syncs a connected MT5 account on Pro Trader, and lands closed trades in the journal with the execution fields locked from editing afterwards. That lock is also what makes a shared record mean anything to somebody else: every trade carries a label saying how it arrived — typed, imported from a statement file, or synced from a connected broker — and the label is set by the system rather than chosen. Those are three different strengths of evidence, not one badge.

The second group is the one no import will ever fill, and it is the entire reason a journal beats an export. [The case for journaling](/blog/why-a-trading-journal) lists these fields; what follows is the part that decides whether they earn their place — the question each one is the only way to answer later.

| Field | The question it answers months from now |
|---|---|
| **Thesis**, one sentence, written before the outcome | Was my reasoning sound on the trades that lost, and lucky on the ones that won? |
| **Planned risk** — where the initial stop sat, and what that distance was worth | What was 1R on this trade, before I moved anything? |
| **State at entry**, one word | Do my worst results cluster with a state I could have noticed at the time? |
| **Rule followed or broken**, plus a named tag when broken | Which single named error accounts for most of my preventable losses? |

The planned-risk field carries more weight than it looks. Move a stop mid-trade and nothing in the execution record recovers the number you originally planned around, yet R is the denominator under [every ratio you will calculate afterwards](/blog/win-rate-is-lying-to-you). The [position size calculator](/tools/position-size-calculator) gets you the figure before entry; the journal is the only place it survives.

Four fields, and every one of them decays the moment you stand up from the desk.

## Why you write the thesis before you know the answer

This is the part the template posts skip, and it has actual research behind it.

Baruch Fischhoff's 1975 experiments found that being told how something turned out changes how likely people say it always was — and, critically, that participants were "largely unaware" the outcome knowledge had affected them at all. The 2012 review by Roese and Vohs describes hindsight bias as combining memory distortion with revised beliefs about an event's objective likelihood.

Applied to a trade: once you know it worked, the entry looks obvious and you record a thesis that is cleaner and more confident than the one you actually had. Once you know it failed, you record doubts you did not feel. Both entries are useless for the only thing a journal is for — telling you whether your reasoning was any good, separately from whether the trade paid.

> The thesis is only evidence if it was written down before the market answered it.

The fix is mechanical, not psychological. Write the thesis and the planned risk before or at entry. Write the emotion, the exit reason and the rule check within a few minutes of the close. The order matters more than the prose.

## Ninety seconds, honestly

The entries people stop filling in are the ones that ask for twenty-odd columns, most of them retyped from a statement the broker already sent you.

Count the work in the list above instead. The execution fields are imported or copied, which is seconds. That leaves a setup tag, a one-line thesis, an R figure you already calculated before entering, a one-word emotion, a rule check, and a mistake tag if there is one. That is a sentence and four taps. Ninety seconds is a realistic budget for it, and the budget is the point: an entry you will actually complete after a red trade beats a thorough one you skip.

The other reason to keep it short is consistency. Patterns only surface if the same fields exist on every trade. Fifty entries with six fields will tell you more than fifteen entries with twenty, because the first set can be counted and the second cannot.

## Fields that exist because a rule set exists

If you are trading an evaluation or a funded account, a few extra fields stop being optional, because somebody else's arithmetic now depends on them.

FTMO's published objectives, for example, define a maximum daily loss as a floor the account's equity cannot drop below, recalculated each day at 00:00 CE(S)T from that day's opening balance, with equity measured as "Balance + Open Positions P/L ± Swaps – Commissions". Read that carefully: the day boundary is the firm's clock, not yours, and the measure includes open positions.

So the entry needs a timestamp you can convert to the firm's day, the account it belongs to, and the risk you had on at the time — not just the risk you closed with. Tagging each account by type matters for the same reason: a challenge account's numbers should never quietly merge into your live track record, which is why [the prop-firm setup](/for/prop-firm) keeps prop, live, demo and competition accounts labelled separately.

TradingSocial does not read or enforce any firm's rule set. Everything above is your own record of your own compliance, which is the only version that survives you switching firms.

## What the entry is worth months later

None of this pays off on the day you write it. It pays off the first time you sort by mistake tag and find that one named error accounts for most of your preventable losses — the process described in [how to tag your trading mistakes](/blog/how-to-tag-your-trading-mistakes). Or the first time a setup you were sure about turns out to be carried entirely by three trades from March.

Neither of those questions can be answered retrospectively. You cannot go back and add a thesis to a trade from four months ago, and if you try, you will write the one the outcome suggests. The entry is a message to a version of you who has forgotten everything except the number.

Ninety seconds, the same fields every time, written before you know. That is the whole method, and the rest is just deciding to keep doing it. If you want somewhere to put it, [the journal](/for/journal) is free to start and [the case for the habit](/blog/why-a-trading-journal) is a shorter read than this one.

## Sources

- <https://psycnet.apa.org/record/1976-00159-001> — Fischhoff, B. (1975), "Hindsight is not equal to foresight: The effect of outcome knowledge on judgment under uncertainty", *Journal of Experimental Psychology: Human Perception and Performance*, 1(3), 288–299, DOI 10.1037/0096-1523.1.3.288. Source for outcome knowledge changing judged likelihood, and for participants being largely unaware of the effect.
- <https://journals.sagepub.com/doi/abs/10.1177/1745691612454303> — Roese, N. J. & Vohs, K. D. (2012), "Hindsight Bias", *Perspectives on Psychological Science*, 7(5), 411–426. Source for hindsight bias combining memory distortion with revised beliefs about objective likelihood.
- <https://ftmo.com/en/trading-objectives/> — FTMO's published trading objectives. Source for the maximum daily loss being an equity floor recalculated at 00:00 CE(S)T from that day's opening balance, and for equity defined as "Balance + Open Positions P/L ± Swaps – Commissions". Used as a concrete published example, not as a recommendation of any firm.
- <https://www.metatrader5.com/en/terminal/help/trading_advanced/history_report> — MetaQuotes' account history report definitions, including each deal's result being calculated as "profit (loss) - commission - fees - swap". Supports the claim that the execution half of an entry is derivable from a broker record.
- <https://www.tradezella.com/blog/your-free-trading-journal-template> and <https://howtotrade.com/blog/trading-journal-template/> — read for coverage, not cited for fact. Both are representative of what ranks: a field list, with no account of which later question any field answers, which is the gap this post fills. They differ on emotion — TradeZella folds it into notes, while howtotrade.com gives it a dedicated "Emotions and Behavior" section covering feelings before, during and after a trade. TradeZella's page does estimate manual entry at twenty minutes to over an hour a day, which is the cost this post argues against. Both checked 22 September 2026.
