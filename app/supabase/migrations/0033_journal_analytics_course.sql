-- Journal & Edge Analytics course (free tier, ord 5). Teaches the review habit
-- that the TradingSocial journal + analytics pages are built around.
-- Idempotent: safe to re-run.

insert into public.courses (slug, title, summary, difficulty, ord, min_tier, published) values
  ('journal-analytics', 'The Trading Journal: Review & Edge Analytics', 'Turn your trades into data: what to log, how to tag it, what the numbers actually say, and the review loop that finds your edge.', 'beginner', 5, 'free', true)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Lessons
-- ---------------------------------------------------------------------------
with c as (select id from public.courses where slug = 'journal-analytics')
insert into public.lessons (course_id, slug, title, body, ord, xp_reward, published)
select c.id, v.slug, v.title, v.body, v.ord, 100, true from c, (values

('why-journal', 'Why Memory Is a Bad Trading Partner', $html$
<p>Ask a trader how last month went and you will get a story. Ask their journal and you get a number. The two rarely match, and the gap between them is where accounts quietly bleed out.</p>

<h2>Memory edits the tape</h2>
<p>Your brain is not a hard drive. It is a storyteller optimised for a comfortable narrative, and it edits your trading history in three predictable ways:</p>
<ul>
  <li><strong>Recency bias.</strong> The last three trades feel like the whole month. Two bad days at the end of a green month convince you that you are "in a slump" when the equity curve says otherwise.</li>
  <li><strong>Hindsight bias.</strong> After the fact, every move looks obvious. You remember "knowing" the breakout would fail — you did not know, you considered it. Without a written record there is no way to separate a prediction you made from one you only wish you had made.</li>
  <li><strong>Outcome bias.</strong> A reckless trade that paid gets filed as skill. A perfectly executed trade that lost gets filed as a mistake. Over a few hundred trades, this quietly teaches you the exact opposite of what worked.</li>
</ul>

<h2>What the record actually changes</h2>
<p>A journal does not make you disciplined by magic. It changes three concrete things.</p>
<p>First, it makes patterns visible at a size no memory can hold. You will never notice from feel that eleven of your last fifteen losses came in the first twenty minutes after the open. Fifteen rows in a table make it obvious in seconds.</p>
<p>Second, it creates accountability at the moment of entry. Knowing you will have to write down <em>why</em> you took a trade filters out a surprising number of trades that had no reason at all. Many traders find their impulsive entries drop sharply in the first week of journaling, before they have analysed a single statistic.</p>
<p>Third, it separates process from outcome. When you record the plan alongside the result, a losing trade that followed the plan and a winning trade that broke it stop looking the same. That distinction is the whole basis of improvement — you cannot control results, only the decisions that produce them.</p>

<blockquote>You are not journaling to remember your trades. You are journaling because you will not.</blockquote>

<h2>The objection, and the answer</h2>
<p>"My broker already has my history." Your broker has fills. It knows you bought 200 shares at 41.30 and sold at 40.85. It does not know that the setup was a pullback you had never traded before, that you sized up because the previous trade lost, or that you moved the stop twice. The broker records what happened to your money. The journal records what happened in your decision-making, and only one of those is fixable.</p>
<p>"I only take a few trades a week." Then your sample builds slowly and you need every single row. Low-frequency traders benefit more from journaling, not less, because they cannot rely on volume to average out sloppy habits.</p>
<p>The rest of this course is practical: what to write down, how to tag it so it becomes data, which numbers actually mean something, and the review loop that converts all of it into changes to how you trade.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Memory rewrites your trading history through recency, hindsight, and outcome bias.</li>
  <li>A written record makes multi-trade patterns visible that no amount of feel can detect.</li>
  <li>Journaling filters impulsive entries the moment it becomes a habit — before any analysis.</li>
  <li>Broker statements record money; a journal records decisions, and only decisions are fixable.</li>
</ul>
$html$, 1),

('what-to-log', 'What to Log — and What to Skip', $html$
<p>The most common journaling failure is not laziness. It is ambition. A trader builds a thirty-column spreadsheet, fills it in beautifully for nine days, and never opens it again. A journal you abandon is worth less than a scruffy one you keep.</p>

<h2>The minimum viable trade record</h2>
<p>Every trade needs enough detail to answer two questions later: <em>was this a trade I should have taken?</em> and <em>did I execute it as planned?</em> That takes about eight fields:</p>
<ul>
  <li><strong>Instrument and direction.</strong> What you traded and which way.</li>
  <li><strong>Date and time of entry.</strong> Time matters more than most beginners expect — session and hour are two of the most revealing slices you will ever run.</li>
  <li><strong>Setup name.</strong> The named pattern from your playbook. If you cannot name it, that itself is data.</li>
  <li><strong>Entry, stop, and target.</strong> The prices as <em>planned</em>, recorded before or at entry.</li>
  <li><strong>Position size.</strong> Enough to reconstruct the risk you actually took.</li>
  <li><strong>Result in R.</strong> Not just currency. Covered in the Risk Management course — R is what makes trades of different sizes comparable.</li>
  <li><strong>Exit price and time.</strong> What really happened.</li>
  <li><strong>One sentence of context.</strong> Why you took it, in your own words.</li>
</ul>
<p>That is the floor. A trader logging only this for two hundred trades has a far more useful dataset than one logging forty fields for twenty trades.</p>

<h2>Log the plan before the outcome exists</h2>
<p>The single highest-value habit in this lesson: write entry, stop, target and reason <strong>at entry</strong>, not at exit. Fields filled in afterwards are contaminated. If you record your target after you have already exited, you will unconsciously record a target near where you got out, and your "target hit rate" becomes a meaningless number that always flatters you.</p>
<p>A journal built after the fact tells you what your account did. A journal built at entry tells you whether your judgement is any good — which is the whole point.</p>

<h2>What to skip</h2>
<p>Resist these until you have a few hundred trades and a specific question:</p>
<ul>
  <li><strong>Indicator readings.</strong> RSI at entry, MACD state, six moving-average positions. Enormous effort, and almost nobody ever slices by them.</li>
  <li><strong>Long freeform essays per trade.</strong> Unsearchable, unsliceable, and the first thing you stop writing when you are busy.</li>
  <li><strong>Macro commentary.</strong> What the Fed did is not a property of your trade.</li>
</ul>
<p>The test for any field: <em>could this become a column I filter or group by?</em> "Setup = pullback" passes. "Market felt heavy today" does not.</p>

<blockquote>If a field cannot become a filter, it is a diary entry, not a data point.</blockquote>

<h2>Make it a two-minute job</h2>
<p>Log at entry, close out at exit, and keep the whole thing under two minutes per trade. Do it the same way every time — same fields, same order, same vocabulary. Consistency is what lets you group two hundred rows later; a journal where "pullback", "PB", and "retrace" all appear is three datasets pretending to be one.</p>
<p>One screenshot at entry is the only optional extra worth adding early. It costs seconds and preserves the one thing text cannot: what the chart actually looked like when you decided.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Eight fields kept consistently beat thirty fields abandoned in week two.</li>
  <li>Record entry, stop, target and reason <em>at entry</em> — fields filled in later are contaminated by the outcome.</li>
  <li>Log results in R so trades of different sizes are comparable.</li>
  <li>Skip any field you will never filter or group by.</li>
  <li>Use identical wording every time; inconsistent labels destroy your ability to group trades.</li>
</ul>
$html$, 2),

('tagging-your-trades', 'Tagging: Turning Trades Into Data', $html$
<p>A logged trade is a record. A tagged trade is a data point. Tags are what let you ask "how do I perform on breakouts, in the first hour, when I broke a rule?" and get an answer in one click instead of an afternoon of scrolling.</p>

<h2>Three tag families, and only three</h2>
<p>Keep your tagging scheme to three dimensions. More than that and nothing accumulates a usable sample.</p>
<ul>
  <li><strong>Setup tags — what you traded.</strong> The named patterns in your playbook: <code>pullback-trend</code>, <code>range-fade</code>, <code>breakout-retest</code>. This is the highest-value tag family, because it answers which of your strategies actually earns.</li>
  <li><strong>Mistake tags — how you deviated.</strong> <code>early-entry</code>, <code>moved-stop</code>, <code>oversized</code>, <code>no-setup</code>, <code>cut-winner-early</code>, <code>revenge-trade</code>. Applied to <em>every</em> trade, winners included — a winner that broke your rules still gets the tag.</li>
  <li><strong>State tags — how you were.</strong> Tired, rushed, calm, distracted. One word. This connects to the Trading Psychology course, where the cost of these states is the whole subject.</li>
</ul>

<h2>Keep the vocabulary brutally small</h2>
<p>Twelve setup tags is not thoughtfulness, it is fragmentation. Split across a hundred trades, twelve tags gives you eight trades each and no group large enough to conclude anything. Three to five setup tags and six to eight mistake tags is plenty for most traders' first year.</p>
<p>Two rules keep a scheme clean. First, tags must be <strong>mutually exclusive within a family</strong> — a trade is one setup, not two. If you keep wanting to apply two setup tags, your setup definitions overlap and need rewriting. Second, <strong>never invent a tag mid-session</strong>. Write it on a list, decide during the weekly review, then apply it going forward.</p>

<h2>Tag the process, not the result</h2>
<p>The most abused tag in existence is one that means "bad trade". Almost every trader who creates it applies it to losers and withholds it from winners, which converts the tag into a duplicate of the P&amp;L column and teaches you nothing.</p>
<p>Tag what you <em>did</em>, independent of what happened. A trade where you entered two candles early and it still paid gets <code>early-entry</code>. When you later filter by <code>early-entry</code> and find those trades return −0.2R on average across forty samples, you have discovered something real — and you would have missed it entirely if you had only tagged the ones that lost.</p>

<blockquote>A tag that only appears on losing trades is not a tag. It is the P&amp;L column wearing a costume.</blockquote>

<h2>The payoff, concretely</h2>
<p>Consider a trader with 180 journaled trades, roughly breakeven overall, ready to quit. Their tags reveal:</p>
<ul>
  <li><code>pullback-trend</code>: 74 trades, +0.34R average.</li>
  <li><code>range-fade</code>: 61 trades, −0.29R average.</li>
  <li><code>breakout-retest</code>: 45 trades, +0.02R average.</li>
</ul>
<p>They do not have a broken system. They have one strategy that works being cancelled out by one that does not. Without tags, that is invisible — the account shows a flat line and the trader concludes "nothing works". With tags, the next month's plan writes itself. That single decision is worth more than any indicator they could have added.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Use three tag families only: setup, mistake, and state.</li>
  <li>Keep the vocabulary small — three to five setup tags — so groups reach a usable size.</li>
  <li>Apply mistake tags to winners too; tags describe process, not outcome.</li>
  <li>Never invent tags mid-session; add them deliberately during review.</li>
  <li>Tagging is what exposes a profitable strategy hidden underneath a losing one.</li>
</ul>
$html$, 3),

('win-rate-vs-expectancy', 'Win Rate Lies, Expectancy Tells', $html$
<p>"What's your win rate?" is the most asked and least useful question in trading. A 30% win rate can be an excellent business and a 75% win rate can be a slow bankruptcy. On its own the number is meaningless, because it says nothing about how big the wins and losses are.</p>

<h2>The number that actually matters</h2>
<p>Expectancy is the average result of a trade in your system, expressed in R. Using the R-multiples you met in the Risk Management course:</p>
<p><strong>Expectancy = (win rate × average win in R) − (loss rate × average loss in R)</strong></p>
<p>Two traders, same instrument, same month:</p>
<ul>
  <li>Trader A: wins 70% of the time, average win 0.5R, average loss 1.4R. Expectancy = (0.7 × 0.5) − (0.3 × 1.4) = 0.35 − 0.42 = <strong>−0.07R</strong>. Losing money while winning most days.</li>
  <li>Trader B: wins 35% of the time, average win 2.6R, average loss 0.9R. Expectancy = (0.35 × 2.6) − (0.65 × 0.9) = 0.91 − 0.585 = <strong>+0.325R</strong>. Loses most trades, makes money.</li>
</ul>
<p>Trader A feels like a good trader every day and is not. That feeling is exactly why win rate is so seductive and so dangerous.</p>

<h2>Reading expectancy properly</h2>
<p>Expectancy is per trade, so it multiplies with frequency. +0.2R over 40 trades a month is +8R a month; the same +0.2R over 4 trades is +0.8R. Frequency and expectancy together determine your return — and frequency is usually the easier of the two to change, as long as the extra trades are the same quality.</p>
<p>Two guardrails. Expectancy under about 30 trades is noise, not a measurement — a single outsized winner can swing it. And always recompute it excluding your best and worst trade; if removing one trade flips the sign, you have one lucky result, not an edge.</p>

<h2>The supporting cast</h2>
<ul>
  <li><strong>Profit factor</strong> — gross profit divided by gross loss. Above 1.0 is profitable; 1.5 or better is a comfortable business. It is expectancy's ratio-shaped sibling and is quick to eyeball.</li>
  <li><strong>Average win / average loss (payoff ratio).</strong> Paired with win rate, this tells you which lever to pull. Below 1.0 with a low win rate is the classic bleed profile.</li>
  <li><strong>Largest loss in R.</strong> The honesty check. If your planned risk is 1R and your largest loss is 4.5R, you have a discipline problem, and no expectancy number is trustworthy until it is fixed.</li>
</ul>

<blockquote>Win rate tells you how often you are right. Expectancy tells you whether being right that often is worth anything.</blockquote>

<h2>Which lever to pull</h2>
<p>Expectancy has exactly three inputs, so improvement has exactly three routes: win more often, win bigger, or lose smaller. Most traders instinctively chase the first — a better entry, a cleaner filter — when the other two are usually easier. Letting winners run one extra structural level lifts average win. Sizing by formula and never widening a stop caps average loss. Both are execution changes you control completely, whereas win rate depends on the market cooperating.</p>
<p>And note what happens when you cut your worst-performing setup tag from the last lesson: loss rate falls and average loss falls at once. Removing a strategy is often the fastest expectancy improvement available.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Win rate alone is uninformative; expectancy in R is the real measure of a system.</li>
  <li>Expectancy = (win rate × avg win R) − (loss rate × avg loss R).</li>
  <li>Under ~30 trades expectancy is noise; recheck it with your best and worst trade removed.</li>
  <li>Profit factor, payoff ratio, and largest loss in R are the useful supporting stats.</li>
  <li>Raising average win and cutting average loss are usually easier levers than raising win rate.</li>
</ul>
$html$, 4),

('reading-your-equity-curve', 'Reading Your Own Equity Curve', $html$
<p>Your equity curve is the only chart you own that is genuinely about you. Everything on it was caused by a decision you made. Learning to read its <em>shape</em> — not its endpoint — is how you tell a normal rough patch from a system that has stopped working.</p>

<h2>Shape beats endpoint</h2>
<p>Two traders both end the quarter up 14R. One climbed in a steady stair-step with shallow dips. The other spent two months down 9R, then made 23R in nine days off three enormous winners. Identical results, completely different businesses. The second trader's edge is unproven and their risk of ruin is high — if those three trades had landed a week later, they would have blown up first.</p>
<p>Read four properties every time:</p>
<ul>
  <li><strong>Slope.</strong> Is the general direction up, flat, or down over the last hundred trades?</li>
  <li><strong>Drawdown depth.</strong> How far from peak to trough, in R.</li>
  <li><strong>Drawdown duration.</strong> How many trades to make a new high. Duration hurts psychologically more than depth.</li>
  <li><strong>Smoothness.</strong> Are gains spread across many trades or concentrated in a handful of outliers?</li>
</ul>
<p>Plot it in R rather than currency. Currency mixes your results with changes in position size, so a curve in currency can rise purely because you started trading bigger. R strips size out and shows decision quality alone.</p>

<h2>Curve shapes and what they mean</h2>
<ul>
  <li><strong>The staircase.</strong> Steady climb, shallow dips. A repeatable edge executed consistently. Do not touch anything; the correct action is more trades of exactly the same kind.</li>
  <li><strong>The sawtooth.</strong> Grind up, sharp vertical drops, grind up again. Classic signature of a decent strategy with poor loss control — the drops are oversized losses or revenge sequences, not the strategy failing. Fix the drops and the curve becomes a staircase.</li>
  <li><strong>The plateau.</strong> Long flat stretch after a rising period. Usually one of two things: your setup's conditions are absent from the current market, or you have started taking marginal trades that net to zero. Your setup tags tell you which.</li>
  <li><strong>The cliff.</strong> One drop that erases weeks. Always a sizing failure, never a strategy failure. No sequence of correctly sized 1R losses produces a cliff.</li>
</ul>

<h2>Variance or breakage?</h2>
<p>The hardest question in trading: is this a normal losing streak or is my edge gone? The curve alone cannot answer it — you need the journal underneath. Three checks:</p>
<ul>
  <li><strong>Compliance.</strong> During the drawdown, what share of trades followed your rules? Above 90% with losses anyway points to variance. Below 70% and you are not testing your strategy, you are testing your discipline.</li>
  <li><strong>Setup composition.</strong> Are you still trading the same setups, or has the drawdown quietly filled with trades tagged as marginal or unplanned?</li>
  <li><strong>Depth against history.</strong> A 9R drawdown is alarming if your worst previous was 5R; it is unremarkable if you have had three like it and recovered each time.</li>
</ul>
<p>Even a healthy system with +0.3R expectancy and a 40% win rate will produce runs of seven or eight consecutive losses over a few hundred trades. That is arithmetic, not failure.</p>

<blockquote>A drawdown with high rule-compliance is a weather report. A drawdown with low compliance is a diagnosis.</blockquote>

<h2>Key takeaways</h2>
<ul>
  <li>Plot equity in R, not currency, so position sizing does not distort the picture.</li>
  <li>Judge slope, drawdown depth, drawdown duration, and smoothness — not the final number.</li>
  <li>Sawtooth means loss control; plateau means missing conditions or marginal trades; a cliff is always sizing.</li>
  <li>Distinguish variance from breakage using rule-compliance, setup composition, and drawdown history.</li>
  <li>Long losing streaks are normal even in profitable systems.</li>
</ul>
$html$, 5),

('finding-your-edge', 'Finding the Edge Hiding in Your Data', $html$
<p>By now you have consistent records, clean tags, and a way to read the aggregate. This lesson is the payoff: systematically interrogating your own history until it tells you what to keep, what to cut, and what to leave alone.</p>

<h2>Slice in a fixed order</h2>
<p>Run the same four slices every month, in this order, computing expectancy in R and trade count for each group.</p>
<ul>
  <li><strong>By setup tag.</strong> Which named strategies earn? Usually the single most actionable slice, and often the one that reveals a winning strategy being cancelled by a losing one.</li>
  <li><strong>By time.</strong> Hour of day and day of week. Many traders find one specific window — commonly the first thirty minutes, or the last hour of a session — where their expectancy is sharply negative.</li>
  <li><strong>By instrument.</strong> Traders frequently discover they are profitable across their whole book except for one symbol they keep trading out of familiarity.</li>
  <li><strong>By mistake tag.</strong> What does each deviation actually cost in R? This converts "I should stop moving my stops" from a resolution into a number.</li>
</ul>
<p>Fixed order matters because it stops you from hunting. Wandering through your data looking for something interesting guarantees you will find something — and it will usually be noise.</p>

<h2>Sample size, honestly</h2>
<p>The fastest way to ruin a journal is to act on eight trades. Rough thresholds for a group before you draw conclusions:</p>
<ul>
  <li><strong>Under 20 trades:</strong> observation only. Note it, do nothing.</li>
  <li><strong>20–50 trades:</strong> a hypothesis worth watching, and enough to justify reducing size on a bad group.</li>
  <li><strong>50+ trades:</strong> strong enough to cut a setup or a time window entirely.</li>
</ul>
<p>Beware the multiple-comparisons trap. If you slice your history twenty different ways, one slice will look brilliant purely by chance. A finding is only worth acting on if it (a) clears the sample threshold, (b) came from your fixed slice list rather than a fishing expedition, and (c) has a mechanical reason you can articulate. "My range fades lose because I trade them in trending markets" is a reason. "Tuesdays are bad" is a coincidence waiting to reverse.</p>

<blockquote>Anything you find by looking hard enough, you found by looking hard enough.</blockquote>

<h2>Change one thing at a time</h2>
<p>Suppose the review says: cut range-fades, stop trading the first fifteen minutes, and stop moving stops. All three look justified. Change all three at once and next month is uninterpretable — if results improve you will not know which change did it, and if they worsen you cannot tell which to undo.</p>
<p>Make one change per review cycle, write it down with the date and the evidence behind it, then let it run for at least thirty trades before judging. This is slower than it feels like it should be, and it is the only method that compounds. Traders who overhaul monthly never accumulate a clean sample of anything.</p>

<h2>Do not optimise away your edge</h2>
<p>One warning as you cut. Every filter you add shrinks your trade count, and expectancy multiplies by frequency. A trader who filters until only their three best conditions remain may lift expectancy from 0.2R to 0.5R while dropping from 40 trades a month to 6 — from +8R to +3R. Removing genuinely negative groups is nearly always right. Trimming merely mediocre ones often is not.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Slice by setup, time, instrument, and mistake tag — in the same fixed order every month.</li>
  <li>Under 20 trades observe; 20–50 hypothesise; 50+ act decisively.</li>
  <li>Require a mechanical explanation, not just a favourable number, before acting.</li>
  <li>One change per review cycle, dated and evidenced, judged over 30+ trades.</li>
  <li>Cut negative groups, not mediocre ones — over-filtering trades away your total return.</li>
</ul>
$html$, 6),

('the-review-loop', 'The Review Loop: Building It in TradingSocial', $html$
<p>Everything so far was preparation. This lesson assembles it into a running system — a daily, weekly, monthly and quarterly loop — and shows exactly where each step lives in your TradingSocial journal, so the habit has a home rather than depending on willpower.</p>

<h2>Daily: capture, two minutes</h2>
<p>At entry, log the trade with the fields from lesson two — instrument, direction, setup tag, planned entry, stop and target, size, and one sentence of reasoning. At exit, close it out and add your mistake and state tags. That is the entire daily obligation.</p>
<p>End the session with one written line: what you did well and what you would repeat. Not analysis — you do not have the sample for analysis after one day, and daily P&amp;L is almost pure noise. The daily job is capture and nothing else. Your journal's calendar view will start filling in as the record accumulates.</p>

<h2>Weekly: compliance, thirty minutes</h2>
<p>Once a week, sit down with the whole week's trades and ask process questions only:</p>
<ul>
  <li>What percentage of trades matched a setup in my playbook?</li>
  <li>Which mistake tags appeared, and how many times each?</li>
  <li>Was every position sized by formula, and was my largest loss within planned risk?</li>
  <li>Did any state tag cluster with the bad trades?</li>
</ul>
<p>Deliberately ignore P&amp;L here. A week is far too small a sample for outcome conclusions, and looking at it will bias every other answer. The weekly review card in your journal is built around exactly this: it surfaces rule adherence and streaks rather than profit, which is the point.</p>

<h2>Monthly: performance, ninety minutes</h2>
<p>This is the analytical session — the one from the previous lesson. Run the four slices in order using the strategy breakdown, mistake analysis, and risk tracking views in your journal, read the equity curve for shape, and compute expectancy for the month and for the trailing hundred trades.</p>
<p>Then produce exactly three outputs, written down and dated:</p>
<ul>
  <li><strong>One thing to keep doing</strong> — with the evidence line that supports it.</li>
  <li><strong>One change</strong> — the single highest-value adjustment, with its evidence.</li>
  <li><strong>One thing to watch</strong> — a pattern that has not yet reached sample size.</li>
</ul>
<p>Export the month's report so you have a fixed snapshot. Next month's review starts by reading last month's, which is what turns a series of reviews into a loop rather than a repeating ritual.</p>

<h2>Quarterly: strategy, half a day</h2>
<p>Every three months you have roughly a hundred to three hundred trades — enough to ask bigger questions. Is my overall expectancy improving across quarters? Is the strategy mix I traded this quarter the one I intended? Did each of last quarter's three monthly changes work, and can I now point to the numbers that show it? Is my risk per trade still appropriate for the account size?</p>
<p>The quarterly review is the only place where large changes belong — adding a new setup to the playbook, retiring one permanently, or adjusting base risk. Everything smaller than that gets handled monthly.</p>

<blockquote>Daily you capture. Weekly you check the process. Monthly you change one thing. Quarterly you change direction. Confuse the timescales and you will react to noise.</blockquote>

<h2>Making the loop survive contact with a bad week</h2>
<p>Reviews get skipped after losing weeks, which is precisely when they matter most — the drawdown lesson only works if the data exists. Three defences: schedule the weekly review at a fixed time and treat it as non-negotiable; keep the daily capture short enough that a bad day cannot make it feel like punishment; and separate reviewing from trading so a review never turns into a session of re-litigating individual losses.</p>
<p>You now have the full system. Log consistently, tag with a small vocabulary, judge by expectancy rather than win rate, read the curve for shape, slice in a fixed order, and change one thing per cycle. It is unglamorous, and it is the closest thing to a reliable edge that most traders ever build.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Daily is capture only — two minutes, no analysis, no P&amp;L conclusions.</li>
  <li>Weekly reviews judge process and rule compliance, deliberately ignoring profit.</li>
  <li>Monthly reviews run the four slices and produce exactly one keep, one change, one watch — dated and evidenced.</li>
  <li>Quarterly reviews are the only place for large strategy or risk changes.</li>
  <li>Protect the loop after losing weeks by fixing the schedule and keeping daily capture short.</li>
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
      ('journal-analytics','why-journal','A reckless trade that happened to pay gets remembered as skill. This is…', 1,
        array['Outcome bias','Recency bias','Loss aversion'], 1),
      ('journal-analytics','why-journal','Why is a broker statement not a substitute for a journal?', 2,
        array['It records fills, not the decisions that produced them','It updates too slowly','It excludes commissions'], 1),
      ('journal-analytics','what-to-log','Entry, stop, target and reason should be recorded…', 1,
        array['At entry — fields filled in later are contaminated by the outcome','At exit, when the full picture is known','During the weekly review'], 1),
      ('journal-analytics','what-to-log','The test for whether a field belongs in your journal is…', 2,
        array['Could it become a column you filter or group by?','Is it hard to remember?','Does it relate to the market that day?'], 1),
      ('journal-analytics','tagging-your-trades','A trade where you entered two candles early but still profited should…', 1,
        array['Get the early-entry mistake tag anyway — tags describe process, not outcome','Get no mistake tag, since it worked','Get a positive tag for good instincts'], 1),
      ('journal-analytics','tagging-your-trades','Why keep setup tags to three to five?', 2,
        array['Too many tags fragment your history so no group reaches a usable sample','Databases perform poorly with many tags','More tags make the journal harder to read'], 1),
      ('journal-analytics','win-rate-vs-expectancy','A trader wins 70% of trades, average win 0.5R, average loss 1.4R. Their expectancy is…', 1,
        array['Negative, at about −0.07R per trade','Positive, since they win most trades','Impossible to tell without the currency amounts'], 1),
      ('journal-analytics','win-rate-vs-expectancy','Which is usually the easiest lever for improving expectancy?', 2,
        array['Cutting average loss and letting winners run — both are execution you control','Raising win rate with a better entry filter','Increasing position size'], 1),
      ('journal-analytics','reading-your-equity-curve','A curve that grinds upward then drops sharply, repeatedly, most likely indicates…', 1,
        array['A workable strategy with poor loss control','A strategy that has stopped working','Correct position sizing with bad entries'], 1),
      ('journal-analytics','reading-your-equity-curve','During a drawdown, rule-compliance above 90% suggests…', 2,
        array['Variance — keep executing and change nothing yet','The edge is gone and the strategy needs replacing','Your rules are too easy to follow'], 1),
      ('journal-analytics','finding-your-edge','A slice showing a group of 8 trades at +0.9R expectancy should be…', 1,
        array['Noted only — the sample is far too small to act on','Scaled up immediately, since it is clearly your best setup','Discarded as a data error'], 1),
      ('journal-analytics','finding-your-edge','Why make only one change per review cycle?', 2,
        array['Multiple simultaneous changes make the next period''s results uninterpretable','Brokers limit how often strategies can change','Because one change is all most traders can remember'], 1),
      ('journal-analytics','the-review-loop','The weekly review should deliberately ignore…', 1,
        array['P&L — a week is too small a sample and it biases every other answer','Mistake tags, which belong in the monthly review','Position sizing, which is set in advance'], 1),
      ('journal-analytics','the-review-loop','Adding a new setup to your playbook or changing base risk belongs in the…', 2,
        array['Quarterly review','Daily capture','Weekly compliance review'], 1)
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
