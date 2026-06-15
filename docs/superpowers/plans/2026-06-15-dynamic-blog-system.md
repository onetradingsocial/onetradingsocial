# Dynamic Blog System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded blog cards and article content with a data-driven system: all posts live in `data/posts.json`, both `blog.html` and `blog-post.html` fetch it at runtime and render via vanilla JS, and clean `/blog/:slug` URLs are handled by a Vercel rewrite.

**Architecture:** Static JSON file served alongside the HTML. On page load, vanilla JS fetches `/data/posts.json`, finds the relevant post(s), and populates empty skeleton DOM elements. `vercel.json` adds a rewrite so `/blog/some-slug` serves `blog-post.html`, which reads the slug from `window.location.pathname`.

**Tech Stack:** Vanilla JS (no framework), static JSON, Vercel rewrites, Python 3 for file modifications.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `Website/data/posts.json` | Single source of truth for all blog posts |
| Modify | `Website/vercel.json` | Add `/blog/:slug` → `blog-post.html` rewrite |
| Modify | `Website/blog-post.html` | Replace hardcoded article content with JS-driven skeleton |
| Modify | `Website/blog.html` | Clear hardcoded featured card and grid; add JS renderer |

---

## Task 1: Create `Website/data/posts.json`

**Files:**
- Create: `Website/data/posts.json`

- [ ] **Step 1: Create the data directory and posts.json**

Run from the `Website/` directory:

```powershell
New-Item -ItemType Directory -Force Website\data
```

Then write `Website/data/posts.json` with the following complete content. The `body` field for each post is an HTML string rendered via `innerHTML`:

