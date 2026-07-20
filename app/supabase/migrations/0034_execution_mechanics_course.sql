-- Execution & Market Mechanics course (trader tier, ord 6). Covers the gap
-- between having a setup and having a fill: orders, spread, slippage, costs,
-- liquidity, scaling, and a written execution checklist.
-- Idempotent: safe to re-run.

insert into public.courses (slug, title, summary, difficulty, ord, min_tier, published) values
  ('execution-mechanics', 'Execution & Market Mechanics', 'Between a good setup and a good result sits the fill. Orders, spread, slippage, costs, liquidity, and the checklist that protects your edge from your own execution.', 'intermediate', 6, 'trader', true)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Lessons
-- ---------------------------------------------------------------------------
with c as (select id from public.courses where slug = 'execution-mechanics')
insert into public.lessons (course_id, slug, title, body, ord, xp_reward, published)
select c.id, v.slug, v.title, v.body, v.ord, 125, true from c, (values

('order-types', 'Order Types and What They Actually Promise', $html$
<p>Every order you send makes exactly one promise, and never both of the two you want. Understanding which promise you are buying is the difference between an execution plan and a hopeful click.</p>

<h2>The two guarantees, and the trade between them</h2>
<p>An order can guarantee <strong>execution</strong> or it can guarantee <strong>price</strong>. Nothing guarantees both, because the two are in direct conflict — insisting on a price means accepting that the market may never offer it.</p>
<ul>
  <li><strong>Market order.</strong> Guarantees execution, not price. You take whatever the book is offering right now. In a liquid instrument during normal hours that is a trivial concession; in a thin one, or two seconds after a data release, it can be brutal.</li>
  <li><strong>Limit order.</strong> Guarantees price or better, not execution. Your buy limit at 41.20 fills at 41.20 or lower, or it does not fill. The cost is the trade you never got into.</li>
  <li><strong>Stop order.</strong> A dormant instruction that becomes a market order once price touches your trigger. Guarantees that you act, not the price you act at. This is what most protective stops are.</li>
  <li><strong>Stop-limit order.</strong> Becomes a limit order at the trigger. Caps your worst price — and can leave you unfilled in exactly the fast move the stop existed to protect you from.</li>
</ul>

<h2>Choosing by what the trade needs</h2>
<p>Match the order type to which guarantee actually matters for that leg of the trade.</p>
<p><strong>Entries where missing the trade is cheap</strong> — a pullback to a level you defined in advance — belong in limit orders. You defined the price because the price is the edge; paying up to chase it usually removes the edge you were paying for.</p>
<p><strong>Entries where missing the trade is expensive</strong> — a confirmed break you have already decided to trade — often justify a market order or a stop-entry above the level. Waiting for a limit to fill in a move that is running away from you means you systematically get filled only on the breaks that fail.</p>
<p><strong>Protective stops should be stop (market) orders, almost always.</strong> The scenario a stop-limit protects you against — a bad fill — is far less dangerous than the scenario it exposes you to: price gapping through your limit, leaving you unfilled and still in a position that is now moving hard against you. Traders who use stop-limits for protection generally discover this once, expensively.</p>

<blockquote>A protective stop's job is not to get you a good price. It is to get you out.</blockquote>

<h2>Brackets: decide once, in advance</h2>
<p>A bracket ties your entry to a stop and a target submitted at the same time, so the exits exist in the market before the position does. This is a mechanical solution to a psychological problem covered in the Trading Psychology course — orders placed while calm cannot be renegotiated by a version of you that is watching a loss.</p>
<p>Two practical notes. First, understand whether your broker's bracket is OCO (one-cancels-other) — if it is not, closing at target can leave a live stop order behind that opens a new position later. Second, know what happens to resting orders at session close and over weekends; some are cancelled, some persist, and a stop you assumed was live but was not is one of the more expensive surprises in trading.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Orders guarantee execution or price, never both — pick the one that trade needs.</li>
  <li>Limit orders for planned entries at defined levels; market or stop-entry when missing the move costs more than the fill.</li>
  <li>Protective stops should be stop-market: getting out matters more than the price you get.</li>
  <li>Submit brackets at entry so exits exist before emotion does — and confirm they are OCO.</li>
</ul>
$html$, 1),

('the-spread', 'The Spread: The Cost You Pay on Every Trade', $html$
<p>There is no single price. There is a price you can sell at (the bid) and a higher price you can buy at (the ask), and the gap between them is the spread. Every position starts life underwater by that amount, on every trade you will ever take.</p>

<h2>Measure the spread against your stop, not in ticks</h2>
<p>"Two pips" or "a cent" means nothing on its own. What matters is the spread as a fraction of your stop distance, because that is what tells you the fraction of your risk consumed before the market moves at all.</p>
<ul>
  <li>Stop distance 100 ticks, spread 1 tick: <strong>1% of your risk</strong>. Irrelevant.</li>
  <li>Stop distance 20 ticks, spread 1 tick: <strong>5% of your risk</strong>. Noticeable.</li>
  <li>Stop distance 8 ticks, spread 1 tick: <strong>12.5% of your risk</strong>, and 25% round-trip. Now the spread is a structural drag on your entire strategy.</li>
</ul>
<p>This is the mathematical reason scalping is harder than it looks. The strategy is not necessarily worse — its cost per unit of risk is simply several times higher, so it needs a much stronger raw edge to end up in the same place. If you trade tight stops, compute this ratio before you compute anything else.</p>

<h2>Why spreads move</h2>
<p>A spread is what market makers charge for holding inventory they might not be able to offload. It widens whenever that risk rises:</p>
<ul>
  <li><strong>Around scheduled news.</strong> Spreads on major pairs can widen many multiples in the seconds around a release, then normalise.</li>
  <li><strong>Outside main hours.</strong> The same instrument can be several times more expensive to trade at 3am than at midday in its home session.</li>
  <li><strong>In small or illiquid instruments.</strong> Fewer participants, wider quotes, permanently.</li>
  <li><strong>During stress.</strong> Volatility spikes widen quotes exactly when you most want to act.</li>
</ul>
<p>The practical consequence: a stop placed just beyond a level can be taken out by a spread widening rather than by price actually reaching your level. On a long position your stop triggers off the bid, and the bid can drop while the mid barely moves. If you trade around news, that alone is a reason to size down or stand aside.</p>

<blockquote>You do not get stopped out at the price on your chart. You get stopped out at the price on the side of the book you have to exit through.</blockquote>

<h2>Account types and the honesty question</h2>
<p>Brokers package the same cost differently. A "zero commission" account earns from a wider spread; a raw-spread account charges commission separately. Neither is inherently cheaper — the only fair comparison is total cost per round turn on the instrument and size you actually trade, which is the subject of lesson four.</p>
<p>Be sceptical of advertised averages. A quoted "0.1 pip typical spread" may describe the quietest hour on the most liquid pair. What matters is the spread during the sessions you trade. Record it in your journal for a couple of weeks and you will have a number specific to you rather than to the marketing page.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Judge spread as a percentage of stop distance — the same spread is trivial or fatal depending on your stop.</li>
  <li>Tight-stop strategies carry structurally higher cost per unit of risk and need a stronger raw edge.</li>
  <li>Spreads widen around news, outside main sessions, and during volatility spikes.</li>
  <li>Stops trigger off the far side of the book, so a widening spread alone can stop you out.</li>
  <li>Compare brokers on total round-turn cost at your size, not on advertised typical spreads.</li>
</ul>
$html$, 2),

('slippage', 'Slippage: The Gap Between Plan and Fill', $html$
<p>Slippage is the difference between the price you expected and the price you got. It is not a broker conspiracy and it is not avoidable — but it is measurable, and a trader who measures it makes decisions that a trader who complains about it cannot.</p>

<h2>Where it comes from</h2>
<p>Slippage has two ordinary causes. <strong>Latency</strong>: between your click and the exchange, the book moves. <strong>Depth</strong>: your order is larger than the quantity resting at the best price, so the remainder fills at successively worse levels. Both worsen in the same conditions — fast markets, thin books, large size.</p>
<p>Note that slippage is symmetric in principle. Market orders sometimes fill better than expected, particularly on limit-style entries in calm conditions. In practice it skews against you, because the moments you most want immediate execution are precisely the moments the book is thinnest.</p>

<h2>The three places it hits</h2>
<ul>
  <li><strong>Entry slippage.</strong> Costs you a little on every trade and slightly worsens your reward-to-risk. Annoying, rarely dangerous.</li>
  <li><strong>Stop slippage.</strong> The one that matters. Your 1R loss becomes 1.4R. This is the mechanism by which a strategy that backtests profitably loses money live, and it is invisible unless you log planned stop price alongside actual fill.</li>
  <li><strong>Gap risk.</strong> The extreme case. Price jumps over your stop entirely — weekend gaps, earnings, a central bank surprise — and you exit far beyond your planned risk. No stop type prevents this; only position size limits the damage, which is why the Risk Management course puts sizing before everything else.</li>
</ul>

<h2>Measure it, in R</h2>
<p>Log two numbers per trade: planned stop price and actual exit price. The difference, divided by your 1R distance, is slippage in R. After fifty trades you can compute your average — and that number belongs in your expectancy calculation.</p>
<p>Consider a trader whose journal shows +0.28R expectancy on paper and average stop slippage of 0.11R with a 45% loss rate. Their real expectancy is roughly 0.28 − (0.45 × 0.11) ≈ +0.23R. Still fine. Now consider a scalper with +0.12R paper expectancy, a 55% loss rate, and 0.15R average slippage: 0.12 − 0.08 ≈ +0.04R, before commission. Same "profitable strategy", completely different business — and the second one is one liquidity change away from being negative.</p>

<blockquote>Backtests fill perfectly. Markets do not. The difference is a number you can measure and should.</blockquote>

<h2>Reducing it</h2>
<p>You cannot eliminate slippage, but you can decline the conditions that produce it:</p>
<ul>
  <li><strong>Avoid holding through scheduled events</strong> unless the strategy is explicitly about them and sized accordingly.</li>
  <li><strong>Trade instruments and hours with real depth.</strong> Most slippage complaints are really liquidity complaints.</li>
  <li><strong>Size within available depth.</strong> If your order is a meaningful share of what is resting at the touch, you are moving the price you receive.</li>
  <li><strong>Use limit entries where the trade allows it</strong> — limits cannot slip, they can only fail to fill.</li>
  <li><strong>Widen the stop and reduce size</strong> rather than placing a tight stop in the exact zone where noise lives. Same risk in currency, far fewer bad exits.</li>
</ul>
<p>Then tag the trades where slippage was unusual. If the tag clusters — one instrument, one hour, one broker — you have found something actionable rather than something to be irritated about.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Slippage comes from latency and insufficient depth, and skews against you when you need speed most.</li>
  <li>Stop slippage is the dangerous kind: it silently inflates your average loss above 1R.</li>
  <li>Log planned stop versus actual fill and express average slippage in R, then subtract it from expectancy.</li>
  <li>Gap risk cannot be stopped by any order type — only position size limits it.</li>
  <li>Reduce slippage by choosing liquid instruments and hours, sizing within depth, and preferring limit entries where possible.</li>
</ul>
$html$, 3),

('total-cost-of-a-trade', 'The True Cost of a Trade', $html$
<p>Most traders can quote their commission and have no idea what a round turn actually costs them. The full number is the sum of four components, and expressed in R it tells you immediately whether your strategy has room to breathe.</p>

<h2>The four components</h2>
<ul>
  <li><strong>Commission.</strong> Explicit, per side or per round turn, sometimes tiered by volume. The only one most traders track.</li>
  <li><strong>Spread.</strong> Paid on entry and again on exit. Frequently larger than commission, and invisible on a statement because it never appears as a line item.</li>
  <li><strong>Slippage.</strong> From the previous lesson, averaged across your real fills.</li>
  <li><strong>Financing.</strong> Overnight swap or margin interest on leveraged positions, and short-borrow fees on equities. Irrelevant intraday, dominant for multi-week holds.</li>
</ul>
<p>There are smaller ones — exchange and regulatory fees, currency conversion on foreign instruments, inactivity charges, withdrawal fees. Individually trivial, collectively a real drag on a small account.</p>

<h2>Cost per R: the only number that travels</h2>
<p>Total your four components for one round turn, then divide by your average 1R risk in currency. That ratio is comparable across instruments, account sizes and strategies.</p>
<p>Take a trader risking 100 units of currency per trade. Commission 5 round turn, spread 6 round turn, average slippage 9. Total 20, or <strong>0.20R per trade</strong>. If their gross expectancy is +0.35R, they keep 0.15R — costs eat 57% of the edge. Halving cost per R to 0.10 would lift net expectancy from 0.15R to 0.25R: a 67% improvement in take-home with no change whatsoever to their trading decisions.</p>
<p>That is the point of this lesson. Cost reduction is the only edge improvement available that requires no market skill, no new setup, and no additional risk.</p>

<h2>Frequency multiplies everything</h2>
<p>Cost per R scales linearly with trade count, which reshapes the comparison between styles:</p>
<ul>
  <li>Swing trader: 8 trades a month at 0.05R cost each — <strong>0.4R a month</strong>. Negligible.</li>
  <li>Day trader: 60 trades a month at 0.10R — <strong>6R a month</strong>. Must be earned back before profit begins.</li>
  <li>Scalper: 400 trades a month at 0.15R — <strong>60R a month</strong>. The strategy is now primarily a cost-management business.</li>
</ul>
<p>None of these is wrong. But a scalper choosing a broker on user interface rather than cost per round turn has made the most expensive decision available to them.</p>

<blockquote>Costs are the one part of your expectancy the market has no vote in.</blockquote>

<h2>Reducing it without changing your strategy</h2>
<p>Wider stops with smaller size cut cost per R directly, because the same fixed cost is measured against a larger 1R. Fewer, better trades cut total cost outright. Commission tiers and account types are worth an hour of arithmetic once a year. Holding leveraged positions over weekends usually costs three days of financing, which can quietly dominate the return on a small swing trade. And unless it is genuinely part of the plan, trading a foreign-denominated instrument adds a conversion cost on every round turn.</p>
<p>Run this calculation quarterly against your journal rather than against your assumptions. Real fills, real commissions, real slippage.</p>

<h2>Key takeaways</h2>
<ul>
  <li>True cost = commission + spread (both sides) + slippage + financing.</li>
  <li>Express it as cost per R so it is comparable across instruments and strategies.</li>
  <li>Costs can consume half or more of a healthy gross expectancy.</li>
  <li>Cost scales with frequency — the same cost per R is trivial for a swing trader and decisive for a scalper.</li>
  <li>Cutting costs improves net expectancy without requiring any change in trading skill.</li>
</ul>
$html$, 4),

('liquidity-and-timing', 'Liquidity and When You Trade', $html$
<p>The same setup, on the same instrument, executed at two different hours, is two different trades. Liquidity determines your spread, your slippage, and whether the move you are trading has enough participants behind it to follow through.</p>

<h2>What liquidity actually is</h2>
<p>Liquidity is the quantity available near the current price — how much you can transact without moving the market against yourself. Volume and liquidity are related but distinct: a violent thin move produces high volume and terrible liquidity at once.</p>
<p>Two things to look for. <strong>Depth</strong> is how much size rests at and around the touch; thin depth means your own order becomes part of the price you receive. <strong>Continuity</strong> is whether prices step smoothly or jump. An instrument that regularly gaps several ticks between prints will not honour stops the way your chart implies, regardless of how much volume it trades.</p>

<h2>The shape of the trading day</h2>
<p>Nearly every market has a repeating intraday liquidity profile. The pattern generalises:</p>
<ul>
  <li><strong>The open.</strong> Highest volume, widest ranges, most opportunity, worst fills. Overnight information gets repriced and spreads are wider than they will be all day.</li>
  <li><strong>Late morning.</strong> Liquidity is deep and ranges are still meaningful. For many day traders this is the best fill quality of the session.</li>
  <li><strong>The midday lull.</strong> Volume drops, ranges compress, and breakouts fail at a noticeably higher rate because there is nobody to continue them. A disproportionate share of many traders' worst statistics live here.</li>
  <li><strong>The close.</strong> Volume returns with rebalancing and position-squaring flow. Real moves, but often mechanical rather than directional — flow that reverses the next morning.</li>
</ul>
<p>In 24-hour markets, session overlaps play the same role: the London–New York overlap is where the majority of daily forex volume trades, and the hours after the New York close are the thinnest of the cycle.</p>

<h2>Match the strategy to the regime</h2>
<p>Breakout strategies need participation — a break in the midday lull has nothing behind it, which is why the same pattern that works at the open fails four hours later. Mean-reversion strategies often prefer quieter conditions, where price is more likely to return to the middle of a range than to trend away from it. Neither strategy is broken when it fails in the wrong regime; it is simply being run in conditions it was not designed for.</p>
<p>This is exactly the "by time" slice from the Journal course. Run it: hour of day against expectancy. Most traders who do this for the first time find one specific window that is quietly funding their losses.</p>

<blockquote>Your setup did not fail. It ran at an hour where nobody was there to take the other side.</blockquote>

<h2>Events and the calendar</h2>
<p>Scheduled events — rate decisions, inflation prints, employment data, earnings — compress a day of repricing into seconds. Spreads widen, depth evaporates, and stops fill far from where they sat. Unless your strategy is explicitly built for events, the default position is simple: know what is on the calendar before the session, and either flatten, size down, or stand aside.</p>
<p>Holidays deserve the same caution for the opposite reason. Thin holiday sessions produce clean-looking chart patterns with no participation behind them, and the follow-through you are trading for never arrives.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Liquidity means depth and continuity, not volume — a thin fast move has both high volume and poor liquidity.</li>
  <li>The open offers the most opportunity and the worst fills; late morning usually offers the best balance.</li>
  <li>Breakouts need participation and fail more often in the midday lull; mean-reversion often prefers it.</li>
  <li>Slice your journal by hour — most traders find one window responsible for a large share of losses.</li>
  <li>Default to flat or smaller around scheduled events and thin holiday sessions.</li>
</ul>
$html$, 5),

('scaling-and-partials', 'Scaling In, Scaling Out, and Partial Fills', $html$
<p>Positions do not have to be all-or-nothing, and once they are not, your R maths changes. Scaling is a legitimate tool that is also one of the most common places traders quietly hide undisciplined behaviour.</p>

<h2>Scaling in</h2>
<p>Entering in tranches means your effective entry is the size-weighted average of your fills, and your risk is measured from that average to your stop — not from the first fill.</p>
<p>The rule that keeps this honest: <strong>define total intended risk before the first tranche</strong>. If the plan is 1R across three entries, each tranche is roughly a third of a position, and the total risk from average entry to stop equals 1R. What must never happen is adding to a position because it moved against you, without a pre-written plan, using the word "scaling" to describe it. That is averaging down, it converts a 1R loss into a 2R or 3R loss, and it is the single most common way a disciplined-looking trader blows an account.</p>
<p>Scaling in works best when your setup has a defined zone rather than a single price, and when adding is conditioned on <em>confirmation</em> — structure holding, the level rejecting — rather than on drawdown depth.</p>

<h2>Scaling out</h2>
<p>Taking partial profit lowers variance and makes holding the rest psychologically easier. It also caps your upside on the trades that pay for everything else, and that trade-off is worth being explicit about.</p>
<p>Compare two traders with identical entries over 100 trades. One exits fully at 3R with a 30% win rate: expectancy = (0.3 × 3) − (0.7 × 1) = <strong>+0.2R</strong>. The other takes half off at 1R and moves the stop to breakeven. Their winners average roughly 2R, their partial wins offset some losses, and their expectancy lands close to <strong>+0.15R</strong> with a far smoother curve and a higher win rate. Slightly less money, considerably more comfort — and for a trader who would otherwise abandon a strategy during a drawdown, the comfortable version may be the one that actually gets executed.</p>
<p>Neither answer is universally right. What is wrong is deciding mid-trade, because in-trade scaling decisions are made by fear, and fear takes profits early on the exact runners your expectancy depends on.</p>

<blockquote>Decide your scaling plan while flat. A partial exit invented during a trade is fear with a spreadsheet.</blockquote>

<h2>Moving to breakeven</h2>
<p>The most common companion to scaling out is moving the stop to entry. It feels free and it is not: a breakeven stop sits at the most-tested price in the trade, so it converts a meaningful number of eventual winners into scratches. If you do it, do it at a structural point — behind a higher low, past a level — rather than at a fixed R multiple, and check the decision against your journal. The "by mistake tag" slice will show you what <code>moved-to-breakeven-early</code> costs across a real sample.</p>

<h2>Partial fills</h2>
<p>Sometimes the market decides for you: a limit order fills 300 of 500 shares and the rest never fills. Handle it deliberately. Your risk is now smaller than planned — that is acceptable, and chasing the remainder at a worse price usually is not, since it degrades the average entry you chose the trade for. What must be corrected immediately is the stop and target quantity: a bracket sized for 500 against a 300 position leaves you with a working order that can open a new, unwanted position when it triggers. Check filled quantity against working orders every time.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Define total intended risk before the first tranche; measure risk from average entry.</li>
  <li>Adding to a loser without a pre-written plan is averaging down, not scaling in.</li>
  <li>Scaling out lowers variance and caps upside — a real trade-off, decided while flat.</li>
  <li>Breakeven stops are not free; place them at structure and check their cost in your journal.</li>
  <li>After a partial fill, immediately reconcile stop and target quantity with the position you actually hold.</li>
</ul>
$html$, 6),

('execution-checklist', 'The Execution Checklist', $html$
<p>You have a setup, a size, and a plan. This lesson turns everything in this course into a fixed sequence you run on every trade, and a way to measure how well you ran it. Execution quality is a skill with its own statistics, separate from strategy quality — and it improves only if you track it separately.</p>

<h2>Before the session</h2>
<ul>
  <li><strong>Check the calendar.</strong> What is scheduled today, at what time, and what will you do — flatten, size down, or stand aside?</li>
  <li><strong>Confirm your trading window.</strong> Based on your own hour-of-day expectancy, which hours are you permitted to trade today?</li>
  <li><strong>Verify the platform.</strong> Connection, correct account, correct instrument, correct default quantity. A trade sent to the wrong account at the wrong size is an entirely avoidable loss.</li>
  <li><strong>Note the current spread</strong> versus its normal level. Unusually wide before you start is information about the whole session.</li>
</ul>

<h2>At the trade — seven steps, in order</h2>
<ol>
  <li><strong>Name the setup.</strong> It must exist in your playbook. If you cannot name it, it is not a trade.</li>
  <li><strong>Mark the stop level first.</strong> Structure decides the stop; the stop then decides everything else.</li>
  <li><strong>Size from the stop.</strong> Formula only, using the method from the Risk Management course.</li>
  <li><strong>Check cost against the stop.</strong> Spread plus expected slippage as a percentage of stop distance. If it is above roughly 10%, the trade needs a wider stop, a better moment, or to be skipped.</li>
  <li><strong>Choose the order type deliberately.</strong> Limit if the price is the edge; market or stop-entry if missing the move costs more than the fill.</li>
  <li><strong>Submit the bracket with the entry.</strong> Stop and target live in the market, not in your head.</li>
  <li><strong>Log it before you watch it.</strong> Setup tag, planned entry, planned stop, planned target, one sentence of reasoning — recorded while the outcome is still unknown.</li>
</ol>
<p>If you use trade templates, encode the first six steps into one so the checklist is enforced by the tool rather than by memory. The fastest reliable execution comes from having decided in advance, not from clicking faster.</p>

<h2>After the trade: score the execution, not the result</h2>
<p>Add three execution fields to every closed trade in your journal:</p>
<ul>
  <li><strong>Entry slippage</strong> — planned entry versus fill, in R.</li>
  <li><strong>Exit slippage</strong> — planned stop or target versus actual fill, in R.</li>
  <li><strong>Checklist compliance</strong> — did all seven steps happen, yes or no.</li>
</ul>
<p>Then run two slices at your monthly review. First, average slippage by instrument and by hour: this tells you where your execution costs live, and it is usually concentrated rather than spread evenly. Second, expectancy split by checklist compliance. A trader who finds compliant trades at +0.31R and non-compliant at −0.22R now has the most valuable number in their journal — a direct measurement of what skipping their own process costs, in R, on real trades.</p>

<blockquote>Strategy decides which trades you take. Execution decides how much of that decision survives to your account.</blockquote>

<h2>The failure mode to watch for</h2>
<p>Checklists decay under pressure. They get skipped on the trade that "obviously" works, in the fast market, at the end of a losing day — precisely the trades where they matter most. Two defences that hold up: keep the checklist short enough to run in under thirty seconds, and treat a skipped checklist as a logged mistake tag even when the trade wins. A tag that only appears on losers teaches you nothing, as the Journal course covers.</p>
<p>Execution is the least glamorous part of trading and one of the most improvable. Costs, order choice, timing and process compliance are all fully within your control, and unlike your win rate, none of them requires the market's cooperation to get better.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Run a pre-session check: calendar, permitted hours, platform state, current spread.</li>
  <li>At the trade: name the setup, mark the stop, size from it, check cost against stop distance, choose the order type, submit the bracket, log before watching.</li>
  <li>Encode the repeatable parts into trade templates so the tool enforces the process.</li>
  <li>Score entry slippage, exit slippage, and checklist compliance on every closed trade.</li>
  <li>Compare expectancy for compliant versus non-compliant trades — that gap is the price of skipping your own process.</li>
</ul>
$html$, 7)

) as v(slug, title, body, ord)
on conflict (course_id, slug) do nothing;

