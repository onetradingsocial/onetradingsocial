-- Full lesson content, batch 1: Foundations — "What Is a Trade?" and "Reading Candles".
-- Replaces placeholder bodies with full articles and adds two quiz questions per lesson.
-- Idempotent: body updates are safe to re-run; question inserts guard on prompt.

-- ---------------------------------------------------------------------------
-- Lesson 1: foundations / what-is-a-trade
-- ---------------------------------------------------------------------------
update public.lessons l
set body = $html$
<p>Ask ten people on a trading floor what a trade is and you'll get ten stories about tickers and adrenaline. Strip the noise away and a trade is something much simpler — and much stricter: <strong>a single, pre-planned decision to buy or sell an instrument, with three prices written down before you click anything.</strong></p>

<h2>The three prices that define a trade</h2>
<ul>
  <li><strong>Entry</strong> — the price where your idea becomes a position. Not "somewhere around here": a specific level, chosen for a reason you can say out loud.</li>
  <li><strong>Stop</strong> — the price that proves your idea wrong. If the market gets here, the reason you entered no longer exists, and you exit. No negotiating, no "it'll come back."</li>
  <li><strong>Target</strong> — the price where your idea has played out and you take profit (or begin scaling out). It defines what you stand to gain, the same way the stop defines what you stand to lose.</li>
</ul>
<p>Together, these three numbers turn a hunch into a testable decision. Entry-to-stop is your risk. Entry-to-target is your reward. Before you've risked a cent, you already know the ratio between them — and whether the trade is even worth taking.</p>

<h2>A trade is not a bet</h2>
<p>A bet is a position held on hope. A trade is a position held on a plan. The difference isn't the outcome — plenty of well-planned trades lose, and plenty of reckless bets win. The difference is that a trade can <em>teach you something</em> when it's over, because you can compare what happened against what you planned.</p>
<blockquote>If you can't state where you're wrong before you enter, you don't have a trade — you have a bet with extra steps.</blockquote>

<h2>Why every trade belongs in your journal</h2>
<p>One trade tells you almost nothing. A losing trade might have been a great decision; a winning trade might have been luck you'll pay back later. The only way to know is sample size — and the only way to get a sample is to log every trade, the same way, every time.</p>
<p>For each trade, record:</p>
<ul>
  <li><strong>The setup</strong> — a name for the pattern or reason you entered ("breakout retest", "earnings fade"). Names make setups countable.</li>
  <li><strong>The three prices</strong> — planned entry, stop, and target, plus where you actually got filled.</li>
  <li><strong>Size</strong> — how much you risked, in money and as a percent of your account.</li>
  <li><strong>The chart</strong> — a screenshot at entry. Your memory of "what it looked like" will lie to you within a week.</li>
  <li><strong>Your state</strong> — one honest line about how you felt. Revenge trades and boredom trades hide here.</li>
</ul>
<p>Do this for fifty trades and patterns appear that no amount of chart-staring will show you: which setups actually pay, which timeframes suit you, which emotional states precede your worst decisions. The journal is where intuition becomes data.</p>

<h2>Key takeaways</h2>
<ul>
  <li>A trade is defined by three pre-planned prices: entry, stop, and target.</li>
  <li>The stop is where your idea is proven wrong — decide it before entry, never after.</li>
  <li>No stop, no trade. A position without a defined exit is a bet.</li>
  <li>Log every trade identically. Edge only becomes visible across a sample, never in a single result.</li>
</ul>
$html$
from public.courses c
where c.id = l.course_id and c.slug = 'foundations' and l.slug = 'what-is-a-trade';

-- ---------------------------------------------------------------------------
-- Lesson 2: foundations / reading-candles
-- ---------------------------------------------------------------------------
update public.lessons l
set body = $html$
<p>A candlestick is a compressed story. One candle tells you everything the market did in its period — every fight between buyers and sellers — in four numbers. Learn to read those four numbers fluently and a chart stops being wallpaper and starts being a transcript.</p>