```json
[
  {
    "slug": "why-a-trading-journal",
    "title": "Why a trading journal is the highest-ROI habit you're not building",
    "excerpt": "Most traders track P&L and call it a day. The ones who actually compound do something quieter — they review. Here's the case for journaling, and a framework that takes ten minutes.",
    "category": "Journaling",
    "tags": ["journaling", "process", "review", "discipline"],
    "readtime": "9 min",
    "published_date": "2026-06-03",
    "author_name": "Maya Okonkwo",
    "author_role": "Head of Trader Education · TradingSocial",
    "author_bio": "Maya writes about the behavioural side of trading — journaling, review routines and the quiet habits that separate consistent traders from busy ones. Former prop-desk coach.",
    "author_color": "linear-gradient(135deg,#7C5CE6,#C840BC)",
    "featured": true,
    "thumb_color": "t-violet",
    "thumb_icon": "<svg viewBox='0 0 24 24' fill='none'><path d='M5 4h11l3 3v13H5z' stroke='currentColor' stroke-width='2' stroke-linejoin='round'></path><path d='M9 9h6M9 13h6M9 17h3' stroke='currentColor' stroke-width='2' stroke-linecap='round'></path></svg>",
    "image": null,
    "body": "<p class='dek'>Ask a hundred traders what they do after the close and most will say the same thing: they check the number. Green day, good day. Red day, bad day. The problem is that the number is the one piece of feedback that teaches you almost nothing.</p>\n\n<p>A trading journal is the cheapest edge available to a retail trader. It costs no money, requires no special data feed, and works on every market and every timeframe. Yet it's the first habit to get dropped and the last to get picked back up — because reviewing your own decisions is uncomfortable in a way that watching P&amp;L tick up never is.</p>\n\n<p>This piece makes the case for journaling as your highest-ROI habit, then gives you a framework you can run in about ten minutes a day.</p>\n\n<h2>Why P&amp;L is the wrong teacher</h2>\n<p>Profit and loss is an <strong>outcome</strong>, and outcomes are noisy. You can place a textbook trade — right setup, right size, right exit plan — and still lose because the market did something improbable. You can also break every rule you have and get paid for it. If you only judge yourself by the result, you'll learn the wrong lesson roughly half the time.</p>\n\n<p>What you actually want to improve is your <strong>process</strong>: the quality of the decisions you control. A journal is how you separate the two. It lets you ask a better question than \"did I make money?\" — namely, \"did I follow my plan, and was the plan any good?\"</p>\n\n<blockquote>You can't manage what you don't measure — and P&amp;L measures luck and skill in the same number.</blockquote>\n\n<h2>What a useful entry actually contains</h2>\n<p>A journal entry isn't a diary. It's structured data about a decision, captured while it's still fresh. The best entries are short but consistent — the same fields every time, so patterns surface across dozens of trades.</p>\n\n<p>At minimum, log these for every trade:</p>\n<ul>\n  <li><strong>The setup</strong> — what pattern or thesis made this a trade, in one line.</li>\n  <li><strong>Risk</strong> — where your stop was and what fraction of your account it risked.</li>\n  <li><strong>Execution</strong> — did you take the entry and exit you planned, or improvise?</li>\n  <li><strong>Emotion</strong> — one word for your state: calm, rushed, bored, revenge.</li>\n  <li><strong>Mistake tags</strong> — if you broke a rule, name it. \"Moved stop.\" \"Sized up.\" \"No setup.\"</li>\n</ul>\n\n<div class='callout'>\n  <span class='ic'><svg viewBox='0 0 24 24' fill='none'><path d='M12 16v-5M12 8h.01' stroke='currentColor' stroke-width='2' stroke-linecap='round'></path><circle cx='12' cy='12' r='9' stroke='currentColor' stroke-width='2'></circle></svg></span>\n  <div>\n    <b>Tag mistakes the same way every time</b>\n    <p>A fixed vocabulary of errors turns vague regret into a sortable list. After 50 trades you'll see which single tag is costing you the most — and that's the one habit worth fixing first.</p>\n  </div>\n</div>\n\n<h2>The ten-minute daily review</h2>\n<p>Journaling fails when it feels like homework. Keep the daily loop tight enough that you'll actually do it after every session:</p>\n<ol>\n  <li><strong>Log while warm.</strong> Fill the fields above within a few minutes of closing each position, before your memory rewrites the story.</li>\n  <li><strong>Read the day back.</strong> Skim every entry once. Note any trade where the outcome and the process disagree — a loss you're proud of, or a win you're not.</li>\n  <li><strong>Pick one lesson.</strong> Not ten. One. Write a single sentence you'd tell yourself before tomorrow's open.</li>\n</ol>\n\n<p>That's it. The compounding doesn't come from any single entry — it comes from doing this every day until the patterns are impossible to ignore.</p>\n\n<h2>The weekly zoom-out</h2>\n<p>Daily review keeps you honest; weekly review is where the strategy decisions live. Once a week, step back and look at the aggregate, not the individual trades:</p>\n<ul>\n  <li>Which setup made or lost you the most — and is your sizing matched to that?</li>\n  <li>What's your most expensive mistake tag this week versus last?</li>\n  <li>How did your best trades feel at the time? Calm usually wins; rushed usually doesn't.</li>\n</ul>\n\n<p>This is the layer where a journal stops being a record and becomes a feedback system. You're no longer asking whether you had a good week — you're asking what to do more of, and what to stop.</p>\n\n<blockquote>Discipline isn't a personality trait. It's a review habit you can build like any other.</blockquote>\n\n<h2>Start smaller than you think</h2>\n<p>The most common journaling failure is starting too ambitious — twenty fields, screenshots, a spreadsheet with formulas — and quitting in a week. Start with three fields and a one-line lesson. Make it so small you can't talk yourself out of it. You can always add structure once the habit is real.</p>\n\n<p>The traders who improve fastest aren't the ones with the best entries. They're the ones who never skipped the review. A journal is just the place that habit lives.</p>"
  },
  {
    "slug": "win-rate-is-lying-to-you",
    "title": "Win rate is lying to you: a plain-English guide to R-multiples and expectancy",
    "excerpt": "A 40% win rate can crush a 70% one. Here's the math that actually decides whether you make money.",
    "category": "Analytics",
    "tags": ["win rate", "R-multiple", "expectancy", "risk-reward", "analytics"],
    "readtime": "7 min",
    "published_date": "2026-06-01",
    "author_name": "Daniel Reyes",
    "author_role": "Quantitative Analyst · TradingSocial",
    "author_bio": "Daniel runs quantitative research at TradingSocial, building the analytics engine that turns trade logs into actionable edge metrics.",
    "author_color": "linear-gradient(135deg,#3FB6E8,#7C5CE6)",
    "featured": false,
    "thumb_color": "t-cyan",
    "thumb_icon": "<svg viewBox='0 0 24 24' fill='none'><path d='M4 19V9M10 19V5M16 19v-7M22 19H2' stroke='currentColor' stroke-width='2' stroke-linecap='round'></path></svg>",
    "image": null,
    "body": "<p class='dek'>A trader walks into a forum and posts their stats: 72% win rate, 180 trades. The replies flood in — \"nice edge,\" \"solid system,\" \"what is your setup?\" Nobody asks the one question that actually matters: what is your average winner versus your average loser?</p>\n\n<p>Because a 72% win rate is completely compatible with a losing system. And a 35% win rate is completely compatible with a highly profitable one. Win rate, on its own, tells you almost nothing about whether your strategy makes money. Yet it remains the headline stat most retail traders optimize for — and that obsession quietly bleeds accounts dry.</p>\n\n<h2>The Win Rate Trap: Why the Most-Watched Number Misleads You</h2>\n<p>Win rate measures how often you are right. It does not measure how much you make when you are right, or how much you lose when you are wrong. Those two omissions make it nearly useless as a standalone metric.</p>\n\n<p>Here is the arithmetic that exposes the trap. Suppose you have a 70% win rate. Your average winner is $80, your average loser is $200. Run 100 trades:</p>\n<ul>\n  <li>70 winners × $80 = $5,600 profit</li>\n  <li>30 losers × $200 = $6,000 loss</li>\n  <li>Net result: <strong>–$400</strong></li>\n</ul>\n\n<p>You were right nearly three-quarters of the time and still lost money. Now flip the scenario: 40% win rate, average winner $300, average loser $120.</p>\n<ul>\n  <li>40 winners × $300 = $12,000 profit</li>\n  <li>60 losers × $120 = $7,200 loss</li>\n  <li>Net result: <strong>+$4,800</strong></li>\n</ul>\n<p>You were wrong 60% of the time and turned a meaningful profit. Win rate is not the edge. The relationship between winner size and loser size is the edge.</p>\n\n<h2>R-Multiple: The Unit That Makes Systems Comparable</h2>\n<p>The cleanest way to measure that relationship is the <strong>R-multiple</strong>. R is simply your initial risk on a trade — the distance in dollars from entry to your stop loss. Every outcome is then expressed as a multiple of that risk.</p>\n\n<p>The formula: <em>R-Multiple = (Exit Price − Entry Price) ÷ (Entry Price − Stop Loss)</em></p>\n\n<p>If you risk $100 on a trade and close it for a $250 profit, your R-multiple is +2.5R. If you get stopped out, your R-multiple is −1R. If you exit early and lose $60, it is −0.6R. Suddenly every trade, regardless of position size or instrument, speaks the same language.</p>\n\n<blockquote>Some professional trading systems run at 25–35% win rates. They lose most of the time. When they win, they win big — often at 5R, 8R, or higher. The math works because expectancy, not win rate, is the engine.</blockquote>\n\n<h2>Expectancy: The One Number That Tells You If Your System Works</h2>\n<p><strong>Expectancy</strong> combines win rate, average winner, and average loser into a single number that predicts your average profit or loss per unit of risk across many trades.</p>\n\n<p>The formula: <em>Expectancy = (Win Rate × Average Win in R) − (Loss Rate × Average Loss in R)</em></p>\n\n<p>A positive expectancy means the system is profitable over a large sample. A negative expectancy means no amount of discipline or money management will save you — you are playing a losing game. Profitability benchmarks: most profitable retail strategies produce expectancy between 0.2R and 0.6R per trade. Anything above 0.5R sustained over 100+ trades is a genuinely strong edge.</p>\n\n<h2>Practical Steps: Start Calculating Expectancy This Week</h2>\n<ol>\n  <li><strong>Define your R before every trade.</strong> Entry price minus stop loss price, multiplied by position size. Write it down before you enter.</li>\n  <li><strong>Log every exit as an R-multiple.</strong> Profit or loss divided by your defined R. One column in your journal, every trade.</li>\n  <li><strong>Calculate rolling expectancy every 20 trades.</strong> Apply the formula. If it is negative, you have a data problem to solve — not a mindset problem.</li>\n  <li><strong>Segment by setup type.</strong> Your overall expectancy may be positive while one specific pattern is dragging it down. Segmentation finds the leak.</li>\n  <li><strong>Set a minimum R target per trade type.</strong> Many profitable systems require a minimum 2R potential before entry is valid.</li>\n  <li><strong>Review win rate last, not first.</strong> After you know your expectancy and average R-multiple, then check win rate to understand the shape of the system — not to judge whether it works.</li>\n</ol>\n\n<h2>One Metric, Fewer Illusions</h2>\n<p>Win rate flatters. Expectancy does not. It will tell you in cold R-units whether your edge is real or whether you have been winning the battle of individual trades while losing the war of accumulated outcome. The traders who compound over years are not the ones who are right most often. They are the ones who make more when they are right than they lose when they are wrong — and they have the data to prove it.</p>"
  },
  {
    "slug": "how-to-tag-your-trading-mistakes",
    "title": "How to tag your trading mistakes — and actually stop repeating them",
    "excerpt": "A simple taxonomy of errors turns vague regret into a checklist you can fix, one tag at a time.",
    "category": "Journaling",
    "tags": ["journaling", "mistakes", "process", "tags"],
    "readtime": "6 min",
    "published_date": "2026-05-28",
    "author_name": "Maya Okonkwo",
    "author_role": "Head of Trader Education · TradingSocial",
    "author_bio": "Maya writes about the behavioural side of trading — journaling, review routines and the quiet habits that separate consistent traders from busy ones. Former prop-desk coach.",
    "author_color": "linear-gradient(135deg,#7C5CE6,#C840BC)",
    "featured": false,
    "thumb_color": "t-violet",
    "thumb_icon": "<svg viewBox='0 0 24 24' fill='none'><path d='M4 7h16M4 12h16M4 17h10' stroke='currentColor' stroke-width='2' stroke-linecap='round'></path><circle cx='19' cy='17' r='2.5' stroke='currentColor' stroke-width='2'></circle></svg>",
    "image": null,
    "body": "<p class='dek'>Vague regret doesn't improve your trading. A sortable list of named errors does. Here is how to build one — and how to use it.</p>\n\n<p>Most traders know what they did wrong after a bad trade. The problem is they describe it differently every time: \"I was impatient,\" \"I jumped the gun,\" \"I chased it,\" \"I didn't wait for confirmation.\" These phrases all mean roughly the same thing, but they can't be counted, sorted, or graphed. You can't manage what you can't measure, and you can't measure vagueness.</p>\n\n<p>The solution is a fixed vocabulary of mistake tags — a short list of specific error names you apply to every trade that went off-plan. The vocabulary is yours to define, but it has to be consistent. The same error always gets the same tag.</p>\n\n<h2>What belongs in the vocabulary</h2>\n<p>Start with five tags and add more only when an error keeps happening and doesn't fit anything you have. Common starting points:</p>\n<ul>\n  <li><strong>Chased</strong> — entered after the entry point had passed, buying into strength rather than waiting for the setup.</li>\n  <li><strong>Moved stop</strong> — widened or cancelled your stop loss after price moved against you.</li>\n  <li><strong>Sized up</strong> — took a position larger than your rule allows, usually because the trade felt certain.</li>\n  <li><strong>No setup</strong> — traded out of boredom or FOMO, not because a genuine setup was present.</li>\n  <li><strong>Early exit</strong> — cut a winner before it hit the target because the feeling of taking profit overwhelmed the plan.</li>\n</ul>\n\n<h2>Using the data</h2>\n<p>After 30 tagged trades, sort by tag and total the losses associated with each. Almost always, one or two tags account for the majority of preventable losses. That's your next habit to fix — not \"improve discipline\" in the abstract, but specifically: stop doing the one thing the data says is costing you most.</p>\n\n<p>TradingSocial lets you apply tags at log time and filter your P&amp;L by tag in the analytics view. The numbers find the leak; you just have to stop it.</p>"
  },
  {
    "slug": "position-sizing-101",
    "title": "Position sizing 101: the math that keeps you in the game",
    "excerpt": "Entries are guesses. Position size is a decision. Here's the framework that separates the traders who survive long enough to get good.",
    "category": "Risk & Sizing",
    "tags": ["risk management", "position sizing", "drawdown", "Kelly"],
    "readtime": "8 min",
    "published_date": "2026-05-24",
    "author_name": "Priya Anand",
    "author_role": "Risk Educator · TradingSocial",
    "author_bio": "Priya specialises in risk education for retail traders, focused on position sizing, drawdown management, and the mathematics of survival in volatile markets.",
    "author_color": "linear-gradient(135deg,#00C9A7,#7C5CE6)",
    "featured": false,
    "thumb_color": "t-green",
    "thumb_icon": "<svg viewBox='0 0 24 24' fill='none'><path d='M12 3l7 3v5c0 5-3 7.5-7 9-4-1.5-7-4-7-9V6l7-3z' stroke='currentColor' stroke-width='2' stroke-linejoin='round'></path><path d='M9.5 12l1.8 1.8L15 10' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'></path></svg>",
    "image": null,
    "body": "<p class='dek'>You can have a positive-expectancy strategy and still blow up your account if you size wrong. Here is the math that keeps you in the game long enough to win.</p>\n\n<p>Position sizing is the most important decision in trading that almost nobody talks about. Traders obsess over entries, exits, indicators, and setups — but position size determines whether a losing streak ends your account or feels like the cost of doing business. It's the difference between a drawdown you survive and one you don't.</p>\n\n<h2>Fixed fractional sizing</h2>\n<p>The simplest rule that works: risk no more than 1–2% of your account on any single trade. If your account is $10,000 and your rule is 1%, you risk $100 per trade. This means your stop loss placement and position size are linked: if your stop is $0.50 from your entry and you're risking $100, your position size is 200 shares.</p>\n\n<p>The formula: <em>Position Size = Risk Amount ÷ (Entry Price − Stop Price)</em></p>\n\n<p>Most traders get this backwards — they decide how many shares to buy and then set a stop wherever the chart \"looks right.\" The correct order is: place the stop where it's technically valid, then size the position to match your risk rule.</p>\n\n<h2>Why the percentage matters</h2>\n<p>At 1% risk per trade, you can lose 20 trades in a row and still have 82% of your starting capital. At 10% risk per trade, 20 losing trades leaves you with 12%. The math of compounding losses is severe — a 50% drawdown requires a 100% gain just to break even. Keeping individual risk small keeps you in the game long enough for your edge to play out over hundreds of trades.</p>\n\n<blockquote>Survive first. Compound later. Position sizing is how you do both at once.</blockquote>\n\n<h2>Adapting size to volatility</h2>\n<p>A fixed stop distance in dollar terms means your position size varies with price — a $50 stock with a $1 stop gives you 100 shares at $100 risk, while a $500 stock with the same $1 stop gives the same. But volatility varies too: in a high-VIX environment, your technically-valid stop may need to be wider to avoid noise-out. When stops widen, size down so your dollar risk stays constant. Never widen the stop without cutting the shares.</p>"
  },
  {
    "slug": "the-psychology-of-revenge-trading",
    "title": "The psychology of revenge trading — and five ways to break the loop",
    "excerpt": "The trade after a loss is the most dangerous one you'll place. Here's why, and how to interrupt it.",
    "category": "Psychology",
    "tags": ["psychology", "revenge trading", "loss aversion", "discipline"],
    "readtime": "6 min",
    "published_date": "2026-05-20",
    "author_name": "Leo Carter",
    "author_role": "Trading Psychology Writer · TradingSocial",
    "author_bio": "Leo covers the behavioural economics of trading — why smart people make predictable emotional mistakes in markets, and what the research says about changing that.",
    "author_color": "linear-gradient(135deg,#FF7A4D,#C840BC)",
    "featured": false,
    "thumb_color": "t-mag",
    "thumb_icon": "<svg viewBox='0 0 24 24' fill='none'><path d='M9 18c0 1 .8 2 3 2s3-1 3-2M8.5 11a3.5 3.5 0 117 0c0 2-1 2.5-1.2 4H9.7C9.5 13.5 8.5 13 8.5 11z' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'></path><path d='M12 3v2M5 6l1.5 1.5M19 6l-1.5 1.5' stroke='currentColor' stroke-width='2' stroke-linecap='round'></path></svg>",
    "image": null,
    "body": "<p class='dek'>It happens fast. You take a loss, feel the sting, and within minutes you're already looking for the next trade — not because a genuine setup is there, but because some part of your brain is determined to get the money back. This is revenge trading, and it costs traders more than the original loss did.</p>\n\n<p>The psychology is straightforward: losses feel roughly twice as bad as equivalent gains feel good, a phenomenon behavioural economists call loss aversion. A sudden loss creates a powerful drive to restore the status quo, which the market-trained part of your brain translates into \"place another trade.\" The problem is that this drive bypasses the slow, rational thinking that good trade selection requires. You're now choosing setups with emotion, not edge.</p>\n\n<h2>The five circuit breakers</h2>\n<ol>\n  <li><strong>Set a daily loss limit before you start.</strong> Decide in advance the dollar amount or percentage that triggers a mandatory stop for the day. When you hit it, you are done — no exceptions. This removes the decision in the moment when willpower is lowest.</li>\n  <li><strong>Log the loss immediately.</strong> Open your journal, write what happened. The act of writing switches you from reactive mode to analytical mode. It's hard to revenge trade and journal at the same time.</li>\n  <li><strong>Introduce a 15-minute timer.</strong> After a loss, you cannot place another trade until 15 minutes have elapsed. Set a timer, walk away from the screen. The urge usually fades faster than you expect.</li>\n  <li><strong>Require a checklist before re-entry.</strong> List the 3–5 objective criteria your best setups have. Before placing any trade after a loss, the setup must score on all criteria. Revenge trades almost never pass.</li>\n  <li><strong>Review your tag data.</strong> Open your journal and look at your \"chased\" or \"no setup\" tag losses. Seeing previous revenge trades quantified in dollars deflates the urge more effectively than willpower alone.</li>\n</ol>\n\n<p>Revenge trading is not a personality flaw — it's a predictable response to loss that nearly every trader experiences. The goal isn't to stop feeling the urge. The goal is to have a system that makes acting on it structurally difficult.</p>"
  },
  {
    "slug": "backtesting-vs-forward-testing",
    "title": "Backtesting vs. forward testing: what actually validates a strategy",
    "excerpt": "A backtest is a hypothesis, not proof. Here's how to tell the difference — and when to trust your numbers.",
    "category": "Strategy",
    "tags": ["backtesting", "forward testing", "strategy", "curve fitting", "validation"],
    "readtime": "10 min",
    "published_date": "2026-05-16",
    "author_name": "Daniel Reyes",
    "author_role": "Quantitative Analyst · TradingSocial",
    "author_bio": "Daniel runs quantitative research at TradingSocial, building the analytics engine that turns trade logs into actionable edge metrics.",
    "author_color": "linear-gradient(135deg,#3FB6E8,#7C5CE6)",
    "featured": false,
    "thumb_color": "t-orange",
    "thumb_icon": "<svg viewBox='0 0 24 24' fill='none'><circle cx='12' cy='12' r='8' stroke='currentColor' stroke-width='2'></circle><circle cx='12' cy='12' r='3.5' stroke='currentColor' stroke-width='2'></circle><path d='M12 2v3M12 19v3M2 12h3M19 12h3' stroke='currentColor' stroke-width='2' stroke-linecap='round'></path></svg>",
    "image": null,
    "body": "<p class='dek'>A backtest that says your strategy works is a hypothesis, not a proof. Forward testing is where you find out whether it's real.</p>\n\n<p>Backtesting is the practice of running a trading strategy against historical price data to see how it would have performed. It's an invaluable first step — it can quickly eliminate strategies that simply don't have positive expectancy over large samples, saving you months of live experimentation. But backtesting has a flaw its output numbers rarely admit: the data you tested on shaped the rules you're now testing.</p>\n\n<h2>Curve fitting: the silent failure mode</h2>\n<p>When you repeatedly tweak a strategy's parameters to improve its historical performance, you're fitting the rules to the noise in the data, not to an underlying edge. The result is a strategy that looks great on past data and struggles on new data — because the \"edge\" was pattern-matching to anomalies that don't repeat. Classic signs of curve fitting: too many parameters, perfect performance on a specific period followed by poor performance on adjacent periods, and results significantly better than any sensible benchmark would suggest.</p>\n\n<h2>Walk-forward testing</h2>\n<p>The cleanest solution is walk-forward analysis: divide your historical data into in-sample and out-of-sample periods. Optimise on the in-sample period, then test the result unchanged on the out-of-sample period. Repeat across multiple windows. If the strategy holds up out-of-sample across most windows, you have real evidence of an edge. If it degrades sharply, the backtest was overfit.</p>\n\n<blockquote>A strategy that survives out-of-sample is a candidate. One that doesn't is a lesson.</blockquote>\n\n<h2>Forward testing: the real answer</h2>\n<p>Forward testing — running the strategy in real time, with real or simulated money, on data that didn't exist when you built the strategy — is the only definitive test. Paper trade for a statistically meaningful sample (minimum 100 trades for a day-trading strategy). Only if edge persists forward does it deserve real capital. Backtesting finds candidates; forward testing confirms them.</p>\n\n<p>The discipline required: once you commit to forward testing, you cannot change the rules mid-test. Any parameter change resets the clock. This constraint is uncomfortable, but it's what separates data from rationalisation.</p>"
  },
  {
    "slug": "from-demo-to-live",
    "title": "From demo to live: a calm framework for going real",
    "excerpt": "Demo teaches you about your strategy. Live teaches you about yourself. Here's how to cross the gap without blowing up.",
    "category": "Beginner",
    "tags": ["beginner", "demo trading", "live trading", "transition", "psychology"],
    "readtime": "7 min",
    "published_date": "2026-05-12",
    "author_name": "Priya Anand",
    "author_role": "Risk Educator · TradingSocial",
    "author_bio": "Priya specialises in risk education for retail traders, focused on position sizing, drawdown management, and the mathematics of survival in volatile markets.",
    "author_color": "linear-gradient(135deg,#00C9A7,#7C5CE6)",
    "featured": false,
    "thumb_color": "t-cyan",
    "thumb_icon": "<svg viewBox='0 0 24 24' fill='none'><path d='M12 4L2 9l10 5 10-5-10-5z' stroke='currentColor' stroke-width='2' stroke-linejoin='round'></path><path d='M6 11v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'></path></svg>",
    "image": null,
    "body": "<p class='dek'>Your demo account performance tells you about your strategy. Your live account will tell you about yourself. Here is how to cross the gap calmly.</p>\n\n<p>The transition from demo to live trading is one of the most psychologically significant events in a new trader's journey — and most traders underestimate it. Demo accounts teach you whether your strategy has positive expectancy, whether entries and exits are executable, and whether your read time is realistic. They teach you almost nothing about the emotional experience of trading real money.</p>\n\n<h2>What changes when it's real</h2>\n<p>With real capital, losses feel tangible. A $200 loss on a demo account is a number. A $200 loss on a live account is groceries, a night out, a fraction of rent. The emotional weight changes your decision-making in ways you can't fully anticipate until it happens. Traders who were calm and disciplined on demo often find themselves hesitating at entries, cutting winners early, and holding losers too long — all triggered by the new psychological stakes.</p>\n\n<h2>A structured transition</h2>\n<p>The goal is to make live trading feel as similar to demo as possible for as long as possible. A practical framework:</p>\n<ol>\n  <li><strong>Start at 10% of your intended position size.</strong> If you plan to trade 100-share lots, start with 10. The strategy is identical; the emotional load is a fraction.</li>\n  <li><strong>Gate progression on data, not on comfort.</strong> Set a rule: you cannot increase size until you've matched your demo win rate or expectancy for 30 live trades at the smaller size. This prevents impatience from rushing the process.</li>\n  <li><strong>Journal every live trade exactly as you did on demo.</strong> Same fields, same review. The journal keeps behaviour consistent across environments.</li>\n</ol>\n\n<p>The goal isn't to eliminate the emotional experience of trading — that's not possible. The goal is to keep position size small enough that the emotional experience doesn't change your decisions while you adapt to it.</p>"
  },
  {
    "slug": "reading-the-tape",
    "title": "Reading the tape: order-flow basics every new trader skips",
    "excerpt": "Price action shows you what happened. Order flow shows you how. The basics that give context to every candle.",
    "category": "Strategy",
    "tags": ["order flow", "tape reading", "bid ask", "volume", "strategy"],
    "readtime": "9 min",
    "published_date": "2026-05-08",
    "author_name": "Leo Carter",
    "author_role": "Trading Psychology Writer · TradingSocial",
    "author_bio": "Leo covers the behavioural economics of trading — why smart people make predictable emotional mistakes in markets, and what the research says about changing that.",
    "author_color": "linear-gradient(135deg,#FF7A4D,#C840BC)",
    "featured": false,
    "thumb_color": "t-violet",
    "thumb_icon": "<svg viewBox='0 0 24 24' fill='none'><path d='M3 17l5-5 4 3 6-7' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'></path><path d='M16 8h4v4' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'></path></svg>",
    "image": null,
    "body": "<p class='dek'>Price action shows you what happened. Order flow shows you how it happened. The distinction gives every candle a second layer of context.</p>\n\n<p>A candle that closed up 0.5% means something different if it was driven by a single institutional buyer accumulating at the ask versus thousands of small retail orders bouncing off a round number. Reading the tape — understanding the mechanics of bids, asks, and order flow — gives you context that candlestick charts alone don't provide.</p>\n\n<h2>Bid, ask, and what the spread tells you</h2>\n<p>The bid is the highest price a buyer is willing to pay right now. The ask is the lowest price a seller is willing to accept. Trades happen when these two sides agree — either a buyer lifts the ask (paying up, a sign of urgency), or a seller hits the bid (selling down, also a sign of urgency). Trades at the ask suggest buying pressure; trades at the bid suggest selling pressure. When more volume is printing at the ask than the bid, buyers are aggressive — and price tends to move up.</p>\n\n<h2>Volume clusters and large prints</h2>\n<p>Large prints — single trades significantly bigger than the average — can signal institutional activity. A 50,000-share print at the bid when the average trade is 200 shares is unusual; it may represent a block sale or an algorithmic execution. Volume profile tools show where most volume traded over a given period, revealing price levels where significant buyer-seller agreements occurred — these often act as support or resistance on subsequent tests.</p>\n\n<blockquote>The tape tells you who's in a hurry. Urgency is the signal. Price is just the result.</blockquote>\n\n<p>Reading the tape is a skill built slowly, through observation and journaling. Log unusual prints and volume patterns alongside your standard entry data, then review them in aggregate. Over time, you'll develop intuition for what normal order flow looks like in the instruments you trade — and when something is different.</p>"
  },
  {
    "slug": "building-a-pre-market-routine",
    "title": "Building a pre-market routine that actually sticks",
    "excerpt": "Discipline isn't willpower, it's a checklist. The ten-minute routine that frames every session.",
    "category": "Journaling",
    "tags": ["journaling", "routine", "pre-market", "process", "discipline"],
    "readtime": "5 min",
    "published_date": "2026-05-04",
    "author_name": "Maya Okonkwo",
    "author_role": "Head of Trader Education · TradingSocial",
    "author_bio": "Maya writes about the behavioural side of trading — journaling, review routines and the quiet habits that separate consistent traders from busy ones. Former prop-desk coach.",
    "author_color": "linear-gradient(135deg,#7C5CE6,#C840BC)",
    "featured": false,
    "thumb_color": "t-green",
    "thumb_icon": "<svg viewBox='0 0 24 24' fill='none'><circle cx='12' cy='12' r='9' stroke='currentColor' stroke-width='2'></circle><path d='M12 7v5l3.5 2' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'></path></svg>",
    "image": null,
    "body": "<p class='dek'>The ten minutes before market open are some of the most valuable you spend as a trader. Most traders waste them refreshing yesterday's P&amp;L. Here's a routine that actually prepares you.</p>\n\n<p>A structured pre-market routine does something deceptively simple: it puts you in the right mental state before the first opportunity arrives, rather than after it's gone. The routine is the same every day — that repetition is the point. It signals to your nervous system that trading is a professional activity governed by process, not by how you feel when you wake up.</p>\n\n<h2>The five-item checklist</h2>\n<ol>\n  <li><strong>Review yesterday's journal entry.</strong> Read your one-line lesson from yesterday. If you tagged a mistake, remind yourself of it. Thirty seconds of deliberate memory is enough to influence behaviour.</li>\n  <li><strong>Mark key levels on the chart.</strong> Yesterday's high and low, the previous week's range, any overnight gap fills or unfilled volume voids. Having these marked before open means you see the reaction in real time instead of retrospectively.</li>\n  <li><strong>Note the macro context.</strong> Any scheduled news releases? Earnings? Central bank decisions? You don't need to predict the outcome; you need to know that volatility is scheduled so you can size accordingly or step aside.</li>\n  <li><strong>Set your daily risk limit.</strong> Decide in advance the maximum you'll lose today before closing the platform. Writing this number down before open removes the negotiation that happens in the heat of a drawdown.</li>\n  <li><strong>Write one intention sentence.</strong> Not a prediction — an intention. \"Today I will only trade my A-setups and walk away after two losers.\" This sentence is your anchor when things get noisy.</li>\n</ol>\n\n<p>The routine works because it's repeatable. Every session starts the same way regardless of whether yesterday was green or red. Add it to your journal as a pre-session block and the habit compounds automatically.</p>"
  },
  {
    "slug": "patience-as-an-edge",
    "title": "Patience as an edge: the quiet skill nobody sells you",
    "excerpt": "The best setups are rare on purpose. Why doing nothing is often the highest-expectancy move.",
    "category": "Psychology",
    "tags": ["psychology", "patience", "overtrading", "selectivity", "edge"],
    "readtime": "6 min",
    "published_date": "2026-04-30",
    "author_name": "Priya Anand",
    "author_role": "Risk Educator · TradingSocial",
    "author_bio": "Priya specialises in risk education for retail traders, focused on position sizing, drawdown management, and the mathematics of survival in volatile markets.",
    "author_color": "linear-gradient(135deg,#00C9A7,#7C5CE6)",
    "featured": false,
    "thumb_color": "t-orange",
    "thumb_icon": "<svg viewBox='0 0 24 24' fill='none'><path d='M12 21s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.5-7 10-7 10z' stroke='currentColor' stroke-width='2' stroke-linejoin='round'></path></svg>",
    "image": null,
    "body": "<p class='dek'>Nobody sells patience as a trading strategy because patience doesn't generate commission revenue or provide the dopamine hit of an active position. But ask any consistently profitable trader how often they're actually in the market — the answer will surprise you.</p>\n\n<p>The best opportunities come infrequently, and most of the time, the highest-expectancy move is to wait. This isn't a mindset cliché — it's arithmetic.</p>\n\n<h2>The overtrading trap</h2>\n<p>New traders often equate activity with progress. Being in a trade feels productive; sitting out feels like missing opportunities. The result is overtrading: placing mediocre setups because a good setup hasn't appeared yet. Overtraded accounts pay more in commissions and slippage, take on unnecessary risk in setups with neutral or negative expectancy, and gradually dilute whatever edge exists by surrounding it with noise.</p>\n\n<p>The mathematics are direct: if your highest-expectancy setups produce 0.5R per trade and occur twice a week, and you add five more lower-quality trades averaging −0.1R, your weekly expectancy drops from 1.0R to 0.5R. Activity hurt performance.</p>\n\n<h2>Making inactivity systematic</h2>\n<p>Patience becomes sustainable when it's governed by rules rather than willpower. Define your A-setups precisely — the specific criteria that must be met before a trade is valid. Count how many A-setups appeared last month. If the number is small, that's expected and correct. Your job on days without A-setups is not to find alternatives; it's to close the platform.</p>\n\n<p>Journal the days you don't trade. Note what you observed and what setups were almost-but-not-quite there. Over time, the journal creates a record that inactivity on B-setup days is associated with better weekly outcomes than forcing trades. Data beats willpower every time.</p>"
  }
]
```

