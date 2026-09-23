---
slug: what-an-mt5-statement-contains
title: What an MT5 statement actually contains
excerpt: MetaTrader 5 produces two different files people call a statement. Here is what each one holds, what it proves, and what it quietly does not.
category: Analytics
tags: [validation, analytics, MT5, verification]
readtime: 7 min
---

Most guides to exporting an MT5 statement stop at the right-click. Toolbox, History tab, Report, save. That gets you a file and tells you nothing about what is in it — which matters, because that file is what you hand to a prop firm, a journal, or anyone who wants to check your numbers against something other than a screenshot.

Here is what MetaTrader 5 actually writes down, and what it is worth.

## Two files, both called "the statement"

MT5 produces two reports and traders use the same word for both.

The first is the **history report**. You reach it from the Toolbox, in the History tab, through Report in the right-click menu. MetaQuotes' documentation sets out its structure: a header carrying the brokerage company, account number, account owner's name, deposit currency and the date the report was generated; then tables of Orders, Deals, Positions and Working Orders; then a Summary block of account figures (Balance, Equity, Margin, Free Margin and the rest) and a Details block of computed statistics — Total Net profit, Profit Factor, Expected Payoff, three separate drawdown measures, and the usual breakdowns by long and short. The [MetaQuotes documentation](https://www.metatrader5.com/en/terminal/help/trading_advanced/history_report) lists them all. It saves as HTML; the terminal also offers a spreadsheet export.

The second is the **Trading Report**, a more recent addition. It sits under Reports in the View menu, or "Report \ Overview" from the history context menu, and it is a dashboard rather than a ledger: tabs for Summary, Profit/Loss, Long/Short, Symbols and Risks, with Sharpe Ratio, Profit Factor, Recovery Factor, Max. Drawdown, Max. Deposit Load, MFE and MAE among the figures. Build 4150 added export of it to HTML and PDF.

The difference is practical. The Trading Report is the better-looking file and the less useful one, because it is already aggregated. The history report is the one with the rows in it, and rows are what a journal can import. The menu wording can differ slightly between builds and between brokers' white-label terminals, so look for Report rather than an exact phrase.

## Orders, deals and positions are not synonyms

This is the part almost every export guide skips, and it is the reason two tools can read the same file and disagree about how many trades you took.

An **order** is the instruction you sent the server. A **deal** is an execution — the thing that actually happened on the market. MetaQuotes is explicit that a single order can produce several deals, when the volume you asked for was not covered by one offer. A **position** is the resulting exposure, assembled by the platform from every deal that opened, added to, partially closed or fully closed it.

So the file holds three different views of the same afternoon. The history tables carry, for orders: the time, symbol, type, volume, requested price, stop-loss and take-profit levels, and the order's final state. For deals, MetaQuotes lists: Time, Deal, ID, Order, Symbol, Type, Direction, Volume, Price, Value, Cost, S/L, T/P, Commission, Fee, Profit, Change, Magic. The positions view reports opening and closing time, closed volume against source volume, the weighted average opening price, the closing price, the total financial result, and Stop Loss and Take Profit.

Note Direction on the deal rows. MetaQuotes documents its values as "in", "out" or "in/out" — the deal's direction relative to the current position in that symbol — and it is how a parser works out which deals pair into one round trip. Note also that your net result on a trade is not the Profit column alone: profit, less commission, less fees, less swap. A statement that looks better than your balance usually means someone read one column.

## Netting and hedging change the shape of the file

MT5 runs two position accounting systems. Under netting you hold one position per symbol at a time. Under hedging you can hold several positions in the same symbol, including opposite ones.

That is not a detail. On a netting account, a morning of scaling in and out of one instrument collapses into a single position record with a weighted average price. On a hedging account the same activity stays as separate positions. The deals are identical; the trade count is not. If your journal's numbers differ from the terminal's, this is the first place to look.

## The clock is the broker's, not yours

MT5 timestamps history in the trading server's time zone, not your computer's, and the file carries no field naming that zone. Inside the terminal a program can recover the offset — MQL5's own documentation derives it as the difference in hours between local and server time — but an offset in hours is not a named zone with daylight-saving rules attached, and a saved file has neither. Read the statement back months later and you cannot map its rows onto sessions with confidence. Sessions, day-of-week analysis and anything else that depends on hour-of-day inherits whatever offset your broker happens to run, and a Sunday evening open can sit on a Monday row.

## What the statement proves

It proves that a broker's server recorded these executions on this account. That is a real and useful thing. It is the difference between a number you typed and a number a counterparty agreed to. It puts entry, exit, size, commission, swap and result outside your memory and outside your optimism.

## What it does not prove

It is not an audited attestation. Nobody independent has signed it. The HTML version is generated on your own machine from a template — `ReportHistory.htm`, in the platform's `/Templates` folder — which means the file you upload is a local rendering of the server's data, not a signed document from the server. A determined person can edit it before sending it on, and no parser can tell.

It also says nothing about the questions people usually want answered. Whether this is your only account. Whether the losing one is elsewhere. Whether the account is live or demo — MT5 does not stamp that in a way a third party can rely on. Deposits and withdrawals beyond what the balance rows imply. A statement is evidence about executions, not about a trader.

## Statement import versus a live connection

On TradingSocial the two are deliberately not the same thing.

A **statement import**, on the Trader plan, reads the MT5 report you exported and adds the closed trades to your [journal](/for/journal). The execution fields are locked once imported — prices, sizes, results, timestamps — and the trade carries a label saying it arrived by statement. But the file passed through your machine on the way in, so the label says exactly that and no more.

A **broker connection**, which is a Pro Trader feature, pulls closed trades from the broker's records on a schedule, roughly hourly, using your investor password — a read-only credential that cannot place orders or move funds. Nothing passed through your hands. The label reflects that, and it is set by the system rather than chosen by you. The [MT5 page](/for/mt5) covers the mechanics of both, including symbol suffix matching and the fact that only closed trades are journalled.

Manual entries stay manual and stay editable, and are labelled as such. That is the whole of the claim: every trade says how it arrived. It is a bound, not a guarantee.

## Why any of this matters

For your own review, provenance is almost irrelevant. You know whether you typed it honestly. Your [expectancy and R-multiples](/blog/win-rate-is-lying-to-you) work the same either way, and the [habit of reviewing at all](/blog/why-a-trading-journal) is doing most of the work.

It starts mattering the moment someone else reads your numbers — a prop firm, a subscriber, a partner, an audience. At that point the question stops being "are these good results" and becomes "how did these results get here", and the honest answer is how it arrived, not a verdict on the trader. A broker-synced record says the data never touched a keyboard. A statement import says it came from the broker's ledger by way of your hard drive. A typed record says you typed it.

Three different claims. Worth keeping them three different words.

## Sources

- https://www.metatrader5.com/en/terminal/help/trading_advanced/history_report — MetaQuotes' description of the history report: the header, Orders, Deals, Positions, Working Orders, Summary and Details blocks, the named statistics, and the `ReportHistory.htm` template.
- https://www.metatrader5.com/en/terminal/help/trading/report — the newer Trading Report: Summary, Profit/Loss, Long/Short, Symbols and Risks tabs, the Sharpe Ratio / Recovery Factor / Max. Drawdown / MFE / MAE metrics, and HTML and PDF export.
- https://www.metatrader5.com/en/releasenotes/terminal/2342 — MT5 build 4150 release note confirming trading report export to HTML and PDF was added, and where the export commands live.
- https://www.metatrader5.com/en/terminal/help/trading/performing_deals — the verbatim column names in the History tab for orders, deals and positions, the Trade tab fields, and the deal entry types "in", "out" and "in/out".
- https://www.mql5.com/en/articles/211 — MetaQuotes article on orders, deals and positions: one order can generate several deals, deals are stored in history and cannot be modified, and (background only) deal entry types in/out/inout.
- https://www.metatrader5.com/en/terminal/help/trading/general_concept — netting versus hedging position accounting, and how many positions per symbol each allows.
- https://www.mql5.com/en/book/common/timing/timing_local_server — server time versus local time in MetaTrader; source for the offset between them being derivable in hours inside the terminal, which is not the same as a named time zone recorded in the file. Checked 22 September 2026.
- https://www.metatrader5.com/en/mobile-trading/android/help/history — mobile History fields, used to cross-check the deal column names (Deal, Order, Swap, Commission, Fee).
- https://mytradingjournal.io/guides/export-import-mt4-mt5-history and https://www.fxjournalstats.com/guides/how-to-export-metatrader-5-trade-history-as-html-for-analysis — two of the guides currently ranking for MT5 export. Read for coverage: both give the click path and stop, and neither covers netting/hedging, server time, commission and swap, or what the file proves.
