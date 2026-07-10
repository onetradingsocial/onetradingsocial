-- Premium courses & psychology modules (Pro pricing row): first Pro-only
-- course. Six full-length lessons, two quiz questions each, 150 XP per lesson.
-- Idempotent: course/lesson inserts guard on slug, questions guard on prompt.

insert into public.courses (slug, title, summary, difficulty, ord, min_tier, published) values
  ('psychology', 'Trading Psychology', 'Master the trader, not just the trade: fear, tilt, discipline, and the routines of consistent performers.', 'advanced', 3, 'pro', true)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Lessons
-- ---------------------------------------------------------------------------
with c as (select id from public.courses where slug = 'psychology')
insert into public.lessons (course_id, slug, title, body, ord, xp_reward, published)
select c.id, v.slug, v.title, v.body, v.ord, 150, true from c, (values

('mind-is-the-market', 'The Mind Is the Market', $html$
<p>Two traders take the same signal, on the same instrument, at the same moment. One finishes the year profitable; the other blows up in March. Same charts, same tools, same information. The difference wasn't the setup — it was everything that happened between their ears after the position opened.</p>

<h2>Why psychology outweighs strategy</h2>
<p>A mediocre strategy executed with perfect discipline will usually beat a brilliant strategy executed emotionally. The math is simple: your edge per trade is small — a few tenths of an R on average — while a single emotional decision (doubling into a loser, pulling a stop, revenge-sizing after a loss) can cost 5R, 10R, or an account. One bad hour can erase a good quarter.</p>
<p>This is why professional trading firms spend more effort on risk rules and trader monitoring than on signal generation. They know signals are the cheap part. Execution under emotional load is the expensive part.</p>

<h2>You are not built for this</h2>
<p>The human brain evolved for a world where losses could mean death and hesitation could mean starvation. Markets exploit that wiring ruthlessly:</p>
<ul>
  <li><strong>Loss aversion</strong> — losses hurt roughly twice as much as equivalent gains feel good. So you hold losers (to avoid realizing the pain) and cut winners (to lock in the pleasure). The exact opposite of what expectancy requires.</li>
  <li><strong>Recency bias</strong> — the last three trades feel like the truth about the next hundred. Two losses and your finger hesitates on a perfectly good signal; two wins and you're suddenly sizing up.</li>
  <li><strong>Outcome bias</strong> — judging a decision by its result. A reckless trade that won feels smart; a disciplined trade that lost feels stupid. Reinforce that loop for a year and you've trained yourself to gamble.</li>
  <li><strong>Confirmation bias</strong> — once positioned, you stop seeing the chart and start seeing your hopes. Evidence against your position gets discounted; noise in your favor becomes "confluence".</li>
</ul>
<blockquote>The market doesn't take your money. Your untrained responses to the market take your money — the market just holds the door.</blockquote>

<h2>The performance gap is measurable</h2>
<p>Pull up your journal and compute two numbers: the expectancy of your <em>planned</em> trades (entry, stop, target as written), and the expectancy of your <em>actual</em> executions. The difference between those two numbers is your psychology bill. For most developing traders it's the single largest line item in their P/L — bigger than commissions, bigger than slippage, bigger than any strategy tweak could recover.</p>
<p>That gap is also the good news. You don't need a new strategy. You need to close the gap between the trader you are on paper and the trader you are with money on the line. Every lesson in this course targets that gap.</p>

<h2>What "working on psychology" actually means</h2>
<p>It does not mean affirmations or forcing yourself to feel calm. Feelings aren't the problem — <em>unexamined feelings driving decisions</em> are. Working on psychology means three concrete practices:</p>
<ul>
  <li><strong>Observation</strong> — logging your emotional state on every trade so patterns become visible (this is why the journal has an emotion field).</li>
  <li><strong>Structure</strong> — building rules that make the right action automatic and the wrong action expensive, so discipline doesn't depend on willpower in the moment.</li>
  <li><strong>Review</strong> — separating decision quality from outcome quality in a regular review, so you reinforce process instead of luck.</li>
</ul>

<h2>Key takeaways</h2>
<ul>
  <li>Execution under emotion, not signal quality, separates profitable traders from the rest.</li>
  <li>Loss aversion, recency, outcome, and confirmation bias are wired in — you manage them with structure, not willpower.</li>
  <li>The gap between planned and executed expectancy is your psychology bill. Measure it.</li>
  <li>Psychology work = observation, structure, and review — all of it happens in your journal.</li>
</ul>
$html$, 1),

('fear-and-greed', 'Fear and Greed: The Two Engines', $html$
<p>Every trading error you will ever make runs on one of two engines: fear or greed. Learn to recognize which engine is running — in real time, while it's happening — and you've won half the psychological battle. This lesson maps both engines onto the specific mistakes they produce.</p>

<h2>The fear family</h2>
<p>Fear in trading isn't one emotion; it's four distinct failures, each with its own signature in your journal:</p>
<ul>
  <li><strong>Fear of losing → hesitation.</strong> The setup appears, checks every box, and you watch it leave without you. The journal signature: missed trades on your best setups, often right after a losing streak.</li>
  <li><strong>Fear of giving back → premature exits.</strong> You're +1R on a trade planned for +3R and the urge to "protect" the profit overwhelms the plan. Signature: your average winner is far smaller than your average planned target.</li>
  <li><strong>Fear of being wrong → stop-pulling.</strong> Price approaches your stop and you move it "to give the trade room". Signature: your largest losses are multiples of your planned risk.</li>
  <li><strong>Fear of missing out → chasing.</strong> The move leaves without you and you jump in late, at the worst price, with no level to stop against. Signature: entries far from any planned level, usually after a fast move.</li>
</ul>

<h2>The greed family</h2>
<ul>
  <li><strong>Oversizing.</strong> The setup looks "too good" so you risk 3x normal. One loss now does the damage of three. Greed's favorite disguise is conviction.</li>
  <li><strong>Overtrading.</strong> A good morning turns into fifteen forced trades by 3pm. Wins create the feeling that the market is a faucet you can leave running. It isn't — your edge exists in specific spots, and everything between those spots is donation.</li>
  <li><strong>Target-moving.</strong> Price hits your target and instead of taking profit you extend it, because "it's clearly going higher". The trade that made you +3R on paper comes back to break even.</li>
  <li><strong>Lottery hunting.</strong> Abandoning your consistent setup to swing for a home run on news, low-float spikes, or someone else's conviction. Signature: occasional huge risk numbers on instruments you never normally trade.</li>
</ul>
<blockquote>Fear makes you exit what you should hold and skip what you should take. Greed makes you hold what you should exit and take what you should skip. Both destroy expectancy from opposite directions.</blockquote>

<h2>Your personal bias</h2>
<p>Nobody runs both engines equally. Most traders lean one way — fear-dominant traders die slowly (small wins, missed opportunities, a thousand papercuts of hesitation), greed-dominant traders die suddenly (one oversized position, one held loser). Read your last fifty journal entries and classify every deviation from plan as F or G. The ratio tells you which lessons in this course you'll need the most.</p>

<h2>The antidote is pre-commitment</h2>
<p>You cannot out-argue fear or greed in the moment — the emotional brain is faster than the rational one and it controls your hands. What works is removing the decision from the moment entirely:</p>
<ul>
  <li>Size is computed by formula (fixed risk %) before entry. Never adjusted "because this one looks great".</li>
  <li>Stops and targets are placed as orders, not intentions, the moment you're filled.</li>
  <li>A written daily stop (e.g. −3R or three losses) ends the session. The decision to quit was made on Sunday, not mid-tilt on Tuesday.</li>
</ul>

<h2>Key takeaways</h2>
<ul>
  <li>Fear causes hesitation, early exits, stop-pulling, and chasing; greed causes oversizing, overtrading, target-moving, and lottery hunting.</li>
  <li>Each error has a measurable journal signature — you can diagnose your engine from your data.</li>
  <li>Most traders are dominated by one engine. Find yours; it decides where your work is.</li>
  <li>The fix is pre-commitment: decisions made by formula and by order, before emotion arrives.</li>
</ul>
$html$, 2),

('tilt-and-revenge', 'Tilt and the Revenge Spiral', $html$
<p>Tilt is a poker word for the state where emotion has fully taken the controls and skill no longer matters. Every account-destroying day follows the same script, and it almost never starts with a big loss. It starts with a small, <em>unfair</em> one.</p>

<h2>Anatomy of a spiral</h2>
<ul>
  <li><strong>The trigger.</strong> A perfectly good trade gets stopped by a wick, then price runs to your target without you. The loss is small but it feels <em>stolen</em>. Fairness circuits light up — the same ones that fire when someone cuts in line.</li>
  <li><strong>The debt.</strong> Your brain silently books the loss as something the market <em>owes you back</em>. From this moment you are no longer trading setups; you are collecting a debt.</li>
  <li><strong>The escalation.</strong> The next trade is taken faster, sized bigger, with less confirmation — because it isn't a trade, it's the recovery vehicle. When it loses (it usually does; it was never a real setup), the debt doubles and the sizing doubles with it.</li>
  <li><strong>The blowout.</strong> Three to five iterations later you're risking 10x normal on garbage, and one red candle does a month of damage. Tomorrow you'll look at the chart and not recognize the person who took those trades.</li>
</ul>
<blockquote>Revenge trading is the only losing streak you fund personally. The market didn't take that money — you delivered it, trade by trade, to make a feeling go away.</blockquote>

<h2>Know your triggers</h2>
<p>Tilt has a fingerprint, and yours is in your journal. Common triggers, roughly in order of danger:</p>
<ul>
  <li><strong>The wick-out</strong> — stopped at the exact low/high before the move goes your way.</li>
  <li><strong>The missed winner</strong> — hesitated, watched your setup pay +4R to everyone else.</li>
  <li><strong>The giveback</strong> — a green morning turned red by lunch.</li>
  <li><strong>The broken rule that worked</strong> — most dangerous of all: you pulled a stop, it saved the trade, and now the rulebook feels optional.</li>
  <li><strong>Off-chart load</strong> — bad sleep, an argument, financial pressure. Tilt threshold drops with everything you carry into the session.</li>
</ul>

<h2>Circuit breakers: decide now, not then</h2>
<p>Exchanges halt trading after extreme moves because they know humans can't be trusted mid-panic. Give yourself the same infrastructure. Write these down while calm, and treat them as physics, not suggestions:</p>
<ul>
  <li><strong>Loss circuit:</strong> two consecutive losses → mandatory 30-minute break away from the screen. Three losses or −3R on the day → session over. Close the platform.</li>
  <li><strong>The tilt tell:</strong> catch yourself thinking "it owes me", "I need to get it back", or sizing up after a loss → flat everything, stand up, leave the room. The position can be re-entered in an hour if the setup is still valid. It won't be.</li>
  <li><strong>The re-entry ritual:</strong> returning after a break requires re-reading your plan and writing one sentence about what triggered you. No sentence, no trading.</li>
</ul>

<h2>Losses are inventory, not insults</h2>
<p>The deepest fix is reclassification. A losing trade taken exactly to plan is not a failure — it is the cost of goods for a business whose product is expectancy. A casino doesn't tilt when a gambler hits blackjack; it knows the next thousand hands pay the house. Your stop-outs are the casino's payouts: planned, budgeted, and irrelevant to the long run. The only loss worth being upset about is the one that broke your rules — and that one deserves review, not revenge.</p>

<h2>Key takeaways</h2>
<ul>
  <li>The spiral runs trigger → debt → escalation → blowout, and it starts with an "unfair" small loss, not a big one.</li>
  <li>Your triggers are identifiable in your journal — the wick-out and the rule-break-that-worked are the classics.</li>
  <li>Circuit breakers (2 losses = break, 3 losses or −3R = done) must be written while calm and obeyed like physics.</li>
  <li>Planned losses are inventory cost, not insults. Only rule-breaks deserve emotion, and what they deserve is review.</li>
</ul>
$html$, 3),

('discipline-by-design', 'Discipline by Design', $html$
<p>The most persistent myth in trading is that discipline is a character trait — that consistent traders are simply built from sterner stuff. The truth is less flattering and far more useful: <strong>disciplined traders don't resist temptation better than you; they've built systems that remove the temptation entirely.</strong> Discipline isn't a muscle. It's architecture.</p>

<h2>Willpower is a depleting resource</h2>
<p>Every discretionary decision you make during a session — take it or skip it, hold or exit, size up or down — draws from the same limited tank. By hour four, the tank is low, and the market is still generating decisions. This is why your worst trades cluster late in the session and late in the week, and why "I'll just be more disciplined tomorrow" fails every time it's tried: tomorrow has the same tank.</p>
<p>The design goal is to spend willpower where it's cheap (planning, the night before, market closed) and make the live session as close to decision-free as possible.</p>

<h2>The three layers of a discipline system</h2>
<ul>
  <li><strong>Layer 1 — The playbook.</strong> A written definition of every setup you're allowed to trade: what it looks like, where the entry, stop, and target go, what invalidates it. If a trade isn't in the playbook, it doesn't exist. This single rule deletes 80% of discretionary errors — the random chases, the boredom trades, the "this looks interesting" positions.</li>
  <li><strong>Layer 2 — The checklist.</strong> Five lines you run before every entry: setup name? level? stop placed as an order? size by formula? risk within daily budget? Thirty seconds that stand between impulse and execution. Pilots with ten thousand hours still run checklists — not because they've forgotten how to fly, but because checklists catch what confidence misses.</li>
  <li><strong>Layer 3 — The environment.</strong> Make wrong actions physically harder: platform closes automatically at your daily stop; position size is pre-configured and capped at the broker level; the phone with the trading app lives in another room outside session hours. Every click of friction between you and a bad decision is edge.</li>
</ul>
<blockquote>Amateurs try to make better decisions in the moment. Professionals arrange the moment so there are fewer decisions to make.</blockquote>

<h2>Process goals, not outcome goals</h2>
<p>"Make $500 today" is a goal you don't control — the market decides which days pay. Outcome goals force trades on empty days and cut sessions short on generous ones, corrupting execution both ways. Replace them with process goals, which you control completely:</p>
<ul>
  <li>Took every playbook setup that appeared: yes/no.</li>
  <li>Zero trades outside the playbook: yes/no.</li>
  <li>Every stop placed as an order at entry: yes/no.</li>
  <li>Journal completed for every trade, including emotion field: yes/no.</li>
</ul>
<p>Score yourself daily on process, and grade the week on execution percentage — not P/L. A losing week at 95% process compliance is a good week; the money follows the percentage with sample size. A winning week at 60% compliance is a warning, not a victory.</p>

<h2>Rebuilding after a break</h2>
<p>You will break your rules — everyone does. What separates recoverable traders from unrecoverable ones is the response. The protocol: (1) flag the trade in your journal the moment you notice, honestly; (2) write the trigger in one sentence; (3) next session, trade minimum size until you log three consecutive fully-compliant days. The size reduction isn't punishment — it lowers the stakes so your nervous system can practice compliance without the noise of meaningful P/L.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Discipline is architecture, not character. Build systems; don't summon willpower.</li>
  <li>Three layers: a written playbook (what you may trade), a pre-entry checklist (how you enter), and an environment that makes errors physically harder.</li>
  <li>Process goals (execution compliance) replace outcome goals (daily P/L). Grade weeks on percentage, not dollars.</li>
  <li>After a rule-break: flag it, name the trigger, minimum size until three clean days.</li>
</ul>
$html$, 4),

('surviving-drawdown', 'Surviving the Drawdown', $html$
<p>Here is a promise: if you trade long enough, you will hit a drawdown that makes you question everything — your strategy, your competence, whether you should be doing this at all. Drawdowns aren't a sign the system is broken. They are a mathematical certainty of any system with a win rate below 100%, and how you behave inside one determines whether you're still trading next year.</p>

<h2>The math you must internalize</h2>
<p>A strategy that wins 50% of the time will produce a streak of seven consecutive losses roughly once every 128 sequences — which, for an active trader, means <em>routinely</em>. Ten-loss streaks happen to profitable systems. If seven losses in a row would end you financially or emotionally, the problem isn't the streak; it's that your risk per trade and your expectations were never sized for reality.</p>
<ul>
  <li>At 1% risk per trade, a 10-loss streak costs ~10% of the account. Painful, survivable, recoverable.</li>
  <li>At 5% risk per trade, the same streak costs ~40%. Now you need a +67% run just to get back — with a shaken psyche and probably a corrupted process.</li>
</ul>
<p>Risk sizing isn't just capital management. It's <em>emotion</em> management: your risk per trade decides how scary a normal losing streak feels.</p>

<h2>Skill drawdown vs variance drawdown</h2>
<p>The most important diagnostic question inside a drawdown: <strong>is the system losing, or am I?</strong> Open the journal and separate trades into "to plan" and "off plan":</p>
<ul>
  <li>If compliance is high and the losses are on-plan trades → this is <strong>variance</strong>. The correct response is: change nothing. Keep executing. This is precisely the moment the edge pays those who stay in line.</li>
  <li>If compliance has slipped — stops pulled, sizes wobbling, setups outside the playbook → this is a <strong>you</strong> drawdown wearing a market costume. The correct response is to fix execution, not strategy.</li>
</ul>
<blockquote>The deadliest move in a variance drawdown is to "fix" a working strategy — you abandon the edge right before it pays, then repeat the cycle with the next system forever.</blockquote>

<h2>The drawdown protocol</h2>
<ul>
  <li><strong>At −5R from equity peak:</strong> run the compliance audit above. No other action.</li>
  <li><strong>At −8R:</strong> halve position size. This extends your runway, calms the nervous system, and keeps you executing the system so the sample keeps growing.</li>
  <li><strong>At −12R:</strong> stop trading live for one week. Review every trade in the drawdown with fresh eyes (or a trusted peer). Resume at half size on paper-perfect compliance only.</li>
  <li><strong>At all stages:</strong> double the journaling detail. Drawdowns are where your best future rules are discovered — expensive tuition deserves detailed notes.</li>
</ul>

<h2>Protecting the psyche</h2>
<p>Capital recovers faster than confidence. Guard it deliberately: shrink your review window (a bad month is noise inside a good year — look at the 200-trade rolling expectancy, not the week); keep a "best trades" file and reread it, because your brain will insist you've never traded well; keep training, exercising, and sleeping, because the drawdown will whisper that you don't deserve rest until you've "fixed it". That whisper is the same voice that pulls stops. It doesn't get a vote.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Losing streaks are a mathematical certainty — size risk so a 10-loss streak is survivable financially and emotionally.</li>
  <li>Diagnose every drawdown: high compliance = variance (change nothing); low compliance = execution problem (fix yourself, not the system).</li>
  <li>Follow a written protocol: audit at −5R, half size at −8R, week off + review at −12R.</li>
  <li>Confidence recovers slower than capital. Protect it with long review windows and evidence of your own competence.</li>
</ul>
$html$, 5),

('performance-routines', 'The Routines of Consistent Performers', $html$
<p>Elite performance in every field — sport, surgery, aviation, chess — rests on routines that make excellence repeatable. Trading is no exception, but most traders have exactly one routine: turn on the screen and start clicking. This final lesson assembles everything from this course into a daily and weekly operating rhythm.</p>

<h2>The pre-session routine (15 minutes)</h2>
<ul>
  <li><strong>State check (2 min).</strong> Sleep, stress, mood — score yourself 1–5. Below a 3? Trade half size or not at all. You wouldn't fly a plane exhausted; your account deserves the same respect.</li>
  <li><strong>Context scan (5 min).</strong> News that touches your instruments, key levels from yesterday, the sessions ahead. You're not looking for trades yet — you're building the map you'll trade inside.</li>
  <li><strong>Plan writing (5 min).</strong> Which playbook setups are plausible today, at which levels, and what would invalidate them. Written down. A plan that exists only in your head will be quietly rewritten by whatever price does first.</li>
  <li><strong>Rehearsal (3 min).</strong> Visualize the hard moments, not the wins: the stop-out on the first trade, the setup that never comes, the wick that takes you out before the move. Deciding how you'll respond <em>before</em> it happens is tilt insurance — the situation arrives pre-processed.</li>
</ul>

<h2>During the session</h2>
<ul>
  <li><strong>Log at entry, not after.</strong> Setup name, prices, size, emotion — while the trade is live. Post-hoc journaling is fiction; you'll record what makes you look sensible.</li>
  <li><strong>Between setups, hands off.</strong> The market generates temptation continuously. Your edge exists at your levels and nowhere else. Standing flat is a position — usually your most profitable one.</li>
  <li><strong>Run the circuit breakers.</strong> Two losses, break. Three or −3R, done. The rules from the tilt lesson only work if they run every session, including — especially — the ones that feel fine.</li>
</ul>

<h2>The post-session routine (10 minutes)</h2>
<ul>
  <li><strong>Close the journal properly.</strong> Every trade complete: actual entry/exit vs plan, emotion tags, mistake tags where honesty demands them, screenshots attached.</li>
  <li><strong>Score the process.</strong> Compliance yes/no on each process goal. This score — not the P/L — is today's grade.</li>
  <li><strong>One sentence of review.</strong> The single most useful thing you noticed today, written where next-week-you will find it. Not an essay. One sentence, every day, compounds into self-knowledge no book can give you.</li>
</ul>
<blockquote>Amateurs review when things go wrong. Professionals review on schedule — which is why things go wrong for them less.</blockquote>

<h2>The weekly review (30 minutes, non-negotiable)</h2>
<p>Once a week, market closed, no positions: read every journal entry from the week. Then answer, in writing: Which setup earned the most and least? Where did execution deviate from plan, and what triggered it? Is any mistake tag appearing twice? What one rule change (maximum one) does the evidence support? Check the weekly review card and strategy breakdown in your journal — the platform computes the numbers; your job is the judgment.</p>
<p>The one-change limit matters. Traders who overhaul everything weekly never accumulate a sample on anything, so they never learn what actually works. Evolution beats revolution — one mutation per generation, tested against data.</p>

<h2>Rest is part of the system</h2>
<p>Markets run forever; you don't. Consistent performers treat recovery as a trading tool: real weekends, screens off after the session, exercise that clears the residue of a red day. The trader who returns Monday genuinely rested beats the one who spent Sunday re-living Friday's stop-out — every single week.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Pre-session: state check, context scan, written plan, rehearsal of the hard moments — 15 minutes that shape everything after.</li>
  <li>Live: log at entry, stay flat between setups, obey circuit breakers unconditionally.</li>
  <li>Post-session: complete the journal, score the process, one written sentence of review.</li>
  <li>Weekly: full journal read, evidence-based conclusions, at most one rule change per week.</li>
  <li>Recovery is edge. Rested traders out-execute tired ones over any meaningful sample.</li>
</ul>
$html$, 6)

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
      ('psychology','mind-is-the-market','The "psychology bill" in your trading is best measured as…', 1,
        array['The gap between planned expectancy and executed expectancy','Your monthly commission total','The number of losing trades'], 1),
      ('psychology','mind-is-the-market','Loss aversion typically causes traders to…', 2,
        array['Hold losers and cut winners','Cut losers and hold winners','Trade smaller over time'], 1),
      ('psychology','fear-and-greed','A trader whose largest losses are multiples of planned risk is showing which fear pattern?', 1,
        array['Stop-pulling (fear of being wrong)','FOMO chasing','Hesitation'], 1),
      ('psychology','fear-and-greed','The most reliable antidote to in-the-moment fear and greed is…', 2,
        array['Pre-commitment: size by formula, exits as placed orders','Trading only when calm','Watching more indicators'], 1),
      ('psychology','tilt-and-revenge','The revenge spiral usually starts with…', 1,
        array['A small loss that feels unfair','A large planned loss','A winning streak'], 1),
      ('psychology','tilt-and-revenge','Your written circuit breaker says three losses ends the session. Today''s third loss felt unfair. You should…', 2,
        array['Close the platform — the rule was decided while calm, so it stands','Take one more small trade to end green','Halve size and continue'], 1),
      ('psychology','discipline-by-design','In a discipline system, the playbook''s core rule is…', 1,
        array['If a setup isn''t written in the playbook, it doesn''t get traded','Trade anything with good risk/reward','Add every new setup you see online'], 1),
      ('psychology','discipline-by-design','"Make $500 today" is a poor goal because…', 2,
        array['You don''t control outcomes, only process — it forces trades on empty days','It''s too ambitious for beginners','Goals should be weekly, not daily'], 1),
      ('psychology','surviving-drawdown','High rule-compliance during a losing streak most likely means…', 1,
        array['Variance — keep executing, change nothing','The strategy is broken and needs replacing','You should double size to recover'], 1),
      ('psychology','surviving-drawdown','Risking 1% instead of 5% per trade matters psychologically because…', 2,
        array['It makes a normal 10-loss streak survivable and less frightening','Smaller trades win more often','Brokers reward small positions'], 1),
      ('psychology','performance-routines','Rehearsing stop-outs and missed setups before the session helps because…', 1,
        array['Pre-processed situations trigger less tilt when they happen','It guarantees fewer losses','Visualization attracts winning trades'], 1),
      ('psychology','performance-routines','The weekly review allows at most one rule change because…', 2,
        array['Constant overhauls prevent any sample from accumulating','Rules should never change','More changes require manager approval'], 1)
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