- [ ] **Step 2: Verify the JSON is valid**

```powershell
python -c "import json; data = json.load(open('Website/data/posts.json')); print(f'Valid JSON: {len(data)} posts, featured slug: {next(p[\"slug\"] for p in data if p[\"featured\"])}')"
```

Expected output:
```
Valid JSON: 10 posts, featured slug: why-a-trading-journal
```

- [ ] **Step 3: Commit**

```powershell
git add Website/data/posts.json
git commit -m "feat: add data/posts.json with 10 seeded blog posts"
```

---

## Task 2: Update `Website/vercel.json` — Add Blog Slug Rewrite

**Files:**
- Modify: `Website/vercel.json`

- [ ] **Step 1: Add the rewrites block**

In `Website/vercel.json`, the current file has no `"rewrites"` key. Add one. The final file should be:

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/(.*)\\.html",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache" }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        {
          "key": "Permissions-Policy",
          "value": "camera=(), microphone=(), geolocation=()"
        }
      ]
    }
  ],
  "rewrites": [
    { "source": "/blog/:slug", "destination": "/blog-post.html" }
  ]
}
```

**Why `/blog/:slug` → `/blog-post.html`:** Vercel's `cleanUrls` only handles top-level files (e.g., `blog.html` → `/blog`). The dynamic slug pattern needs an explicit rewrite so `/blog/win-rate-is-lying-to-you` serves `blog-post.html` rather than 404ing.

- [ ] **Step 2: Commit**

```powershell
git add Website/vercel.json
git commit -m "feat: add /blog/:slug rewrite to vercel.json"
```

---

## Task 3: Update `blog-post.html` — JS-Driven Skeleton

**Files:**
- Modify: `Website/blog-post.html`

The current `blog-post.html` has hardcoded article content for Maya Okonkwo's journaling post. This task replaces everything between the `ARTICLE HERO` and `FINAL CTA` comment markers with an empty skeleton (same CSS classes, new `id` attributes for JS targeting), then appends an inline `<script>` loader before `</body>`.

- [ ] **Step 1: Run the Python modification script**

Save the following as `Website/patch_blog_post.py` and run it from the `Website/` directory:

```python
import re

