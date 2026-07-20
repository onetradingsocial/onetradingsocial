-- Full lesson content, batch 2: Risk Management — "Position Sizing" and
-- "R-Multiples". Replaces the 0005 placeholder bodies (≈145 chars each) with
-- full articles and adds the missing second quiz question per lesson.
--
-- NOTE: 0005's quiz guard was `not exists (... where lesson_id = qid)`, i.e. it
-- fires only when a lesson has NO questions at all — which is why these two
-- lessons were stuck at one question each. The block below guards on
-- (lesson_id, prompt) like 0026 onward, so the existing questions are kept and
-- only the new ones are inserted.
--
-- Idempotent: body updates are safe to re-run; question inserts guard on prompt.

-- ---------------------------------------------------------------------------
-- Lesson 1: risk / position-sizing
-- ---------------------------------------------------------------------------
update public.lessons l
set body = $html$
<p>Most traders decide how much to buy by asking "how much do I want to make?" or, more honestly, "how much can I afford to put in?" Both questions are backwards. Position size is not a preference. It is an output — the answer to an arithmetic problem you solve after the chart has already told you where your stop belongs.</p>

<h2>Fixed fractional risk</h2>
<p>Start by deciding one number: the percentage of your account you are willing to lose on a single trade. For most traders that is <strong>0.5% to 2%</strong>, and 1% is the common default. This number is set once, while you are calm, and it does not move because a setup looks especially good.</p>
<p>Why a percentage rather than a fixed amount of money? Because it scales in both directions automatically. As the account grows, your risk per trade grows with it. More importantly, as the account shrinks, your risk shrinks too — so a losing streak costs progressively less and cannot compound into ruin. A fixed cash risk does the opposite: it becomes a larger and larger share of a shrinking account, which is precisely the wrong behaviour at precisely the worst time.</p>

<h2>The formula</h2>
<p>Three inputs, one output:</p>
<p><strong>Position size = (account × risk %) ÷ (distance from entry to stop)</strong></p>
<p>Work an example. Account of 10,000. Risk 1%, so 100 of risk. You want to buy at 52.40 with a stop at 51.15 — a stop distance of 1.25. Position size = 100 ÷ 1.25 = <strong>80 shares</strong>. Not 100 because it is a round number, not 200 because you like the setup. Eighty.</p>
<p>Now change only the stop. Same account, same 1% risk, but the structure sits further away and your stop belongs at 49.90 — a distance of 2.50. Position size = 100 ÷ 2.50 = <strong>40 shares</strong>. Half the size, identical risk. This is the whole mechanism: the stop moves, the size compensates, and what you stand to lose never changes.</p>

<blockquote>Structure decides the stop. The stop decides the size. Your opinion decides neither.</blockquote>

<h2>The order of operations matters</h2>
<p>The single most common sizing error is doing this backwards: picking a size first, then placing the stop wherever that size makes the risk feel tolerable. That produces stops sitting inside normal noise, at prices no market participant cares about, and it is why some traders get stopped out repeatedly on trades whose idea was fine.</p>
<p>The correct sequence is always: find the level that would prove you wrong, place the stop beyond it, measure the distance, then divide. If the resulting size feels too small to be interesting, the honest conclusion is that this trade offers too little for the risk it requires — not that the stop should be moved closer.</p>

<h2>What it protects you from</h2>
<p>Consider a strategy with a 45% win rate. Over a few hundred trades, a run of eight or nine consecutive losses is not bad luck, it is arithmetic — it will happen. Ten losses at 1% leaves you down about 9.6% and entirely able to keep trading. Ten losses at 5% leaves you down 40%, needing a 67% gain to recover, and almost certainly trading badly by then. Same strategy, same trades, different survival.</p>
<p>Two extras worth setting now. A <strong>daily loss limit</strong> — commonly 3R — after which you stop for the day, and a <strong>correlation rule</strong>: two positions that move together are one position wearing two names, so three correlated 1% trades is a 3% trade. Size them as the single risk they actually are.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Risk a fixed small percentage of the account per trade — around 1% for most traders — decided in advance.</li>
  <li>Position size = (account × risk %) ÷ stop distance. Size is an output, never an input.</li>
  <li>Place the stop from structure first, then divide; never move the stop to justify a size.</li>
  <li>Percentage risk shrinks automatically in a drawdown, which is what makes losing streaks survivable.</li>
  <li>Correlated positions are one position — size them together, and set a daily loss limit.</li>
</ul>
$html$
from public.courses c
where c.id = l.course_id and c.slug = 'risk' and l.slug = 'position-sizing';