<h2>The four prices in every candle</h2>
<ul>
  <li><strong>Open</strong> — where price started the period.</li>
  <li><strong>High</strong> — the highest price reached.</li>
  <li><strong>Low</strong> — the lowest price reached.</li>
  <li><strong>Close</strong> — where price finished. The most important of the four: it's the market's final verdict for that period.</li>
</ul>
<p>The <strong>body</strong> is the block between open and close. The <strong>wicks</strong> (also called shadows or tails) are the thin lines stretching to the high and the low. A green (bullish) candle closed above its open; a red (bearish) candle closed below it.</p>

<h2>Bodies show conviction</h2>
<p>A long body means one side dominated the period: price moved and <em>stayed</em> moved. A tiny body means the period ended close to where it started — lots of activity, no verdict. Body size is a conviction meter: the bigger the body relative to recent candles, the more decisively one side won.</p>

<h2>Wicks show rejection</h2>
<p>A wick is a road the market went down and then abandoned. A long lower wick means sellers pushed price down and buyers shoved it back up — lower prices were <strong>rejected</strong>. A long upper wick means buyers reached for higher prices and sellers slapped them back down. Wicks are where you see the losing side's failed attempt, frozen on the chart.</p>
<blockquote>The body tells you who won the period. The wicks tell you what the losers tried.</blockquote>

<h2>Four candles worth knowing by name</h2>
<ul>
  <li><strong>Doji</strong> — tiny body, wicks on both sides. Open and close nearly equal: a stalemate. After a strong trend, a doji is the first hint the winning side is running out of conviction.</li>
  <li><strong>Hammer</strong> — small body at the top, long lower wick, appearing after a decline. Sellers tried to continue the move down and were firmly rejected. Often marks a bounce.</li>
  <li><strong>Shooting star</strong> — the hammer's mirror: small body at the bottom, long upper wick, after a rally. Buyers reached higher and were rejected.</li>
  <li><strong>Marubozu</strong> — all body, little to no wick. One side controlled the period from open to close. Maximum conviction.</li>
</ul>

<h2>Context beats patterns</h2>
<p>No candle means anything on its own. A hammer in the middle of a sideways chop is noise; the same hammer at a support level the market has respected three times is information. Always read candles in three layers: <strong>where</strong> the candle formed (near support, resistance, or nothing), <strong>what came before it</strong> (trend or chop), and only then <strong>what shape it is</strong>. Pattern-spotting without context is how textbooks get traders stopped out.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Every candle encodes four prices: open, high, low, close. The body is open-to-close; the wicks are the extremes.</li>
  <li>Long bodies signal conviction; long wicks signal rejection of price.</li>
  <li>Doji, hammer, shooting star, and marubozu cover most of what single candles can tell you.</li>
  <li>Location and preceding trend matter more than the pattern itself.</li>
</ul>
$html$
from public.courses c
where c.id = l.course_id and c.slug = 'foundations' and l.slug = 'reading-candles';

-- ---------------------------------------------------------------------------
-- Extra quiz questions (2 per lesson). Guarded per prompt so re-runs are no-ops.
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
      ('foundations','what-is-a-trade','A position with no predefined stop is best described as…', 2,
        array['A bet, not a trade','A long-term investment','A hedge'], 1),
      ('foundations','what-is-a-trade','Why log every trade in a journal, not just the interesting ones?', 3,
        array['Edge only shows up across a full sample of trades','Brokers require it','It guarantees future wins'], 1),
      ('foundations','reading-candles','A doji (tiny body, wicks both sides) after a strong trend signals…', 2,
        array['Indecision — the winning side is losing conviction','A guaranteed reversal','That volume was zero'], 1),
      ('foundations','reading-candles','A long lower wick after a decline usually means…', 3,
        array['Buyers rejected the lower prices','Sellers are in full control','The exchange halted trading'], 1)
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