with open('blog-post.html', 'r', encoding='utf-8') as f:
    html = f.read()

# ── 1. Replace article sections (ARTICLE HERO through end of RELATED section) ──
skeleton = '''<!-- ============================ ARTICLE HERO ============================ -->
<section class="article-hero">
  <div class="wrap">
    <div class="article-head">
      <span class="crumbs">
        <a href="/blog">Blog</a><span class="sep">/</span><span id="js-crumb-cat"></span>
      </span>
      <h1 id="js-title"></h1>
      <p class="standfirst" id="js-standfirst"></p>
      <div class="article-byline">
        <div class="post-meta">
          <span id="js-av" style="width:36px;height:36px;border-radius:50%;flex-shrink:0;display:inline-block;border:1px solid var(--border)"></span>
          <span class="pm-t"><b id="js-author"></b><span id="js-date-read"></span></span>
        </div>
        <div class="article-share">
          <a href="#" aria-label="Share on X"><svg viewBox="0 0 24 24" fill="none"><path d="M4 4l16 16M20 4L4 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg></a>
          <a href="#" aria-label="Copy link"><svg viewBox="0 0 24 24" fill="none"><path d="M9 15l6-6M8 12l-2 2a3 3 0 004 4l2-2M16 12l2-2a3 3 0 00-4-4l-2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></a>
          <a href="#" aria-label="Save"><svg viewBox="0 0 24 24" fill="none"><path d="M6 4h12v16l-6-4-6 4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path></svg></a>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ============================ COVER ============================ -->
<div class="wrap">
  <div class="article-cover reveal" id="js-cover"></div>
</div>

<!-- ============================ BODY ============================ -->
<article class="article-body">
  <div class="prose" id="js-prose"></div>

  <div class="article-foot">
    <div class="article-tags" id="js-tags"></div>
  </div>

  <div class="author-box">
    <span id="js-bio-av" style="width:56px;height:56px;border-radius:50%;flex-shrink:0;border:1px solid var(--border);display:inline-block"></span>
    <div>
      <h5 id="js-bio-name"></h5>
      <span class="role" id="js-bio-role"></span>
      <p id="js-bio-text"></p>
    </div>
  </div>
</article>

<!-- ============================ RELATED ============================ -->
<section class="section related">
  <div class="wrap">
    <div class="postgrid-head">
      <h3>Keep reading</h3>
      <a class="filter-sort" href="/blog"><b>All articles</b>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
      </a>
    </div>
    <div class="postgrid" id="js-related"></div>
  </div>
</section>

'''