-- ---------------------------------------------------------------------------
-- Lesson 2: risk / r-multiples
-- ---------------------------------------------------------------------------
update public.lessons l
set body = $html$
<p>Two traders compare results. One made 400 on a trade, the other 90. Which traded better? The question is unanswerable, because currency amounts describe account size and position size, not decisions. R-multiples fix that by measuring every trade in a unit that belongs to the trade itself.</p>

<h2>One R is what you risked</h2>
<p><strong>1R is the distance from your entry to your stop, in money.</strong> If you risk 100 on a trade, then 1R = 100 for that trade. Make 250 and you made +2.5R. Lose the full stop and you lost −1R. Exit early for 40 and you made +0.4R.</p>
<p>Return to the two traders. The first risked 400 to make 400: <strong>+1R</strong>. The second risked 30 to make 90: <strong>+3R</strong>. In currency the first looks like the better day. In R, the second made a decision three times as good and the first took thirteen times the risk to achieve less. That inversion is the entire reason the unit exists.</p>

<h2>What R makes possible</h2>
<ul>
  <li><strong>Comparability.</strong> A trade from last year on a 2,000 account and one from today on a 20,000 account sit in the same column. Your history stops being fragmented by how big you were at the time.</li>
  <li><strong>Comparability across instruments.</strong> Pips, ticks, points and cents do not compare to each other. R does.</li>
  <li><strong>Planning before entry.</strong> Because the stop defines 1R, you can state a trade's reward-to-risk before you take it: a target 3 R away is a 3R trade, and you knew that while you were still flat.</li>
  <li><strong>Honest measurement.</strong> Averaging your results in R is what produces expectancy — the real measure of a system, covered in depth in the Journal course. That calculation is meaningless in currency, because a few oversized trades dominate the average.</li>
</ul>

<h2>Reward-to-risk, and the trap inside it</h2>
<p>A minimum reward-to-risk of 2:1 is common advice and reasonable as a starting filter. But the ratio is only half the equation — it interacts with how often you are right. At 2R targets you need better than a 33% win rate to break even; at 1R targets you need better than 50%; at 5R targets, better than 17%.</p>
<p>The trap is that these are not independent knobs. Stretching your target from 2R to 5R does not preserve your win rate — distant targets get hit far less often. Traders who chase big R multiples frequently end up with a worse system than they started with, because they moved the target without checking what it did to the hit rate. The only way to know which combination works for you is your own logged sample.</p>

<blockquote>R makes your trades comparable. Comparable trades are the only kind you can learn from.</blockquote>

<h2>Recording it honestly</h2>
<p>Compute R against <em>planned</em> risk, not against whatever you eventually lost. If your stop was 1R away and slippage or a widened stop turned the loss into 1.4R, record −1.4R. That is the number that tells the truth. A trader who quietly records every loss as −1R has built a journal that cannot show them their biggest problem — and inflated losses are exactly how a positive-expectancy strategy ends up losing money in practice.</p>
<p>The same applies upward. An exit at +0.6R because you got nervous is +0.6R, not "basically a winner". Over a hundred trades, the gap between your planned R and your realised R <em>is</em> your execution quality, expressed as a number.</p>

<h2>Key takeaways</h2>
<ul>
  <li>1R is the money between your entry and your stop; every result is a multiple of it.</li>
  <li>R makes trades comparable across account sizes, instruments and years.</li>
  <li>Reward-to-risk and win rate are linked — a bigger target lowers your hit rate, so test the pair together.</li>
  <li>Record losses against planned risk, so a −1.4R loss is logged as −1.4R and stays visible.</li>
  <li>The gap between planned R and realised R is a direct measure of your execution.</li>
</ul>
$html$
from public.courses c
where c.id = l.course_id and c.slug = 'risk' and l.slug = 'r-multiples';

-- ---------------------------------------------------------------------------
-- Second quiz question per lesson (0005 seeded only one each).
-- Guarded on (lesson_id, prompt), so existing questions are untouched.
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
      ('risk','position-sizing','Your stop has to sit further from entry than usual. Holding risk % constant, your position size should…', 2,
        array['Get smaller, in proportion to the wider stop','Stay the same, since the account has not changed','Get larger, to keep the potential profit the same'], 1),
      ('risk','r-multiples','Trader A risks 400 to make 400. Trader B risks 30 to make 90. In R terms…', 2,
        array['B made +3R and A made +1R, so B''s decision was better','A made more money, so A performed better','They are equivalent once account size is considered'], 1)
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
