-- Technical Analysis course (Trader pricing row): first Trader-only course.
-- Seven full-length lessons, two quiz questions each, 125 XP per lesson.
-- Sits between free courses (foundations, risk) and Pro (psychology).
-- Idempotent: course/lesson inserts guard on slug, questions guard on prompt.

insert into public.courses (slug, title, summary, difficulty, ord, min_tier, published) values
  ('technical-analysis', 'Technical Analysis: Structure & Setups', 'Read the chart like a market map: levels, trends, volume, patterns, and how to combine them into one written setup.', 'intermediate', 4, 'trader', true)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Lessons
-- ---------------------------------------------------------------------------
with c as (select id from public.courses where slug = 'technical-analysis')
insert into public.lessons (course_id, slug, title, body, ord, xp_reward, published)
select c.id, v.slug, v.title, v.body, v.ord, 125, true from c, (values

('support-resistance', 'Support and Resistance: Where Price Remembers', $html$
<p>Every chart has places where price arrived, stopped, and turned — not once, but again and again. Those places are not magic. They are memory: clusters of old decisions, trapped positions, and resting orders. Support and resistance are the closest thing technical analysis has to a foundation, and almost everything else in this course is built on top of them.</p>

<h2>What a level actually is</h2>
<p><strong>Support</strong> is a price area where buying has repeatedly overwhelmed selling — a floor the market has bounced from. <strong>Resistance</strong> is the mirror: an area where selling has repeatedly capped advances — a ceiling. The mechanism is human. Traders who bought at a level and watched it hold will buy there again. Traders who missed the first bounce wait for the retest. Traders trapped on the wrong side exit near break-even, adding fuel in the same direction. The level works partly <em>because</em> everyone can see it.</p>

<h2>Zones, not lines</h2>
<p>The single biggest beginner error is drawing levels as razor-thin lines and expecting price to respect them to the tick. Markets are auctions, not rulers. A level is a <strong>zone</strong> — often several ticks or dozens of pips deep — where interest concentrates. Draw a band that contains the cluster of highs or lows, wicks included. If price pierced your line by a fraction and reversed, the level didn't fail; your drawing was too precise.</p>

<h2>How to find levels worth drawing</h2>
<ul>
  <li><strong>Touches</strong> — the more times price has reversed in a zone, the more real it is. Two touches is a hypothesis; three or more is a level.</li>
  <li><strong>Reaction size</strong> — a zone that produced sharp, fast reversals matters more than one price drifted away from.</li>
  <li><strong>Timeframe</strong> — a level visible on the daily chart outranks one only visible on the 5-minute. Higher-timeframe levels are seen by more participants, so more orders live there.</li>
  <li><strong>Recency</strong> — fresh levels beat ancient ones. A zone last touched two years ago has mostly stale memory.</li>
</ul>
<p>If you need more than a few seconds to justify a level, it is not one. The levels that matter are the ones that jump off the chart before you reach for the drawing tool.</p>

<h2>Role reversal: the most useful behavior</h2>
<p>When support breaks decisively, it tends to become resistance — and broken resistance tends to become support. The logic: traders who bought the old support are now trapped underwater; when price rallies back to their entry, they sell to escape, capping the move. This <strong>flip</strong> is one of the most reliable behaviors on any chart, and the retest of a flipped level is a classic entry location: your stop goes just beyond the zone, giving a defined invalidation with the level itself as your reason.</p>
<blockquote>Amateurs trade at levels because the level is there. Professionals trade the <em>reaction</em> at the level — the level only tells them where to pay attention.</blockquote>

<h2>Key takeaways</h2>
<ul>
  <li>Support and resistance are zones of concentrated orders and memory — draw bands, not lines.</li>
  <li>Rank levels by touches, reaction size, timeframe, and recency.</li>
  <li>Broken support becomes resistance and vice versa; the retest of a flipped level is a high-quality entry location.</li>
  <li>A level is a place to watch for a reaction, never a reason to enter by itself.</li>
</ul>
$html$, 1),

('trend-structure', 'Trend Structure: Highs, Lows, and the Story Between', $html$
<p>"The trend is your friend" is repeated so often it has lost all meaning. What matters is that a trend is not a feeling or a colored line — it is a <strong>structure</strong>, defined precisely enough that two traders looking at the same chart should agree on it. This lesson gives you that definition.</p>

<h2>The definition</h2>
<p>An <strong>uptrend</strong> is a sequence of higher highs (HH) and higher lows (HL). A <strong>downtrend</strong> is lower lows (LL) and lower highs (LH). Anything else — highs and lows overlapping with no sequence — is a <strong>range</strong>. That's the entire taxonomy. Every chart, every timeframe, is always in exactly one of these three states, and your first job when opening any chart is to name the state out loud.</p>

<h2>Swing points are the skeleton</h2>
<p>The structure is built from <strong>swing points</strong>: a swing high is a peak with lower highs on both sides; a swing low is a trough with higher lows on both sides. Mark the significant swings — the ones a stranger would circle — and ignore the noise between them. Connect the reading to the previous lesson: significant swing lows in an uptrend are where support zones form, because that is where buyers proved themselves.</p>

<h2>When does a trend actually end?</h2>
<p>This is where most traders go wrong, calling reversals at every red candle. Structure gives you a mechanical answer. An uptrend weakens when price fails to make a new high (a lower high appears), and it <strong>breaks</strong> when price then takes out the last significant higher low. One warning, one confirmation. Until both happen, the trend is intact and every pullback is just that — a pullback.</p>
<blockquote>Trends don't end because they've "gone too far." They end when the structure breaks — and the structure is visible to anyone willing to mark the swings.</blockquote>

<h2>Trendlines: useful, overrated</h2>
<p>A trendline connecting successive higher lows can make a trend easier to see, and a well-tested line often acts as dynamic support. But the line is a <em>drawing of</em> the structure, not the structure itself. Price breaking a trendline while the HH/HL sequence stays intact means your line was drawn wrong, not that the trend ended. When trendline and swing structure disagree, trust the swings.</p>

<h2>Trading with, against, and without</h2>
<ul>
  <li><strong>With-trend</strong> — buying pullbacks to support in an uptrend. Highest win rate for developing traders: the market's momentum is doing part of the work.</li>
  <li><strong>Counter-trend</strong> — fading a trend at a level. Occasionally spectacular, usually expensive. Requires the trend to be exhausted, which you can rarely know in advance.</li>
  <li><strong>Range</strong> — buying range lows, selling range highs, until the range resolves. Valid, but recognize you're doing it; range tactics inside a trend get run over.</li>
</ul>
<p>Log which of the three you were doing on every trade in your journal. Most traders discover their counter-trend trades are a consistent net negative — a discovery worth more than any indicator.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Trend = HH/HL sequence up, LL/LH down; everything else is a range. Name the state before anything else.</li>
  <li>A trend breaks only after a failed new high/low <em>plus</em> a break of the last significant swing — one warning, one confirmation.</li>
  <li>Trust swing structure over trendlines when they disagree.</li>
  <li>Journal every trade as with-trend, counter-trend, or range — the stats will surprise you.</li>
</ul>
$html$, 2),

('moving-averages', 'Moving Averages: The Trend Made Visible', $html$
<p>A moving average is the simplest indicator that exists: the average closing price over the last N periods, redrawn every candle. That simplicity is its power — and the reason it is misused more than any other tool. This lesson covers what moving averages genuinely tell you, and the traps that empty accounts.</p>

<h2>SMA vs EMA</h2>
<p>The <strong>simple moving average (SMA)</strong> weights every period equally. The <strong>exponential moving average (EMA)</strong> weights recent prices more heavily, so it hugs price tighter and turns faster. Neither is "better": the EMA responds sooner and gets faked out more; the SMA is steadier and later. What matters far more than the flavor is <em>consistency</em> — pick one set and keep it, because the value of a moving average grows with how many other traders (and your own past decisions) share it. The most-watched settings are the 20 EMA (short-term trend), the 50 SMA (intermediate), and the 200 SMA (the line between bull and bear on any timeframe).</p>

<h2>Three honest uses</h2>
<ul>
  <li><strong>Trend filter.</strong> Price above a rising 200 SMA: look for longs only. Below a falling one: shorts only. This single filter, mechanically applied, would keep most losing traders out of most of their losing trades — not because the line is magic, but because it forces with-trend selection from the previous lesson.</li>
  <li><strong>Dynamic support and resistance.</strong> In a steady trend, pullbacks often stall at the 20 or 50 — not because the average pushes price, but because trend-followers cluster their orders there. Treat it like any zone: watch for the reaction, don't buy the touch blind.</li>
  <li><strong>Momentum read.</strong> The slope and separation of averages describe the trend's health. Averages fanned apart and sloping hard: strong trend. Flattening and braiding together: the trend is tired and a range is forming.</li>
</ul>

<h2>The crossover trap</h2>
<p>Crossovers (the "golden cross" of the 50 above the 200, and its bearish mirror) are the most famous moving-average signal and the most misunderstood. A moving average is a <em>lagging</em> summary of past prices — by the time two of them cross, the move that caused the cross already happened. In strong trends crossovers get you in late but in; in ranges they whipsaw you mercilessly, signaling buy at the top of every swing and sell at the bottom. A crossover is a description of what happened, occasionally useful as a regime label. It is not an entry signal.</p>
<blockquote>Moving averages don't predict. They summarize. Ask them "what has the market been doing?" — never "what will it do?"</blockquote>

<h2>The optimization trap</h2>
<p>The second trap is tweaking: testing the 13 EMA, then the 21, then the 34, hunting the setting that "would have worked." Any specific average will look prophetic on some past chart — that's curve-fitting, not edge. If your idea only works with the 27-period EMA and fails with the 20 and the 34, you don't have an idea; you have a coincidence.</p>

<h2>Key takeaways</h2>
<ul>
  <li>EMA turns faster, SMA is steadier; consistency of settings matters more than the choice. Know the 20, 50, and 200.</li>
  <li>Honest uses: trend filter, dynamic support/resistance zone, momentum health-check.</li>
  <li>Crossovers describe the past — lagging by construction, whipsaw-prone in ranges. Not an entry signal.</li>
  <li>If your setup only survives with one magic setting, it's curve-fitting, not edge.</li>
</ul>
$html$, 3),

('volume-truth', 'Volume: The Fuel Gauge', $html$
<p>Price tells you what happened; volume tells you how much conviction was behind it. Every candle you studied in Foundations was printed by actual transactions, and volume is the count of them. Two identical candles with wildly different volume are wildly different events — one is the market speaking, the other is noise in an empty room.</p>

<h2>The core principle: confirmation</h2>
<p>Healthy moves are fueled moves. In a trustworthy uptrend, volume expands on the rallies and contracts on the pullbacks — big effort in the trend direction, little interest against it. When that relationship inverts — rallies on shrinking volume, pullbacks on growing volume — the trend is running on fumes even while price still makes highs. Volume often deteriorates <em>before</em> structure breaks, which makes it an early-warning gauge for the trend-break rules from lesson two.</p>

<h2>Breakouts: the acid test</h2>
<p>Nowhere is volume more useful than at the levels you learned to draw in lesson one. A genuine breakout means the market has <em>accepted</em> price beyond the zone, and acceptance takes participation:</p>
<ul>
  <li><strong>Breakout on expanding volume</strong> (ideally a multiple of recent average) — real interest; the move has fuel; retests are likely to hold.</li>
  <li><strong>Breakout on thin volume</strong> — price poked through in a vacuum. These are the breakouts that collapse back into the range, trapping everyone who chased. Fading a low-volume failure back into the range is itself a classic setup.</li>
</ul>

<h2>Climax: exhaustion in one candle</h2>
<p>A <strong>volume climax</strong> is an extreme spike — several times average — after an extended move, usually with a huge candle. It reads like strength but often marks the end: a climax is where the last impatient buyers pile in and larger players finally have the liquidity to unload into them. An enormous green candle on enormous volume, followed by candles that make no further progress, is distribution wearing a bullish costume. Climax plus stall is one of the most reliable exhaustion reads on any chart.</p>
<blockquote>Volume is effort; price movement is result. When huge effort produces no result, someone is absorbing — and the move is closer to its end than its beginning.</blockquote>

<h2>Practical notes</h2>
<ul>
  <li>Volume is <strong>relative</strong>. Compare each bar to its own recent average (a 20-period volume MA works); absolute numbers mean nothing across instruments.</li>
  <li>Sessions have rhythm: opens and closes are naturally heavy, lunch hours naturally thin. Don't read the pattern as a signal.</li>
  <li>In decentralized markets (spot forex), your platform shows tick volume — the count of price changes, not true contract volume. Imperfect, but studies show it tracks real activity closely enough for relative readings.</li>
  <li>News releases print huge volume by definition. Volume analysis works best in the market's normal flow, not inside a scheduled announcement.</li>
</ul>

<h2>Key takeaways</h2>
<ul>
  <li>Volume measures conviction: healthy trends expand with the move and contract against it.</li>
  <li>Breakouts need expanding volume; thin-volume breakouts are trap material.</li>
  <li>A volume climax after an extended move signals exhaustion, not strength — especially when price stops progressing.</li>
  <li>Always read volume relative to its own recent average, and respect session rhythm.</li>
</ul>
$html$, 4),

('chart-patterns', 'Chart Patterns That Actually Matter', $html$
<p>Open any trading textbook and you'll find a zoo of patterns — wedges, pennants, cups, saucers, three ravens and a partridge in a pear tree. Here is the honest truth: patterns are just recurring shapes that structure, levels, and volume produce together. Learn a handful deeply, understand <em>why</em> they form, and you can safely ignore the rest of the zoo.</p>

<h2>Continuation: flags and triangles</h2>
<p>A <strong>flag</strong> is a strong directional move (the pole) followed by a shallow, drifting pullback (the flag). The logic: after an impulsive move, early buyers take profit while new buyers wait — a brief, low-volume digestion. When the digestion breaks in the trend direction on rising volume, the trend resumes. Everything you've learned stacks here: with-trend (lesson 2), volume contraction then expansion (lesson 4), and a defined invalidation below the flag's low.</p>
<p>A <strong>triangle</strong> is compression: swings getting smaller as buyers and sellers converge, volume drying up toward the apex. Compression must resolve — the market's energy coils, then releases. Trade the <em>breakout with volume</em>, not your guess about its direction; a triangle that breaks against the prior trend is telling you something changed.</p>

<h2>Reversal: double tops and head-and-shoulders</h2>
<p>A <strong>double top</strong> is resistance doing its job twice: price hits a zone, retreats, returns, and fails again — a lower high in the making. It confirms only when the low between the two peaks (the neckline) breaks. Before that break, it is just a range at highs.</p>
<p>The <strong>head and shoulders</strong> is trend-break structure with a name: a high (left shoulder), a higher high (head), then a <em>failed</em> attempt that stalls lower (right shoulder) — your lower-high warning from lesson two — followed by a break of the neckline, your confirmation. It isn't a magic shape; it's the anatomy of an uptrend dying, drawn in three humps. Volume typically shrinks across the pattern and expands on the neckline break.</p>
<blockquote>Patterns don't work because they're patterns. They work when they summarize real structure — a trend break, a failed breakout, compression resolving. Name the mechanics or skip the trade.</blockquote>

<h2>Measured moves: the built-in target</h2>
<p>Most patterns carry a rough price objective: a flag tends to travel about the length of its pole again; a double top or head-and-shoulders projects the pattern's height below the neckline. These are tendencies, not promises — but they give you an objective, non-emotional way to set the target you learned to require in Foundations, and to check the reward against your risk before entry.</p>

<h2>Why most pattern trades fail</h2>
<ul>
  <li><strong>Context blindness</strong> — a textbook flag inside a larger downtrend, at major resistance, is not a flag; it's a countertrend trap wearing a costume. Patterns inherit the quality of their location.</li>
  <li><strong>Anticipation</strong> — entering the head-and-shoulders before the neckline breaks, or the triangle before it resolves. Unconfirmed patterns fail constantly; confirmation is the pattern.</li>
  <li><strong>Hallucination</strong> — squint hard enough and every chart contains every pattern. If you need to explain why it counts, it doesn't.</li>
</ul>

<h2>Key takeaways</h2>
<ul>
  <li>Flags and triangles are digestion and compression in a trend; double tops and head-and-shoulders are trend-death anatomy.</li>
  <li>No confirmation, no pattern: necklines must break, triangles must resolve, ideally on expanding volume.</li>
  <li>Measured moves give objective targets to weigh reward against risk before entry.</li>
  <li>A pattern is only as good as its location — context first, shape second.</li>
</ul>
$html$, 5),

('multi-timeframe', 'Multi-Timeframe Analysis: The Top-Down Method', $html$
<p>Two traders both say "the trend is up" and both are right — one is looking at the weekly chart, the other at the 15-minute. Every timeframe has its own structure, its own levels, its own trend state, all coexisting on the same instrument. Multi-timeframe analysis is how you stop those layers from ambushing you, and start making them work together.</p>

<h2>The three-lens stack</h2>
<p>Pick three timeframes separated by roughly a factor of four to six, anchored to how long you hold trades:</p>
<ul>
  <li><strong>Higher timeframe (HTF) — the bias.</strong> Where you establish trend state and mark the major levels. A swing trader might use the weekly; a day trader the daily or 4-hour.</li>
  <li><strong>Middle timeframe — the setup.</strong> Where your actual pattern or pullback forms. Daily for the swing trader, 1-hour for the day trader.</li>
  <li><strong>Lower timeframe (LTF) — the trigger.</strong> Where you time the entry and place a tight, structure-based stop. 4-hour for the swing trader, 5-minute for the day trader.</li>
</ul>
<p>The rule that makes the stack work: <strong>each timeframe answers only its own question.</strong> The HTF says which direction you're allowed to trade. The middle says whether a setup exists. The LTF says exactly where you get in and where you're wrong. The moment you let the 5-minute chart change your daily bias, the stack has collapsed and you're just staring at noise with extra steps.</p>

<h2>Why the HTF wins</h2>
<p>A support zone on the weekly chart is visible to every participant from banks to bots, and the orders resting there dwarf anything the 15-minute chart can muster. When timeframes conflict, the higher one wins eventually — which is why counter-HTF trades feel fine for an hour and then get steamrolled. An uptrend on the 15-minute inside a daily downtrend isn't an uptrend; it's a rally being sold into.</p>
<blockquote>Trade in the direction of the tide, position on the wave, enter on the ripple.</blockquote>

<h2>The alignment trade</h2>
<p>The cleanest technical setups are timeframe agreements: the HTF trend is up and price has pulled back to an HTF support zone; the middle timeframe prints a reversal pattern at that zone; the LTF gives a structure break to enter with a stop under the zone. Every lesson in this course converges here — level (1), trend (2), perhaps a moving average confluence (3), volume confirming (4), a pattern (5), stacked across timeframes (6). Alignment doesn't guarantee a win. It means that when you're right, you're positioned with the largest players on the chart, and when you're wrong, your stop is close to the proof.</p>

<h2>Practical discipline</h2>
<ul>
  <li>Do the HTF analysis <strong>first</strong>, before the market opens or the trade idea excites you — bias set while calm is bias you can trust.</li>
  <li>Write the bias down. "Daily: uptrend, above support, longs only" is one sentence that filters a hundred bad trades.</li>
  <li>Don't check timeframes below your trigger. The 1-minute chart exists to shake day traders out of good positions.</li>
  <li>Screenshots of all three timeframes at entry belong in your journal — reviewing stacks, not single charts, is how this becomes instinct.</li>
</ul>

<h2>Key takeaways</h2>
<ul>
  <li>Use three timeframes ~4–6x apart: HTF for bias, middle for setup, LTF for trigger — each answers only its own question.</li>
  <li>When timeframes conflict, the higher one wins; counter-HTF trades are rallies being sold or dips being bought against you.</li>
  <li>The best setups are alignments where level, trend, volume, and pattern agree across the stack.</li>
  <li>Set the HTF bias first, in writing, while nothing is on the line.</li>
</ul>
$html$, 6),

('building-a-setup', 'Building Your Setup: From Analysis to Playbook', $html$
<p>Everything so far has been vocabulary. Levels, trends, averages, volume, patterns, timeframes — none of it makes money by being known. It makes money by being compressed into a <strong>setup</strong>: one written, repeatable recipe that tells you exactly what must be true before you risk a cent. This capstone is where analysis becomes a trading plan.</p>

<h2>What a setup is</h2>
<p>A setup is a falsifiable checklist. Not "I buy pullbacks" — that's a vibe. A setup specifies, in writing: the market condition it needs, the location it fires from, the trigger that gets you in, the invalidation that gets you out, and the target logic. If two of your trades from last month would be classified differently by a stranger reading your rules, the rules aren't done.</p>

<h2>The five components</h2>
<ul>
  <li><strong>Context</strong> — what the HTF must show. <em>Example: daily in an uptrend (HH/HL intact), price above the rising 50 SMA.</em></li>
  <li><strong>Location</strong> — where you're allowed to act. <em>Example: pullback into a daily support zone or a flipped former resistance level.</em></li>
  <li><strong>Trigger</strong> — the observable event that says "now". <em>Example: 1-hour prints a hammer or engulfing at the zone on above-average volume, then breaks the minor swing high.</em></li>
  <li><strong>Invalidation</strong> — the stop, placed at the price that proves the idea wrong. <em>Example: below the zone's low.</em> This is the same stop discipline from Foundations — the setup just tells you where it structurally belongs.</li>
  <li><strong>Target</strong> — mechanical, decided pre-entry. <em>Example: prior swing high, or a measured move; minimum 2R or the trade is skipped.</em> Position size then follows from the stop distance exactly as the Risk course prescribes.</li>
</ul>

<h2>One setup, fifty reps</h2>
<p>The urge after finishing a course like this is to trade everything you now recognize. Resist it. Edge comes from repetition of a single situation until its variations are familiar — which trades run instantly, which need patience, what a failure looks like in the first ten minutes. Trade <strong>one</strong> setup, tag every occurrence in your journal with the same name, and let the sample build. Fifty tagged trades tell you your actual win rate, average R, and best sessions — real numbers, replacing the textbook's promises. Then, and only then, add a second setup.</p>
<blockquote>A trader with one setup and two hundred journaled reps has something no textbook can sell: a verified edge with their own name on it.</blockquote>

<h2>The pre-trade card</h2>
<p>Before each entry, fill a five-line card — it takes thirty seconds and blocks ninety percent of impulse trades:</p>
<ul>
  <li>Setup name — <em>if it has no name, it isn't in the playbook, and it doesn't get traded.</em></li>
  <li>Context true? (y/n)</li>
  <li>Location + trigger present? (y/n)</li>
  <li>Entry / stop / target prices, and the R multiple they imply.</li>
  <li>One honest line: why this trade, right now?</li>
</ul>
<p>Save the card with your chart screenshots. In review, compare cards against outcomes: trades taken with every box checked versus trades where you fudged one. That single comparison — rule-following versus rule-bending, in your own data — teaches more than any indicator ever will.</p>

<h2>Key takeaways</h2>
<ul>
  <li>A setup is a written, falsifiable checklist: context, location, trigger, invalidation, target.</li>
  <li>Every component uses a skill from this course; stop placement and sizing plug into Foundations and Risk.</li>
  <li>Trade one setup until you have a fifty-plus trade sample before adding another — repetition is where edge lives.</li>
  <li>Fill a pre-trade card for every entry and journal it; unnamed trades don't get taken.</li>
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
      ('technical-analysis','support-resistance','Support and resistance are best drawn as…', 1,
        array['Zones that contain the cluster of highs/lows, wicks included','Exact lines price must touch to the tick','Diagonal lines only'], 1),
      ('technical-analysis','support-resistance','When a support level breaks decisively, it tends to…', 2,
        array['Become resistance on the retest','Disappear from the chart''s memory','Become stronger support'], 1),
      ('technical-analysis','trend-structure','An uptrend is defined by…', 1,
        array['A sequence of higher highs and higher lows','Price being above yesterday''s close','A green moving average'], 1),
      ('technical-analysis','trend-structure','An uptrend is confirmed broken when…', 2,
        array['A lower high forms AND the last significant higher low breaks','The first red candle appears','Price touches a trendline'], 1),
      ('technical-analysis','moving-averages','A moving-average crossover is best understood as…', 1,
        array['A lagging description of what already happened','A reliable prediction of the next move','An entry signal that works in ranges'], 1),
      ('technical-analysis','moving-averages','If a setup only works with one specific MA setting (e.g. the 27 EMA), that suggests…', 2,
        array['Curve-fitting, not a real edge','A secret professional setting','The setting should be patented'], 1),
      ('technical-analysis','volume-truth','A breakout from a level on unusually thin volume is…', 1,
        array['Suspect — likely to fail back into the range','Stronger, because fewer sellers showed up','Irrelevant to the breakout''s quality'], 1),
      ('technical-analysis','volume-truth','A huge volume spike after an extended rally, followed by candles making no progress, most likely signals…', 2,
        array['Exhaustion — larger players unloading into late buyers','Accelerating strength','A data error'], 1),
      ('technical-analysis','chart-patterns','A head-and-shoulders pattern only confirms when…', 1,
        array['The neckline breaks','The right shoulder starts forming','You can see all three humps'], 1),
      ('technical-analysis','chart-patterns','A textbook bull flag sitting at major resistance inside a larger downtrend is…', 2,
        array['A countertrend trap — patterns inherit their location''s quality','Extra bullish confirmation','Guaranteed to reach its measured move'], 1),
      ('technical-analysis','multi-timeframe','In the three-lens stack, the higher timeframe''s only job is to…', 1,
        array['Set the directional bias and major levels','Time the exact entry','Generate more trade signals'], 1),
      ('technical-analysis','multi-timeframe','A 15-minute uptrend inside a daily downtrend is best treated as…', 2,
        array['A rally being sold into — the higher timeframe wins eventually','A new bull market','Proof the daily chart is wrong'], 1),
      ('technical-analysis','building-a-setup','The five components of a written setup are…', 1,
        array['Context, location, trigger, invalidation, target','Indicator, feeling, news, luck, leverage','Entry, exit, and three confirmations'], 1),
      ('technical-analysis','building-a-setup','Why trade a single setup for fifty-plus journaled trades before adding another?', 2,
        array['Repetition builds a real sample that reveals your actual edge','Brokers limit the number of setups','One setup is easier to explain to friends'], 1)
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