# Replace from ARTICLE HERO comment to (but not including) FINAL CTA comment
html = re.sub(
    r'<!-- ============================ ARTICLE HERO ============================ -->.*?(?=<!-- ============================ FINAL CTA)',
    skeleton,
    html,
    flags=re.DOTALL
)

# ── 2. Fix hardcoded internal links in sections we didn't replace ──
html = html.replace('href="TradingSocial Blog.html"', 'href="/blog"')
html = html.replace('href="TradingSocial Blog Post.html"', 'href="/blog"')
html = html.replace('href="TradingSocial Pricing.html#plans"', 'href="/pricing#plans"')
html = html.replace('href="TradingSocial Pricing.html#pricing"', 'href="/pricing#pricing"')
html = html.replace('href="TradingSocial Pricing.html#beta"', 'href="/pricing#beta"')

# ── 3. Inject JS loader before </body> ──
blog_post_js = """<script>
(function () {
  var slug = window.location.pathname.replace(/^\\/blog\\//, '').replace(/\\/$/, '');
  if (!slug) { window.location.href = '/blog'; return; }

  fetch('/data/posts.json')
    .then(function (r) { if (!r.ok) throw new Error('fetch failed'); return r.json(); })
    .then(function (posts) {
      var post = null;
      for (var i = 0; i < posts.length; i++) {
        if (posts[i].slug === slug) { post = posts[i]; break; }
      }
      if (!post) { window.location.href = '/blog'; return; }

      // Page meta
      document.title = post.title + ' — TradingSocial';
      setMeta('og:title', post.title);
      setMeta('og:description', post.excerpt);
      setMeta('og:url', 'https://tradingsocial.com/blog/' + post.slug);
      var canon = document.querySelector('link[rel="canonical"]');
      if (canon) canon.href = 'https://tradingsocial.com/blog/' + post.slug;

      // Hero
      document.getElementById('js-crumb-cat').textContent = post.category;
      document.getElementById('js-title').textContent = post.title;
      document.getElementById('js-standfirst').textContent = post.excerpt;

      // Byline
      var av = document.getElementById('js-av');
      av.style.background = post.author_color;
      document.getElementById('js-author').textContent = post.author_name;
      document.getElementById('js-date-read').innerHTML =
        fmtDate(post.published_date) +
        '<span class="dotsep">·</span>' +
        post.readtime + ' read';

      // Cover
      var cover = document.getElementById('js-cover');
      if (post.image) {
        cover.innerHTML = '<img src="' + esc(post.image) + '" alt="' + esc(post.title) +
          '" style="width:100%;height:100%;object-fit:cover;border-radius:12px">';
      } else {
        cover.innerHTML = '<div class="thumb ' + post.thumb_color + '">' +
          '<span class="glyph">' + post.thumb_icon + '</span></div>';
      }

      // Body
      document.getElementById('js-prose').innerHTML = post.body;

      // Tags
      document.getElementById('js-tags').innerHTML = post.tags
        .map(function (t) { return '<span class="tag tag--neutral">' + esc(t) + '</span>'; })
        .join('');

      // Author bio
      var bioAv = document.getElementById('js-bio-av');
      bioAv.style.background = post.author_color;
      document.getElementById('js-bio-name').textContent = post.author_name;
      document.getElementById('js-bio-role').textContent = post.author_role;
      document.getElementById('js-bio-text').textContent = post.author_bio;

      // Related posts (3 most recent, excluding current)
      var related = posts
        .filter(function (p) { return p.slug !== slug; })
        .sort(function (a, b) { return new Date(b.published_date) - new Date(a.published_date); })
        .slice(0, 3);
      document.getElementById('js-related').innerHTML = related.map(renderCard).join('');
    })
    .catch(function () {
      var hero = document.querySelector('.article-hero .wrap');
      if (hero) hero.innerHTML = '<p style="color:#9d8ec4;padding:4rem 0;text-align:center">Could not load post. Please refresh.</p>';
    });

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setMeta(prop, val) {
    var el = document.querySelector('meta[property="' + prop + '"]');
    if (el) el.setAttribute('content', val);
  }

  function renderCard(p) {
    var href = '/blog/' + p.slug;
    var thumb = p.image
      ? '<a class="thumb" href="' + href + '" style="overflow:hidden;background:#1a1330">' +
          '<img src="' + esc(p.image) + '" alt="' + esc(p.title) +
          '" style="width:100%;height:100%;object-fit:cover"></a>'
      : '<a class="thumb ' + p.thumb_color + '" href="' + href + '">' +
          '<span class="glyph">' + p.thumb_icon + '</span>' +
          '<span class="thumb-lbl">' + esc(p.category) + '</span></a>';
    return '<article class="pcard-blog reveal">' +
      thumb +
      '<div class="pcard-body">' +
        '<span class="pcard-cat">' + esc(p.category) + '</span>' +
        '<h4><a href="' + href + '">' + esc(p.title) + '</a></h4>' +
        '<p class="excerpt">' + esc(p.excerpt) + '</p>' +
        '<div class="post-meta">' +
          '<span style="width:28px;height:28px;border-radius:50%;flex-shrink:0;display:inline-block;background:' + esc(p.author_color) + '"></span>' +
          '<span class="pm-t"><b>' + esc(p.author_name) + '</b>' +
            '<span>' + fmtDate(p.published_date) + '<span class="dotsep">·</span>' + esc(p.readtime) + '</span>' +
          '</span>' +
        '</div>' +
      '</div>' +
    '</article>';
  }
})();
</script>"""