-- ---------------------------------------------------------------------------
-- Quiz questions (2 per lesson, one correct option each). Guarded per prompt.
-- ---------------------------------------------------------------------------
do $$
declare
  q record;
  lid uuid;
  qid uuid;
  i int;
begin
  for q in
    select * from (values
      ('execution-mechanics','order-types','A limit order guarantees…', 1,
        array['Price or better, but not that you get filled','That you get filled, but not at what price','Both price and execution'], 1),
      ('execution-mechanics','order-types','Why is a stop-limit a poor choice for a protective stop?', 2,
        array['Price can gap through the limit, leaving you unfilled in a position moving against you','It costs more in commission','It cannot be submitted as part of a bracket'], 1),
      ('execution-mechanics','the-spread','The right way to judge whether a spread is expensive is…', 1,
        array['As a percentage of your stop distance','In ticks or pips','Against the broker''s advertised average'], 1),
      ('execution-mechanics','the-spread','Spreads typically widen…', 2,
        array['Around scheduled news, outside main sessions, and during volatility spikes','Only when a broker changes its pricing model','Steadily throughout the trading day'], 1),
      ('execution-mechanics','slippage','Which type of slippage most damages a strategy''s expectancy?', 1,
        array['Stop slippage — it pushes your average loss above 1R','Entry slippage on limit orders','Slippage on profitable exits'], 1),
      ('execution-mechanics','slippage','What protects you against gap risk?', 2,
        array['Position size — no order type can prevent a gap','A stop-limit order','Placing stops at round numbers'], 1),
      ('execution-mechanics','total-cost-of-a-trade','The four components of a trade''s true cost are…', 1,
        array['Commission, spread, slippage, and financing','Commission, taxes, slippage, and platform fees','Spread, leverage, margin, and commission'], 1),
      ('execution-mechanics','total-cost-of-a-trade','Why does the same cost per R matter far more to a scalper than a swing trader?', 2,
        array['Cost scales with trade frequency, so hundreds of trades multiply it','Scalpers pay higher commission rates','Swing traders are exempt from spread costs'], 1),
      ('execution-mechanics','liquidity-and-timing','A breakout attempted during the midday lull tends to fail more often because…', 1,
        array['There is too little participation to carry the move','Spreads are narrowest then','Algorithms are switched off at midday'], 1),
      ('execution-mechanics','liquidity-and-timing','High volume during a fast, thin move means…', 2,
        array['Volume and liquidity are not the same — depth can still be poor','Liquidity is good, so fills will be tight','The move is guaranteed to continue'], 1),
      ('execution-mechanics','scaling-and-partials','Adding to a losing position without a pre-written plan is…', 1,
        array['Averaging down — it turns a 1R loss into a much larger one','Scaling in, which is a standard technique','Acceptable if the original setup is still valid'], 1),
      ('execution-mechanics','scaling-and-partials','After a partial fill, the first thing to correct is…', 2,
        array['Stop and target quantity, so no working order can open a new position','Your entry price, by chasing the remainder','Your setup tag in the journal'], 1),
      ('execution-mechanics','execution-checklist','In the seven-step sequence, what comes immediately after naming the setup?', 1,
        array['Marking the stop level, because structure decides the stop','Choosing the order type','Calculating the target'], 1),
      ('execution-mechanics','execution-checklist','Comparing expectancy for checklist-compliant versus non-compliant trades tells you…', 2,
        array['What skipping your own process costs, measured in R','Whether your strategy has an edge','Which broker gives better fills'], 1)
    ) as t(course_slug, lesson_slug, prompt, ord, options, correct_idx)
  loop
    select l.id into lid from public.lessons l
      join public.courses c on c.id = l.course_id
      where c.slug = q.course_slug and l.slug = q.lesson_slug;
    if lid is not null and not exists (
      select 1 from public.quiz_questions where lesson_id = lid and prompt = q.prompt
    ) then
      insert into public.quiz_questions (lesson_id, prompt, ord) values (lid, q.prompt, q.ord)
        returning id into qid;
      for i in 1..array_length(q.options, 1) loop
        insert into public.quiz_options (question_id, label, is_correct, ord)
          values (qid, q.options[i], i = q.correct_idx, i);
      end loop;
    end if;
  end loop;
end $$;