html = html.replace('</body>', blog_post_js + '\n</body>')

with open('blog-post.html', 'w', encoding='utf-8') as f:
    f.write(html)

print('blog-post.html patched successfully')
```

Run:

```powershell
python Website/patch_blog_post.py
```

Expected output: `blog-post.html patched successfully`

- [ ] **Step 2: Verify the patch**

```powershell
python -c "
content = open('Website/blog-post.html').read()
checks = [
  ('js-title', 'id=\"js-title\"' in content),
  ('js-prose', 'id=\"js-prose\"' in content),
  ('js-related', 'id=\"js-related\"' in content),
  ('no hardcoded h1', 'highest-ROI habit' not in content),
  ('script present', 'fetch(\'/data/posts.json\')' in content),
  ('old links fixed', 'href=\"TradingSocial Blog.html\"' not in content),
]
for name, ok in checks:
  print(f'  {\"OK\" if ok else \"FAIL\"}: {name}')
"
```

All checks must print `OK`.

- [ ] **Step 3: Delete the patch script**

```powershell
Remove-Item Website/patch_blog_post.py
```

- [ ] **Step 4: Commit**

```powershell
git add Website/blog-post.html
git commit -m "feat: replace hardcoded blog-post.html content with JS-driven skeleton"
```

---

## Task 4: Update `blog.html` — JS Grid Renderer

**Files:**
- Modify: `Website/blog.html`

This task empties the hardcoded featured card and post grid in `blog.html`, then injects a JS renderer that fetches `posts.json` and builds both from data. The filter chips and search input already exist in the HTML with the correct attributes; the JS wires up their event handlers.

The filter chip `data-cat` values match `post.category.toLowerCase().split(/[\\s&\\/]+/)[0]`:
- `"Journaling"` → `"journaling"` ✓  `"Analytics"` → `"analytics"` ✓  `"Risk & Sizing"` → `"risk"` ✓
- `"Psychology"` → `"psychology"` ✓  `"Strategy"` → `"strategy"` ✓  `"Beginner"` → `"beginner"` ✓

- [ ] **Step 1: Run the Python modification script**

Save the following as `Website/patch_blog.py` and run it from `Website/`:

```python
import re

with open('blog.html', 'r', encoding='utf-8') as f:
    html = f.read()

# ── 1. Clear the hardcoded featured card (keep the .wrap, empty its contents) ──
html = re.sub(
    r'(<section class="section--tight featured">\s*<div class="wrap">)'
    r'\s*<a class="featured-card[^"]*".*?</a>\s*'
    r'(</div>\s*</section>)',
    r'\1\n  \2',
    html,
    flags=re.DOTALL
)

# ── 2. Clear the hardcoded post grid (keep the <div id="postGrid">, empty it) ──
html = re.sub(
    r'(<div class="postgrid" id="postGrid">)\s*(?:<!--.*?-->)?\s*.*?(?=\s*</div>\s*\n\s*<div class="center)',
    r'\1',
    html,
    flags=re.DOTALL
)

# ── 3. Fix hardcoded internal links ──
html = html.replace('href="TradingSocial Blog.html"', 'href="/blog"')
html = html.replace('href="TradingSocial Blog Post.html"', 'href="/blog"')
html = html.replace('href="TradingSocial Pricing.html#plans"', 'href="/pricing#plans"')
html = html.replace('href="TradingSocial Pricing.html#pricing"', 'href="/pricing#pricing"')
html = html.replace('href="TradingSocial Pricing.html#beta"', 'href="/pricing#beta"')

# ── 4. Inject JS renderer before </body> ──
blog_js = """<script>
(function () {
  fetch('/data/posts.json')
    .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function (posts) {
      posts.sort(function (a, b) {
        return new Date(b.published_date) - new Date(a.published_date);
      });

      var featured = null;
      for (var i = 0; i < posts.length; i++) {
        if (posts[i].featured) { featured = posts[i]; break; }
      }
      if (!featured) featured = posts[0];

      var grid = posts.filter(function (p) { return p !== featured; });

      // Render featured
      document.querySelector('.featured .wrap').innerHTML = renderFeatured(featured);

      // Render grid
      document.getElementById('postGrid').innerHTML = grid.map(renderCard).join('');

      // Update count
      var countEl = document.querySelector('.count');
      if (countEl) countEl.textContent = 'Showing ' + grid.length + ' articles';

      // Filter chips
      document.querySelectorAll('.fchip[data-cat]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          document.querySelectorAll('.fchip').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          var cat = btn.dataset.cat;
          document.querySelectorAll('#postGrid .pcard-blog').forEach(function (card) {
            card.style.display = (cat === 'all' || card.dataset.cat === cat) ? '' : 'none';
          });
        });
      });

      // Search
      var search = document.querySelector('.blog-search input');
      if (search) {
        search.addEventListener('input', function () {
          var q = search.value.toLowerCase();
          document.querySelectorAll('#postGrid .pcard-blog').forEach(function (card) {
            var text = (card.dataset.title || '') + ' ' + (card.dataset.excerpt || '');
            card.style.display = text.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
          });
        });
      }
    })
    .catch(function () {
      var grid = document.getElementById('postGrid');
      if (grid) grid.innerHTML = '<p style="color:#9d8ec4;padding:2rem 0;text-align:center;grid-column:1/-1">Could not load posts. Please refresh.</p>';
    });

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function catSlug(cat) {
    return cat.toLowerCase().split(/[\\s&\\/]+/)[0];
  }

  function thumbHtml(p, href, showLbl) {
    if (p.image) {
      return '<a class="thumb" href="' + href + '" style="overflow:hidden;background:#1a1330">' +
        '<img src="' + esc(p.image) + '" alt="' + esc(p.title) +
        '" style="width:100%;height:100%;object-fit:cover"></a>';
    }
    return '<a class="thumb ' + p.thumb_color + '" href="' + href + '">' +
      '<span class="glyph">' + p.thumb_icon + '</span>' +
      (showLbl ? '<span class="thumb-lbl">' + esc(p.category) + '</span>' : '') +
      '</a>';
  }

  function renderFeatured(p) {
    var href = '/blog/' + p.slug;
    var cover = p.image
      ? '<div class="thumb" style="overflow:hidden;background:#1a1330">' +
          '<img src="' + esc(p.image) + '" alt="' + esc(p.title) +
          '" style="width:100%;height:100%;object-fit:cover"></div>'
      : '<div class="thumb ' + p.thumb_color + '">' +
          '<span class="glyph">' + p.thumb_icon + '</span>' +
          '<span class="thumb-lbl">' + esc(p.category) + ' · ' + esc(p.readtime) + ' read</span>' +
          '</div>';
    return '<a class="featured-card reveal" href="' + href + '">' +
      cover +
      '<div class="featured-body">' +
        '<span class="featured-eyebrow"><span class="star">★</span> Editor\'s pick</span>' +
        '<h2>' + esc(p.title) + '</h2>' +
        '<p>' + esc(p.excerpt) + '</p>' +
        '<div class="post-meta">' +
          '<span style="width:32px;height:32px;border-radius:50%;flex-shrink:0;display:inline-block;background:' + esc(p.author_color) + '"></span>' +
          '<span class="pm-t"><b>' + esc(p.author_name) + '</b>' +
            '<span>' + fmtDate(p.published_date) + '<span class="dotsep">·</span>' + esc(p.readtime) + ' read</span>' +
          '</span>' +
        '</div>' +
        '<span class="featured-read">Read the article ' +
          '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>' +
        '</span>' +
      '</div>' +
    '</a>';
  }

  function renderCard(p) {
    var href = '/blog/' + p.slug;
    var cat = catSlug(p.category);
    return '<article class="pcard-blog reveal"' +
      ' data-cat="' + esc(cat) + '"' +
      ' data-title="' + esc(p.title) + '"' +
      ' data-excerpt="' + esc(p.excerpt) + '">' +
      thumbHtml(p, href, true) +
      '<div class="pcard-body">' +
        '<span class="pcard-cat">' + esc(p.category) + '</span>' +
        '<h4><a href="' + href + '">' + esc(p.title) + '</a></h4>' +
        '<p class="excerpt">' + esc(p.excerpt) + '</p>' +
        '<div class="post-meta">' +
          '<span style="width:28px;height:28px;border-radius:50%;flex-shrink:0;display:inline-block;background:' + esc(p.author_color) + '"></span>' +
          '<span class="pm-t"><b>' + esc(p.author_name) + '</b>' +
            '<span>' + fmtDate(p.published_date) + '<span class="dotsep">·</span>' + esc(p.readtime) + '</span>' +
          '</span>' +
        '</div>' +
      '</div>' +
    '</article>';
  }
})();
</script>"""

html = html.replace('</body>', blog_js + '\n</body>')

with open('blog.html', 'w', encoding='utf-8') as f:
    f.write(html)

print('blog.html patched successfully')
```

Run:

```powershell
python Website/patch_blog.py
```

Expected: `blog.html patched successfully`

- [ ] **Step 2: Verify the patch**

```powershell
python -c "
content = open('Website/blog.html').read()
checks = [
  ('featured wrap empty', '<a class=\"featured-card' not in content),
  ('postGrid empty', 'data-cat=\"analytics\"' not in content),
  ('script present', \"fetch('/data/posts.json')\" in content),
  ('filter handler', 'fchip' in content),
  ('old links fixed', 'TradingSocial Blog.html' not in content),
]
for name, ok in checks:
  print(f'  {\"OK\" if ok else \"FAIL\"}: {name}')
"
```

All must print `OK`.

- [ ] **Step 3: Delete the patch script**

```powershell
Remove-Item Website/patch_blog.py
```

- [ ] **Step 4: Commit**

```powershell
git add Website/blog.html
git commit -m "feat: replace hardcoded blog.html cards with JS renderer from posts.json"
```

---

## Task 5: End-to-End Verification

**Files:** None modified — verification only.

- [ ] **Step 1: Start local server**

```powershell
cd Website
python -m http.server 8080
```

Open `http://localhost:8080/blog.html` in a browser (note: local server won't handle `/blog/:slug` rewrites — use `.html` suffix for local testing).

- [ ] **Step 2: Verify blog list page**

Navigate to `http://localhost:8080/blog.html`. Confirm:
1. Featured card renders (Maya Okonkwo, Journaling, Jun 3)
2. 9 post cards appear in the grid with correct titles, authors, and dates
3. Clicking a category filter chip (e.g., "Analytics") hides non-matching cards
4. Typing in the search box filters cards in real time
5. No console errors

- [ ] **Step 3: Verify blog post page**

Navigate to `http://localhost:8080/blog-post.html?slug=why-a-trading-journal` — this won't work locally (no query string routing). Instead, temporarily test by navigating to `http://localhost:8080/blog-post.html` with the JS hardcoded to a slug. A simpler approach: check that the page loads without JS errors and the skeleton elements exist in the DOM (open DevTools → Elements and confirm `id="js-title"`, `id="js-prose"`, `id="js-related"` are present and empty).

For full slug-routing testing, deploy to Vercel (or use `vercel dev` if the Vercel CLI is installed):

```powershell
# From Website/ directory, if Vercel CLI is installed:
vercel dev
```

Then navigate to `http://localhost:3000/blog/why-a-trading-journal` and confirm:
1. Page title updates to the post title
2. Article body renders
3. Tags appear
4. Author bio section populates
5. "Keep reading" grid shows 3 related posts linking to `/blog/<slug>` URLs
6. Navigating to `/blog/nonexistent-slug` redirects to `/blog`

- [ ] **Step 4: Verify JSON is served correctly**

```powershell
# In another terminal, with the server running:
Invoke-RestMethod http://localhost:8080/data/posts.json | Measure-Object | Select-Object -ExpandProperty Count
```

Expected: `10`

- [ ] **Step 5: Final commit if any fixes were made during verification**

If any issues were found and fixed during steps 1–4, commit those fixes:

```powershell
git add Website/blog.html Website/blog-post.html Website/data/posts.json
git commit -m "fix: address issues found during dynamic blog end-to-end verification"
```

---

## Self-Review

### Spec Coverage

| Spec requirement | Task |
|-----------------|------|
| `data/posts.json` with 10 seeded posts | Task 1 |
| All required JSON fields | Task 1 (all 14 fields present in every post) |
| `/blog/:slug` Vercel rewrite | Task 2 |
| `blog-post.html` skeleton + JS loader | Task 3 |
| Slug read from `window.location.pathname` | Task 3 (JS) |
| Slug not found → redirect `/blog` | Task 3 (JS) |
| Populate title, standfirst, byline, cover, body, tags, bio, related | Task 3 (JS) |
| Update `<title>`, OG meta, canonical | Task 3 (JS) |
| `blog.html` featured + grid JS renderer | Task 4 |
| Filter chips wire up | Task 4 (JS) |
| Search input wires up | Task 4 (JS) |
| `.count` span updates | Task 4 (JS) |
| Image field → `<img>` fallback to gradient+icon | Task 3 + 4 (JS, both) |
| `featured: true` missing → first post used | Task 4 (JS: `if (!featured) featured = posts[0]`) |
| `fetch` fails → inline error message | Task 3 + 4 (JS, `.catch`) |

### Placeholder Scan

None. All steps contain complete code.

### Type Consistency

All field names used in the JS (`post.slug`, `post.title`, `post.excerpt`, `post.category`, `post.tags`, `post.readtime`, `post.published_date`, `post.author_name`, `post.author_role`, `post.author_bio`, `post.author_color`, `post.featured`, `post.thumb_color`, `post.thumb_icon`, `post.image`, `post.body`) match the JSON schema defined in Task 1.

`catSlug()` in Task 4 produces values matching the `data-cat` attributes on the existing filter chips: `"journaling"`, `"analytics"`, `"risk"`, `"psychology"`, `"strategy"`, `"beginner"`.
