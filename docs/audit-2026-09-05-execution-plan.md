# Audit 2026-09-05 — sub-agent execution plan

Source: `TradingSocial-Audit-2026-09-05.md` (live product and growth audit).
Every implementable item below is scoped as a single sub-agent task. Items that
a sub-agent cannot honestly complete are listed separately at the end rather
than being handed out and half-done.

## Shape of the plan

The audit's own priority order is not the safe execution order. Two things have
to happen before anything is rebuilt:

1. **Nothing in the audit's numbers can be trusted yet.** The funnel reports 9
   onboarding completions against 4 signups (225%), step 6 at 18 against 9
   earlier, 5 total 404 hits against 7 across listed paths, and 11 new users in
   30 days on the same page. Rebuilding Home around "evidence since last review"
   while the evidence layer is miscounting produces a prettier wrong answer.
2. **Several audit findings are explicitly unproven** and the audit says so —
   the journal figure discrepancies, duplicate import rows, symbol
   normalisation. Handing those to an implementation agent invites it to "fix"
   arithmetic that is already correct. They go to read-only investigators first.

So: a wave of investigations, then the P0 trust corrections, then measurement,
then the improvement cycle, then packaging.

## Standing rules for every sub-agent

Put these in every prompt; they are not optional.

- **Read `CLAUDE.md` first.** Three project rules will otherwise be broken:
  server actions gate with `getAdminUser()` and never `requireAdmin()`; client
  components must `await` actions inside an `async` transition callback; no
  non-component imports from `'use client'` modules under `app/src/app/admin`.
- **One git worktree per concurrent task** (`isolation: "worktree"`). Waves
  below run several agents at once and they overlap on `app/src/app/journal`
  and `app/src/lib`. Without isolation they will clobber each other.
- **Migrations are written, never applied.** Return the SQL and say it must be
  applied manually before the branch merges. A merged migration-less feature
  ships broken.
- **Investigation agents write no code.** Their deliverable is a finding, and
  "the numbers already reconcile, here is why" is a valid and useful finding.
- **Every fix ships with a unit test.** E2E is unavailable until W1-T0 lands —
  do not claim an e2e run happened.
- **Report back:** files changed, tests added, and what was deliberately *not*
  done. Silence about scope you dropped is the failure mode.

---

## Wave A — investigations (6 agents, parallel, read-only, `Explore`)

No dependencies. These can all start immediately, and Wave B depends on none of
them except A6.

| # | Task | Deliverable |
|---|---|---|
| A1 | **Measurement reconciliation.** Trace every number on `/admin/analytics` and `/admin/cohorts` back to its query. `app/src/lib/analytics.ts`, `app/src/app/admin/analytics`, `admin/cohorts`, plus the production `analytics_events` table. | A table: displayed figure → source query → whether it is an event count, a unique-user count, a lifetime ratio, or a cohort conversion. Name the exact cause of the 225% and the step-6 = 18 anomalies. No fixes. |
| A2 | **Journal figure reconciliation.** Header win rate 18% vs insight 25%, footer net $0 across all-history rows, profit factor 0.54 beside positive money P/L. `journal-stats.ts`, `insights.ts`, `compare.ts`. | For each figure: formula, window, denominator, exclusions, units. Verdict per figure — consistent-but-undocumented, or genuinely wrong. Do not "fix" anything. |
| A3 | **Symbol normalisation and duplicate executions.** EURUSD vs EUR/USD appearing separately; imported rows that look repeated. `instruments.ts`, `mt5.ts`, `metaapi-deals.ts`, the import path. Ticket-level inspection in prod. | Proven / not proven, per claim, with the ticket-level evidence. |
| A4 | **`/learn` returns home.** Six courses publish internally, no Learn item in main nav. `app/src/app/learn`, `learning.ts`, `feature-flags.ts`, nav components. | The mechanism (flag, gate, redirect) and exactly what would surface it. |
| A5 | **Entitlement boundary map.** `plans.ts`, `entitlements.ts`, `pricing.html`. | Current Free/Trader/Pro gate matrix, expressed as a diff against the audit's proposed matrix. This is the input to Wave E and blocks it. |
| A6 | **Claim and copy inventory.** Sync cadence "roughly every few hours" (verification page) vs "hourly" (settings, pricing); "cannot be faked" on the public homepage; blog index "Updated weekly" vs newest article 3 June; referral share text ("both people get Pro") vs the referrer-focused explanation. Covers both the marketing site at repo root and `app/src`. | File + line inventory of every claim needing a factual correction, each tagged *needs a fact from Nathan* or *fixable from the code*. |

## Wave B — P0 trust corrections (4 agents, parallel, `general-purpose`)

Independent of Wave A. Start alongside it.

- **B0 — Unblock E2E.** Two environment blockers stop the Playwright suite
  running against dev; the click timeout is a symptom, not the bug. Fix them so
  later waves can actually verify. *This one runs first because everything
  downstream claims verification it currently cannot perform.*
- **B1 — No-data states in the weekly review.** A period with no trades must
  render "Not enough data", never an improved average R. `weekly.ts`,
  `compare.ts`, journal report. Offer reviewing past trades or recording a
  planned no-trade session. Unit tests for the empty-current-period case.
- **B2 — Pending cohort cells.** Cohorts too young to have reached D7/D30 read
  *Pending*, not 0% retention. `app/src/app/admin/cohorts`.
- **B3 — Incentives off trade volume.** Daily quests requiring logged/closed
  trades, weekly quotas of 10 logs and 5 closes, win-streak badges. Replace with
  completed reviews, rule reflections, planned no-trade sessions. `badges.ts`,
  `xp.ts`, `streaks.ts`, `achievements`. Largest of the four; quest definitions
  may live in the database, so expect a migration.
- **B4 — Leaderboard defaults and eligibility.** Default sort off Total P/L,
  a real minimum sample, plan gating consistent with the stated
  process/verification principles. `leaderboard.ts`, `leaderboard-integrity.ts`.

**B5 — Copy corrections** executes A6's inventory, but only the *fixable from
the code* half. The rest waits on Nathan.

## Wave C — measurement rebuild (sequential, depends on A1)

These three all touch `admin/analytics`; running them in parallel guarantees a
merge conflict. One agent, three commits, or three agents in strict sequence.

- **C1 — Fixed-cohort funnel.** Ordered unique-user milestones against a fixed
  signup cohort. Manual entry / statement import / broker connect are *branching*
  entry paths, not consecutive steps. Separate event counts, unique viewers,
  lifetime adoption and cohort conversion into distinct displays. Separate trial
  entitlement, trialing Stripe subscriptions, paid invoices, complimentary
  access and paid subscribers.
- **C2 — Event vocabulary.** `focus_selected`, `data_path_selected`,
  `first_real_trade_available`, `reflection_saved`, `review_completed`,
  `next_action_selected`, `upgrade_offer_viewed`, `checkout_started`,
  `payment_confirmed`. Stable identity, deduplication, consistent internal
  exclusion. `review_completed` binds to a persisted record;
  `payment_confirmed` binds to a verified server-side event. Migration expected.
- **C3 — North-star panel.** Weekly users who complete a review of real
  evidence *and* choose a next action, shown with its eligible-user denominator.
  Plus first-cycle completion at 24h and 7d, median time to first useful review,
  and the manual/import/broker, assisted/independent, device and source splits.

## Wave D — the improvement cycle (depends on C2's events existing)

The actual product build. Six agents; D1 blocks the rest.

- **D1 — The focus object.** Schema, server actions, persistence across Home,
  Journal and the weekly review. User can write their own, change it, or skip
  suggestions. Migration.
- **D2 — Home hierarchy.** First screen: current focus, progress from actually
  reviewed evidence, one primary action matching real state (no data /
  unreviewed trade / incomplete review / completed cycle), secondary Add trades.
  Community below personal progress. No universal score mixing money, check-ins
  and volume.
- **D3 — Journal review-and-next-action panel** at the top; detailed analytics
  retained below.
- **D4 — Reflection on save.** Brief rule-followed yes/no/unsure prompt
  immediately after saving or importing, optional tag and sentence. Imported
  execution fields stay locked; reflections stay editable. Make capture privacy
  explicit and test private-first.
- **D5 — Entry-to-review route.** Add trades on Home and Journal with Manual /
  Import / Connect. Supported formats, import preview, recoverable errors,
  idempotent repeat import. Intent survives signup and recovery. Success opens
  one reviewable record, not the dashboard.
- **D6 — Completion semantics.** A completed review persists the evidence
  considered plus a chosen next action, or an explicit decision to change
  nothing. Rendering a summary does not count. Refresh and reopen do not
  duplicate completion.

## Wave E — packaging (depends on A5 and a Nathan decision)

- **E1 — Plan boundaries.** A complete basic improvement cycle free; monetise
  automation, longer comparison history, deeper analysis. Evaluate whether
  hiding old journal entries undermines the ownership promise.
- **E2 — Contextual upgrade offer** after a useful review, naming the exact
  feature, limits, price, billing period and renewal, with a free continuation
  path. Both annual totals visible beside annual purchase actions.

---

## Not handed to a sub-agent

Listing these rather than pretending they are covered:

- **All of Nathan's four weeks** — segment choice, participant recruitment,
  observed reviews, the pricing decision. Discovery work, not implementable.
- **Testimonial and author-bio provenance.** Requires records only Nathan holds.
- **Real-device phone testing.** The audit asks for a first cycle verified on an
  actual phone with fresh Free, trial and expired-trial accounts. No agent has a
  phone; admin Pro in a desktop browser is not a substitute.
- **End-to-end payment, webhook and entitlement recovery.** Needs approved Stripe
  test accounts and a working E2E environment (B0). Production is now on a live
  key, so this is not something to poke at casually.
- **Vercel preview verification.** Previews need a share link and a login from
  Nathan; they are not free to check.

## Adjacent, not from the audit

Seven files still have locale formatting inside SSR'd components, throwing React
#418 that `client_error` cannot see. That noise sits underneath every
measurement change in Wave C. Worth folding in, but it is a separate decision.

---

## Findings log

### A4 — `/learn` (complete, 2026-09-09)

**Resolved, and the audit item needs reframing.** `/learn` is not broken and not
flag-gated. `LEARN_HIDDEN = true` is a hard-coded constant with an unconditional
`redirect('/')` as the first statement of three route components plus the quiz
server action — it runs before any auth or tier check, which is why an admin Pro
session lands on home.

It was withdrawn deliberately across two commits (`05ece32`, `b552fe5`), and the
stated reason in both commit messages and in
`app/supabase/migrations/0048_withdraw_course_feature_flags.sql` is that
**TradingSocial does not hold an Australian financial services licence.**

The content is not unfinished: 6 courses, 31 lessons, all published, every lesson
3.3k–4.7k characters with a complete quiz, and 14 lesson completions by 9 users
before it was hidden. Restoring reachability is four booleans plus a nav entry.

So the audit's recommendation — *"verify intended availability/feature flags;
surface a relevant short lesson directly from a chosen focus"* — is **not an
implementation task**. Flipping those booleans puts advice-shaped content
("Risk Management", "Trading Psychology") back in front of paying Australian
customers against a recorded licensing position. It belongs in the *not handed to
a sub-agent* list above, as **"confirm the AFSL position"** — a question for
Nathan and, on this, probably for a lawyer.

One genuine defect did fall out of it, and it is small and safe:
`app/src/app/admin/courses/page.tsx:24` still tells admins *"Drafts are invisible
to users until published"*, implying published courses are visible. Six courses
read as published on a surface no customer can reach. Worth a one-line fix so the
admin view stops lying, independent of the licensing decision.

### A2 — journal figures (complete, 2026-09-09)

**The audit's caution was right: all three flagged figures are arithmetically
correct and mutually reconcilable.** Reproduced from raw rows on account
`9411e6cf`: 17 closed trades, 5 of them stop-less statement imports with
`r_multiple = null`.

- Header 18% = 3 wins / 17 closed, by `outcome`, all history — `trade.ts:227`.
- Insight 25% = 3 / 12 R-bearing, by R sign, all history — `insights.ts:66`.
  The two differ on *both* axes at once: denominator and win definition.
- Profit factor 0.54 is **R-denominated** (`trade.ts:204-205`), net P/L is money.
  This account's `risk_amount` spans $0.23–$500, a >2000× spread, so R-weighted
  and money-weighted aggregation legitimately disagree in sign. The inverse case
  exists too (account `d5c1a520`: PF 14.66, net −$66.78), confirming it is
  systemic rather than a one-off.

Had an implementation agent been handed these, it would have "fixed" correct
arithmetic. The defect surface is **labelling**, not calculation — with three
exceptions that are real:

1. **`RecentTrades.tsx:114-115` — a genuine composition bug.** One sentence joins
   an all-history row count to a *current-calendar-month* net. On the account
   above the rows carry +$1,834 all-time and the footer reads +$0. The net also
   ignores the segmented filter entirely: clicking "Losses" changes the row count
   and never the net.
2. **`StatCards.tsx:33` hard-codes `subTone="pos"`.** A profit factor of 0.54
   renders in the positive colour — the UI actively reinforces the misreading.
3. **Three captions state something the data is not**: the equity curve is
   captioned `YTD` but accumulates all closed history (`page.tsx:314` — dormant
   only because production has no pre-2026 rows); the asset donut says "by
   volume" but computes by trade count (`journal-stats.ts:56`); the report's
   "Avg R:R" is realised avg R, not planned risk:reward (`report/page.tsx:97`).

Beyond the audit's three, a signed-in journal can show **three different win
rates** (header, insight, comparison card) with three denominators and one window
label, and **two different trade counts both labelled "trades"** in one viewport
(`StatCards.tsx:34` closed-only vs the donut centre's all-inclusive count).

This reshapes the Wave B/C work: there is no arithmetic to repair, so the task is
a labelling pass — date range, denominator, units and exclusions on every figure —
plus the three fixes above. That is a smaller and much safer change than the
audit implies, and it should be scoped as one agent over the journal and report
pages, not as a statistics rewrite.

### A3 — symbols and duplicate executions (complete, 2026-09-09)

**Both claims proven.** The audit was right on both, and was right to refuse to
declare either without ticket-level evidence.

**Symbols — real, and already fixed two days after the audit.** Pre-fix,
`mapDealToTrade` computed the normalised symbol, spent it on the pip lookup,
discarded it, and persisted the raw broker string. The manual form wrote the
catalog spelling. Two ingest paths, two names for one asset. On 5 September
production held 9 `EURUSD` rows against 121 `EUR/USD`, plus an unreported
`XAUUSD` / `XAU/USD` split of 13 against 29. Commit `a40ea4b` (7 Sept) added
`canonicalInstrument`; migration `0068` backfilled 22 rows the same day. No
instrument collisions remain.

The hole that remains: **manual entry is not canonicalised at all**.
`app/src/app/actions/trade.ts:164` does `.trim()` and nothing else, and
`InstrumentCombobox` is free text — the dropdown suggests, it does not constrain.
A user typing `eurusd` today recreates the split. Unexercised in production, so
it is a live hole rather than a live defect, and no test guards that path.

While the split existed it degraded top-instrument stats on the journal and
public profile, and — worst — the duplicate-detection key itself
(`suspicion.ts:159` keys on `instrument|entry_price|traded_at`), so a hand-logged
trade could never match its imported twin. Aggregate journal metrics were never
affected; `computeMetrics` does not group by instrument.

**Duplicates — three real pairs, and the dedupe key could not have caught them.**
`(user_id, broker_deal_id)` is enforced by a real unique index, and re-importing
the same file *is* idempotent. But the key is the MT5 position ticket, and the
three pairs came from two reports exported under different broker-server
timezones, carrying disjoint ticket ranges for the same fills. Every pair matches
on price to five decimals, lots, P&L to the cent and hold duration to the second,
with `traded_at` offset by exactly 03:00:00. The suspicion rule missed them for
that same reason — same price, different timestamp.

Effect: 3 of that user's statement rows are double-counted; their trade count,
net P&L, win/loss counts and streaks are each overstated.

**Cross-link to A2:** the duplicates sit on account `9411e6cf` — the same account
A2 used to reconcile the journal figures. A2's conclusion stands (the formulas
are correct regardless of the rows they run over), but it is worth stating
plainly that the figures reconcile *to data that is itself inflated by three
executions*. Correct arithmetic over wrong rows.

This is the one Wave A finding that argues for a schema-level fix rather than a
label: a timezone-tolerant duplicate key. That is a bigger change than anything
else in the wave and should be scoped on its own.

### A1 — measurement reconciliation (complete, 2026-09-09)

Every figure in the audit reproduced exactly against production pinned to
`2026-09-05 12:00Z`, so the mechanisms below are confirmed, not inferred.

**The funnel is a category error, not a set of wrong numbers.** `eventCount` is
`(await realEvents(event)).length` — `funnel.ts:78`. Array length, never
`distinct user_id`. Seven of the eight funnel bars are **row counts**, stacked in
a visual that asserts each bar is a subset of the one above. Weekly review viewed
= 25 rows from **3 distinct users**; onboarding completed = 9 rows from 9 users.
An 8× and a 1× reading, in the same column. The same page shows weekly review a
second time as 4 (57%) under feature adoption — a lifetime ratio over the 7
activated users. Both are right; they answer different questions.

Meanwhile the page's own headline at `admin/analytics/page.tsx:100` reads *"Every
figure counts genuine users only."* That sentence, not the arithmetic, is what
the findings contradict.

**Four confirmed defects:**

1. **`signup_completed` has no OAuth emitter.** Its single emitter is
   `actions/auth.ts:150` in the email/password action; `auth/callback/route.ts`
   never calls `trackServer` at all. `onboarding_completed` fires from
   `actions/profile.ts:101`, which both paths reach. So the 225% is
   email-only signups ÷ all-method completions. In the window: 11 non-internal
   profiles, 4 email and 7 Google; `signup_completed` present for 4/4 email and
   0/7 Google. **The real signup count is 11, not 4** — which also fully explains
   the "11 new users vs 4 signups" discrepancy. Same shape today: 23 events
   against 31 real new profiles.
2. **Onboarding step 6 emits twice.** `OnboardingForm.tsx:511` fires `go(6)`, and
   `submit()` at `:307-312` fires `onboarding_step {step: 6}` again. Exactly 2:1,
   confirmed: steps 1–5 are 10 raw / 10 distinct, step 6 is 20 raw / 10 distinct.
   The panel is titled "step reach" — a unique-user word over a row count. Back
   navigation also emits, so any revisit inflates a step; that just hasn't
   happened yet.
3. **"Top broken paths" has no internal filter.** `funnel.ts:236-241` is a
   separate query selecting only `props`, so `user_id` is never fetched and
   neither exclusion can apply. The 5-vs-7 gap is two `/pinkhorror` hits from an
   admin's own browsing.
4. **"App visitors" double-counts every signed-in user.** `funnel.ts:129` keys on
   `user_id ?? anon_id`, so anyone who browses logged-out then signs in lands in
   the set twice. 117 anon + 11 user = the displayed 128; every one of the 12
   anon_ids ever seen with a user_id also appears without one. It inflates the
   denominator of visitor→signup by roughly the number of people who converted.

**The cohort zeros are real — this corrects the plan's B2.** The audit assumed
immature cohorts were being rendered as failed retention. A1 re-derived the whole
table in SQL: **D7 = 0 and D30 = 0 for every cohort including the oldest**
(2026-06-22 through 2026-07-27, all well past 30 days). Across 64 non-internal
profiles there are 29 activity rows total, and **54 of 64 users have zero
activity of any kind**. The retention predicate at `cohorts.ts:79-82` is sound.

So B2 shrinks to what it actually is: a rendering fix. An immature cell returns
`false` at `cohorts.ts:80`, is recorded as a non-retention, and renders `0% (0)`
— indistinguishable from a measured zero. There is no null state to render. Worth
fixing, but it will not change a single number.

That is the sobering part of this wave. The retention figures are not a
measurement artefact waiting to be corrected. They are true.

**Three exclusion regimes, not one**, despite the "Internal excluded" badge:
event-based figures apply both the stamp and a live profile lookup; the entire
Growth/Engagement block and the whole of `/admin/cohorts` apply only
`profiles.is_internal`; "Top broken paths" applies nothing. Because admins are
marked internal by email allowlist into the *stamp* and not the profile row, the
Regime-B figures can include unflagged admin traffic — and because anonymous rows
are deliberately kept as genuine, "App visitors" cannot exclude a logged-out team
member. With 117 of 128 visitors anonymous, that is the least-guarded number on
the page.

**Consequence for Wave C:** C1 should not start as a rebuild. Fix the four
defects first — they are small, local and independently verifiable — then rebuild
the funnel on unique users. Two open questions for Nathan sit inside this: whether
the missing OAuth `signup_completed` was deliberate (its props are email-specific:
`method: 'email'`), and whether `is_internal` is over-applied, since 420 profiles
carry it and some may be genuine users mislabelled.

### A6 — claim and copy inventory (complete, 2026-09-09)

32 rows, 8 of them `accurate`. Full table in the agent report; the material
results:

**The audit had the sync cadence backwards.** It assumed "hourly" was right and
"every few hours" was the error. Production says the opposite.
`.github/workflows/mt5-sync.yml:19-20` asks GitHub for hourly, and every run
reports success — but `broker_sync_succeeded` shows **4–7 collect cycles per open
trading day, not ~22**, with routine 3–6 hour gaps. GitHub's scheduler is
silently dropping the majority of scheduled fires. So
`verification/page.tsx:111` ("roughly every few hours") is the one honest line,
and **ten "hourly" surfaces are the defects** — `plans.ts:52`, two in
`BrokerCard.tsx`, `recovery.ts:98`, two in `server/email.ts`, plus `pricing.html`,
`for/forex.html`, `for/educators.html` — with a further ~18 across `for/mt5.html`
and the six `compare/*.html` pages, including an explicit "Hourly is enough"
defence written against a competitor.

**This is the one copy item that cannot be fixed by editing copy.** Writing
"every few hours" bakes the current shortfall in as the promise. The decision is
whether to move the trigger to something that actually fires hourly, or to
re-sell the real cadence. Nathan's call, and it blocks B5.

Nobody discloses the weekend gap either — `market-hours.ts:37-51` skips
Fri 22:00 → Sun 22:00 UTC, and no customer-facing surface says so.

**Two Pro entitlements are sold and were never built.** `pricing.html:1650,1729`
ticks "Premium challenges & competition eligibility" and `:1740` ticks "Priority
support". Both are declared in `entitlements.ts:312` — `premium_challenges` under
the comment *"Wired, enforced when built"* — and have **zero call sites** outside
the declaration and the admin flag screen. No challenges route exists; no support
tiering exists anywhere in the codebase. `pricing.html:1639` correctly says
"*future* competition access"; the feature bullets do not. Given the Stripe key
went live, this is the most exposed item in the wave.

**Leaderboard ranking is a paid perk that two of three surfaces don't mention.**
`entitlements.ts:330` gates it at `trader`. `for/educators.html:1630` discloses
it; `index.html:1817` and the `pricing.html` comparison table are silent.

**Smaller, all fixable from code:** the referral share text at
`ReferralModal.tsx:31` says "we both get Pro free" while `referral.ts:37-48`
grants months to the referrer only (the modal's own body copy is correct);
`AuthShell.tsx:81` calls logged trades "tamper-proof" when
`verification/page.tsx:96-99` says manual trades are owner-editable;
`landing.ts:26` says "tamper-proof" where `:65` already uses the bounded phrasing;
six unbounded "can't be faked" instances across `index.html` and
`for/educators.html`; `blog.html:1586` claims "Updated weekly" against a newest
post of 2026-06-03, 98 days stale.

**The existing honesty mechanism works** and should be the model: the
`/for/<audience>` social-proof number server-renders `—` rather than a fabricated
count, `/api/stats` excludes internal and seed accounts, and
`landing-proof.test.ts` enforces it. `for/educators.html:1469` already carries
exactly the bounded phrasing the audit asks for. Rows 6–12 should be rewritten
against it.

**Trap for whoever executes B5:** `.claude/worktrees/intelligent-roentgen-cfa909/`
is a detached-HEAD scratch worktree holding a full duplicate of both codebases,
including byte-identical copies of several flagged lines. A grep-driven fix will
hit it and report false "already fixed" matches.

**Nine questions for Nathan** are listed in the agent report — cadence, the six
homepage testimonials and their consent records, the five-star ratings and their
source, the four blog author biographies, the challenges launch date, what
"priority support" actually commits to, whether the ranking paywall gets
disclosed, the blog cadence claim, and when the competitor claims were last
checked.

### A5 — entitlement boundary map (complete, 2026-09-09)

**The audit's central recommendation is currently impossible to deliver, and the
reason is gates, not build effort.**

The proposal is that Free completes one full improvement cycle. Today Free has:
zero tagging (strategy cap 0, mistake tags blocked, setup/emotion/confidence
nulled server-side at `actions/trade.ts:107-116`), no private notes
(`actions/trade.ts:80`), and **no weekly review at all** — `WeeklyReviewCard.tsx:30`
returns null, there is no basic variant.

Worse, it compounds: `weekly_review_viewed` fires only from that Trader+ card
(`WeeklyReviewCard.tsx:38`), and both the weekly-review streak
(`journal/page.tsx:130`) and the `weekly_reviews` process goal
(`server/goals.ts:43`) count that event. **A Free user's review streak and review
goal are pinned at zero permanently, by construction.** Any north-star metric
built on `review_completed` will inherit this unless the gate moves first.

So Wave D is not "build the cycle" — it is "move three gates, then build the
cycle". That ordering matters and was not in the original plan.

**Two proposed boundaries describe capabilities that do not exist.** "Longer
comparisons" for Trader: the comparison window is a hard-coded 30-vs-prior-30 for
every tier (`compare.ts:54`, `server/compare.ts:20`), with no tier input.
"One active focus" for Free and "multiple saved cycles" for Trader: process goals
are ungated *and uncapped* at every tier (`actions/goals.ts:12-41`) — there is
nothing to unlock. Both need building before they can be sold.

**Commercial exposure, and this is the urgent part.** Beyond A6's two unbuilt Pro
entitlements, `pricing.html:1621` and `:1734` sell Trader a "Priority beta feature
access" row — there is no `priority_beta` feature key at all, and the adjacent
`early_access` is Pro-tier with zero call sites. `settings/billing/BillingActions.tsx:51-92`
is a **second hard-coded copy** of all three plans that silently drops that same
line, so the two paid surfaces disagree with each other. Meanwhile
`pricing.html:1647` markets AI insights as "coming soon" when it is built and
live for Pro today — the only *under*-claim in the set.

**The welcome popup tells Free users three things that are false**
(`welcome-tiers.tsx:48-57`): that they can tag how each trade went, that they get
win rate at a glance (it is the locked tile), and that they can "see where you
rank" (Free never ranks). The dashboard onboarding checklist has the same defect
— two of its six items are impossible on Free (`app/page.tsx:172-173`).

**Data ownership: kept in substance, broken in framing.** Nothing is withheld at
the database level; the 30-cap is a `.slice()` in one component, and downgrade is
non-destructive by explicit design (`omitUngated`, `keepThenCap`, both commented
with the failure they prevent). Free gets a complete JSON export of every trade
via `actions/account.ts:131-176`, **ungated**. But the CSV button is Trader+ while
being handed the full array anyway — the gate is presentational, the data is
already in the browser — and `pricing.html:1719` lists "Export journal data" as
paid without mentioning the free JSON export. A user reading the pricing page
concludes their history is locked. It is not. That gap, not the 30-row list, is
where the ownership promise actually bites.

**One real gate hole:** `saveTradingRules` (`actions/rules.ts:25-50`) has no tier
check while its UI is Trader+. Every other gated write in the codebase re-checks
server-side. A hand-built POST from a Free account writes `trading_rules`.

**And crypto auto-sync is off for everyone**, including Pro — the production
`feature_flags` row is false for all three tiers, so a Pro user who connects
Binance (which *is* permitted) never syncs.

**Production state:** 484 profiles, 420 internal. **Zero paying customers** —
`subscriptions` holds exactly one row, `trader`, `canceled`, period ended
2026-07-26. Every non-internal account is trial-active (24), trial-expired (38),
or comp Pro (2); not one reached Free by any route other than a lapsed trial.
`trial_ack_at` is null on all 484 rows. Nobody has ever hit the 30-trade cap —
the largest account holds 26 trades.

That last set of numbers reframes Wave E entirely: there is no pricing signal to
read, because there is no population that has ever been asked to pay from a
steady state.

---

## Wave B, re-scoped and launched (2026-09-09)

Eight agents, isolated worktrees. What changed against the original scoping:

| # | Task | Change from the original plan |
|---|---|---|
| B0 | Unblock the E2E suite | Unchanged, but scoped honestly: fix the in-repo half, name precisely what needs the owner. Explicitly forbidden from weakening tests to get green. |
| B1 | **Journal honesty pass** | **Merged.** Old B1 (weekly-review no-data states) absorbed A2's findings, because both land on `journal/page.tsx` and the report page and would otherwise conflict. Now covers the `RecentTrades` footer composition bug, the `subTone="pos"` colouring bug, three false captions, the labelling pass, and the original no-data work. Told explicitly not to touch any formula. |
| B2 | Cohort immature cells | **Shrank to a rendering fix.** A1 proved the zeros are real, so this changes no number. Added: make the "Internal excluded" badge state what it actually excludes. |
| B3 | Incentives off trade volume | Unchanged in scope, but now carries A5's warning: `weekly_review_viewed` fires only from a Trader+ card, so review-based rewards built on it would rebuild the same Free-user trap. Must report which new rewards Free cannot reach. |
| B4 | Leaderboard | **Reordered.** The false population claim at `leaderboard/page.tsx:51` ("every name here is a subscribed trader" — trialists rank, and there are zero subscribers) now leads, ahead of the audit's own sort/sample items. |
| B5 | Copy corrections | **Split.** Cadence rows excluded — they need an infrastructure decision, and writing "every few hours" would bake the shortfall in as the promise. The three sold-but-unbuilt entitlements excluded — deleting a sold line item is the owner's call. Rule given: fix only where the codebase already contains honest phrasing to align to. Warned about the scratch worktree. |
| B6 | **Analytics defects** | **New.** The four A1 defects — OAuth signup emitter, step-6 double emit, unfiltered broken-paths query, visitor double-count — plus correcting the page's "counts genuine users only" claim. Explicitly forbidden from rebuilding the funnel; that is Wave C and depends on this landing first. |
| B7 | Trading-rules server gate | **New.** `saveTradingRules` is the only gated write in the codebase with no server-side check. |

### Held for the owner, not launched

- **The Free-tier gate move.** A5 showed the audit's central recommendation needs tagging, notes and the weekly review to reach Free. That changes what is sold and is not an engineering decision.
- **Sync cadence** — re-sell the real cadence, or move the trigger off GitHub Actions.
- **Three sold-but-unbuilt entitlements** — premium challenges, priority support, priority beta access.
- **`/learn` and the AFSL position.**
- **`crypto_autosync`** is false for Pro in production; a Pro user can connect Binance and never sync. May be deliberate, like the learning flags. Not touched.

### B0 — the E2E blocker, root cause confirmed (2026-09-09)

Found and verified before the agent wave was interrupted, so recording it here
rather than paying to re-derive it.

`app/package.json:18` already documents it, in a `"//engines"` comment:

> Local Node 22.19.0 breaks the dev server's streaming SSR: the response dies
> with `controller[kState].transformAlgorithm is not a function` just before
> React's `$RC` reveal script, so hard page loads hang on the Suspense skeleton.

`app/.nvmrc` pins `22.11.0`. **`node -v` in this environment is `v22.19.0`.**

That is the misleading click timeout explained: the page never leaves the
Suspense skeleton, so Playwright's click target never becomes actionable and the
failure surfaces at the click rather than at the hung render. It is an
environment problem, not a code defect — exactly as expected. The fix is to run
the dev server under the pinned Node, not to touch the tests.

One blocker identified; the second is still open.

### B7 — trading-rules server gate (complete, `166c3ca` on `fix/rules-server-tier-gate`)

`saveTradingRules` now re-checks the tier server-side and returns `{ error }`.
Full unit suite green (81 files, 1171 tests), `tsc` and eslint clean. Not merged.

**Two latent bugs in the interrupted partial work, both caught before they
shipped:**

1. The helper was named `gate`, but `saveTradingRules` already contains
   `const gate = await allowAction(JOURNAL_BUDGET, user.id)`. A `const` shadows a
   module-scope function across the **whole** function body, so calling `gate()`
   anywhere inside would hit the temporal dead zone and throw
   `ReferenceError: Cannot access 'gate' before initialization` — for every
   caller, Free and Trader alike. Renamed `requireRulesTier`.
2. `export const RULES_GATE_ERROR` would have failed the build: a `'use server'`
   module may only export async functions. It was also the only `export const`
   across all of `app/src/app/actions/*.ts` — every sibling gate constant is
   module-private. Now private; the test rebuilds the string from
   `requiredPlanLabel('trading_rules')` instead, pinning the same property.

**`getTradingRules` left ungated, deliberately.** It returns only the caller's own
row, and the paid capability — the compliance analysis — is computed in
`journal/page.tsx` behind `canRules`, not in this function. Gating it would fail
closed on downgrade and make a lapsed Trader's own saved rules unreadable to
them. Two paths already read that row with no tier check for the same reason: the
GDPR export (`actions/account.ts:155`) and the rule-breach notification
(`actions/trade.ts:632`). The reasoning is a comment above the function so nobody
"fixes" it later.

**Flagged, not changed:** `actions/trade.ts:632` still sends rule-breach
notifications to any account holding a `trading_rules` row, with no tier check. A
Free account can no longer create one, but a downgraded Trader keeps receiving
them. May be intended generosity — owner's call.

### B2 — cohort immature cells (complete, `5b49ecf` on `fix/cohorts-immature-cells`)

Immature cells now render `n/a` with no heat fill; a measured zero still renders
`0%`. Full unit suite green (81 files, 1179 tests). Not merged.

The interrupted work's data layer turned out to be **already complete** — both
`toRows` and the cohort mapping spread `{ ...a }`, so the maturity fields flow
into the cohort rows and all four breakdown tables automatically. Pinned by test
rather than rewritten.

Completed: `matured` and `retained` each held their own copy of the
`now >= signupMs + day * DAY` comparison; the comparison now lives in `matured`
and `retained` calls it, so the two cannot drift. Behaviour-identical — the guard
was already the exact negation.

**The badge was over-claiming twice.** It read "Internal excluded" with a subtitle
saying "Internal traffic excluded everywhere". `api/track/route.ts:139-141` writes
`isInternal` to the **event stamp**, not the profile row, so an admin whose
profile is unflagged is dropped from the event-based pages but still counted
here. It now reads "Internal profiles excluded" with a hint spelling that out.
The filter itself is untouched.

13 tests, including a partially-mature cohort (two members in one signup week,
one exactly 30 days old and one 26) asserting it renders `25%` — retained/size —
not `50%` — retained/due. One test pins `dN <= dNDue` across all rows, the
invariant that fails if the two ever diverge.

Worth knowing: `admin-gate.test.ts` keys on PascalCase names and would **not**
have flagged the shared `pct` export if a `'use client'` directive were added to
`RetentionCell.tsx` later, so the new test asserts the absence of that directive
directly.

**Unrelated flake found:** `billing-checkout-retry.test.ts` failed twice on a
cold, heavily loaded full-suite run, then passed alone and on every subsequent
run, including on clean `main`. Pre-existing mock leakage, not a regression.

### B6 — analytics defects (complete, `3714731` on `fix/analytics-funnel-defects`)

All four defects fixed. 1197 unit tests green, `tsc`, lint and `next build`
clean. Not merged.

**The OAuth emitter needed a guard I had not anticipated.** The callback at
`auth/callback/route.ts` serves **login as well as signup** and cannot tell them
apart — and since the funnel counts rows, an unconditional emit would have
reported a signup for every Google sign-in. Worse than the undercount it fixes.
Two guards in the new `lib/server/oauth-signup.ts`: the account was created
within 5 minutes (60s clock-skew tolerance), which stops every pre-existing
Google account being backfilled into the window; and no `signup_completed` row
exists for that user yet, covering a second callback inside the window. Props
mirror `auth.ts:151` exactly, with `method` from `app_metadata.provider`.

**Step 6:** the `track` call is gone from `submit()`; `go()` now takes optional
props and emits once per mount. The `connect` datum moved onto the surviving
emit, so it now fires when the review screen is *reached* rather than when the
final button is pressed — strictly earlier, and it captures people who reach the
review and abandon. Back-navigation emits were fixed rather than deferred, via a
per-mount `Set`; per-mount rather than per-user because a localStorage restore
sets `step` without going through `go()`.

**Broken paths** now apply both exclusions. One divergence left standing and
commented: that query caps at 5,000 rows and the stat at 20,000, so past 5,000
404s in a month they would disagree again — the real fix is an aggregate query.

**App visitors:** any `anon_id` ever seen beside a `user_id` resolves to that
user before the set is built, with internal filtering first so an internal user's
anonymous rows cannot survive as a visitor. Labelled `App visitors (est.)` with
the residual limit in the tooltip. At the audit numbers, 128 → 116.

**The caption** no longer claims "Every figure counts genuine users only". It now
says which figures count events and which count distinct users. The eight funnel
tooltips also said "Users who…" and were rewritten to name the event.

**Left deliberately:** Google signups still get no `acquisition_source` — the
email path writes the `ts_ref` cookie to the profile and the OAuth path never
has, so "Signups by source" still cannot attribute a Google signup. Flagged in a
comment, not fixed; it is attribution behaviour, not one of the four defects.

**Found in passing:** two broker-funnel bars had no tooltip at all — `HINTS` still
carried a `'Broker card viewed'` key while `funnel.ts` returns
`'Settings page reached'` and `'Broker card on screen'`. Rename drift. A new test
asserts every step label the dashboard returns has a `HINTS` entry.

### B4 — leaderboard (complete, `2d3579b` on `fix/leaderboard-claims-b4`)

1191 unit tests green (twice), `tsc` and eslint clean. Not merged.

**Replacement for the false claim:**

> Ranked on public closed trades, grouped by how the numbers got here. Ranking is
> available at Trader level and above — which the 14-day trial also grants — so a
> name here means an eligible account, not a paying one. Self-reported rows are
> typed in by the trader and are not verified; what we can and cannot check.

It states the eligibility rule, disclaims the payment inference in the same
breath, and links to `/verification` rather than re-asserting anything.

**Default sort → expectancy.** P/L is a function of account size: risking 1% of
$500k beats risking 1% of $2k on identical decisions, so a money leaderboard ranks
balances rather than trading. Expectancy is risk-normalised and is already what
`lib/server/compare.ts` uses to benchmark peers. `consistency` was rejected
(rewards flatness — never risking anything scores near 1) and `riskAdjusted` too
(better statistic, needs a far larger sample than the floor and cannot be
explained on a row). A test constructs a whale and a craftsman with identical
decisions at 100× scale and asserts the ordering flips between `pnl` and the new
default.

**Sample floor → 5**, taking the stricter of the two conventions already in the
codebase, on the grounds that being named on a public board is a louder claim
than contributing to an anonymous median.

**Also fixed:** the standing card was previously ranked on period only, so after
the default-sort change it would have printed a rank the table contradicted one
scroll below. It now ranks on the same metric, period and floor as the board.

**Behaviour change outside this task's stated scope, flagged not hidden:** the
floor is clamped inside `getPerformanceRanking`, whose two other callers — the
home dashboard and profile pages — passed the old default of `0`. "Ranked" now
means the same sample everywhere, which is the point, but those two pages change
too. Both degrade gracefully (`mine?.rank ?? null`): under 5 trades a user now
shows no rank instead of a rank earned on one trade.

Those callers still order by `pnl` deliberately — they render P/L bars and a
gap-to-leader beside the rank, so moving them needs their copy moved too.
Documented at `ranking.ts:101-109`. Adjacent pre-existing bug noted for whoever
picks that up: `[username]/page.tsx:205` reads `board[0]` as "the leader", which
since the cohort split is the top of the *first cohort*, not the overall top.

### B1 — journal honesty pass (complete, `b18cc17` on `worktree-agent-a0d40710dd731cc24`)

83 files / 1219 unit tests green, `tsc` and eslint clean. Not merged. Note the
branch is the generated worktree name rather than a `fix/…` name — rename before
opening a PR.

**No formula changed.** `trade.ts` is purely additive (`rCount`); `computeMetrics`,
`statsFor`, `equityCurve`, `assetDistribution`, `periodSums` and
`computeWeeklyDetail` are otherwise byte-identical. The only behavioural change in
`compare.ts` / `weekly.ts` is *withholding* deltas, never recomputing them.

**The footer** now derives count and net from one shared definition of "shown"
(`matchesTradeFilter`, `netOfTrades` extracted into `journal-stats.ts`), so the
filter moves both. The month figure moved to the tiles that name a month.

**Profit-factor tone** is now `profitFactorTone(pf, rCount)` — break-even at 1
with a ±0.01 dead band, `Infinity` positive, and `rCount === 0` muted. That last
case matters: `computeMetrics` returns `profitFactor: 0` for a journal with no
R-bearing trades, which a naive `pf < 1` test would paint as the worst result on
the page.

**The no-data work turned out worse than the audit described.** `computeMetrics([])`
returns zeros, and the weekly review subtracted last week from those zeros — so a
trader who took no trades was shown **"▲ 0.60R"** and told their average R had
improved. Comparisons now return `null` wherever a rate lacks a denominator on
either side, and the cards render "no comparison" rather than an arrow *or*
"flat" — "flat vs last week" being its own false claim about an empty week. Trade
counts stay real numbers, since 6 to 0 is measured.

**The agent caught its predecessor's own new false caption.** The interrupted
implementation had relabelled the 7-day tiles "closed in the last 7 days", but
`JTrade` has no closed-at column — both `periodSums` and `weekSlice` window on
`traded_at` — so that caption excluded a position opened last month and closed
yesterday while claiming to include it. Exactly the class of defect the task
exists to remove. Now "closed · trade date in last 7 days", with a test asserting
no surface claims a close-date window the schema cannot support.

**All 15 fixes were mutation-checked** — each reverted individually fails its own
test; no mutant survived.

Left deliberately: the equity curve's all-history series (the label moved, the
series did not, since the report renders the same series), formulas, and plan
gates. The new report coverage line uses ISO slices rather than
`toLocaleDateString` to avoid adding an eighth file to the outstanding hydration
sweep.

### B5 — copy corrections (complete, `a19d86a` on `worktree-agent-a11dcd9157a3646ed`)

1194 unit tests green, `tsc` and eslint clean. Not merged. Branch needs renaming
before a PR.

All seven items fixed, plus one instance not in the brief (`landing.ts:100`, the
educators campaign landing, carried the same "results that can be trusted" claim
as `index.html:1866`). New `copy-claims.test.ts`, 28 tests, scanning eight
customer-facing surfaces for the anti-fraud vocabulary in its several spellings
and pinning the bounded anchors. It strips comments before scanning, because
several fixes carry a comment quoting the sentence they replaced.

**Item 5 was worse than a copy bug.** The dashboard onboarding checklist listed
two items impossible on Free — and `OnboardingChecklist` only hides itself at
`done === items.length`. So on a Free account the card was **permanent and the
bar could never fill**. Both items are now behind their feature flags.

**The predecessor's own fix repeated the error class it was fixing.** It had
written "among Trader and Pro members" on `index.html:1817` — which excludes
trialists, who do rank, since an active trial resolves to `pro`. Rewritten to
match the wording B4 landed in-app.

**One "hourly" claim is not a word swap.** Of 30 live occurrences left untouched,
`compare/best-mt5-trading-journal.html:1708` and `:1793` do not merely state the
cadence — they argue *"hourly is enough"* against a competitor. A downward
revision there needs a rewritten argument.

**Two loose ends left, both one-liners:**
- `lib/server/entitlements.ts:269` has a code comment referring to "the board the
  marketing site calls unfakeable". Now stale, since the site no longer says it.
- `for/educators.html:1630` keeps "among Trader and Pro members" — it discloses
  the paywall correctly and was the model cited, but it is now the only one of
  three ranking disclosures that does not mention the trial.

Also noted, deliberately untouched: `automation/n8n/content-queue.json:28` holds a
queued Instagram draft containing "Leaderboards that can't be faked", already
parked by the 2026-08-14 audit. Not live copy; the parked record was left intact
rather than rewriting someone's queued post.

### Merge-order warning

Three branches now touch `app/src/app/page.tsx` and `app/src/app/journal/page.tsx`
independently — B5 (checklist gating), B1 (journal labelling) and B3 (process
rewards). They will conflict. Merge B1 first, then B5, then B3, and re-run the
suite after each.

### B3 — process rewards (complete, `c06db73` on `worktree-agent-a33cc93586c9e2df9`)

1206 unit tests green, `tsc` and lint clean. Not merged.

**MIGRATION `0070_process_logs.sql` MUST BE APPLIED MANUALLY BEFORE THIS BRANCH
MERGES.** Migrations here are manual and Vercel deploys are not; if it merges
unapplied, every reward surface throws on a missing table. It creates
`public.process_logs` with a server-stamped `day` (withheld from the client
column grants), a unique `(user_id, day, kind)` index, per-user RLS and
insert-only `kind`.

**Quests**

| | Before | After |
|---|---|---|
| daily | `log_trade` — 1 trade created | `daily_process` — 1 process entry |
| daily | `close_trade` — 1 trade closed | *removed* |
| weekly | `log_10` — 10 trades created | `weekly_review` — 1 completed review |
| weekly | `close_5` — 5 trades closed | `weekly_reflect` — reflections on 3 days |

Deliberately **one** daily quest: `questStreak` requires every daily quest to be
met, so a second would be a second thing a resting trader must do to keep the
chain alive.

**Badges 15 → 11.** Removed `trades_1/10/50/100/500`, `wins_5`, `wins_10`. Added
`reviews_1/10/25`. `streak_7/30` is now a process-day streak. The `trades` and
`winStreak` categories are gone, and `BadgeStats` no longer carries
`closedCount` or `maxWinStreak`. Trades now earn a flat `XP.BASE_PER_TRADE` per
close — no threshold, streak or quota on top.

`lib/badges.ts` needed no change; it is the Trader+ cosmetic profile-flair preset
list, unrelated to volume.

**Every new reward is reachable on Free**, which was the point. The gate on
`WeeklyReviewCard` is untouched — a paid user's card view still counts, and the
self-recorded review is a second, ungated source deduplicated to one per day.

**One real regression, flagged and left for the owner.** The XP leaderboard no
longer includes any quest bonuses. `getXpRanking` runs with the *viewer's* client
over other people's rows, and `process_logs` RLS is owner-only, so process XP
cannot be read there. The board is now strictly smaller than before — it
previously included the trade-derived bonuses. Restoring it needs a service-role
read plus a decision about whether rest days are published to other users. Left
alone per the task boundaries; flagged in a comment in `lib/server/xp.ts`.

Also pre-existing and untouched: `lessons_*` badges are unreachable by anyone,
since Learn is withdrawn on compliance grounds; they are filtered out of both
badge grids.

### B0 — E2E blockers (complete, `2b58a01` on `worktree-agent-a44c450f107af5fe6`)

**The suite still does not run, and it cannot be made to run from inside the
repo.** Nothing was skipped, relaxed or deleted to reach that answer.

**Correction: the Node pin is not a blocker, and this plan asserted it as one.**
It does not reproduce. `next dev` on v22.19.0 served `/login`, `/signup`, `/demo`
and `/leaderboard` — 200s, complete `</html>`, `$RC` reveal script present, no
`transformAlgorithm` error in the log. Playwright's own Chromium filled and
submitted `/signup` and the server logged six real `POST /signup 200`.

`docs/qa-sweep-2026-08-21.md:88-106` **had already retracted it**: the "every page
blank in dev" observation came from a preview tab that is permanently
`visibilityState: "hidden"`. Chrome runs no rAF in a hidden tab and React 19.2
defers the Suspense reveal through rAF, so a `$RC` page looks frozen there while
the HTML is byte-perfect. That same document notes the pin is counterproductive:
**22.11.0 cannot run vitest** (`ERR_REQUIRE_ESM`; `require(esm)` landed in 22.12).

Also stale: the "misleading click timeout". August's was `element is not enabled`,
a hydration race where SSR emitted the submit button disabled. That is fixed. The
symptom today is a URL-assertion timeout with a rate-limit message on `/signup`.

**The real blocker: "Confirm email" is ON for the dev Supabase project**
(`sixixwutvrguqemqzvvw`, *TradingSocial-Dev* — `.env.local` correctly points at
dev, not production). Three confirmations: GoTrue's `/auth/v1/settings` returns
`"mailer_autoconfirm": false`; the dev server logs
`[signUp] {"err":{"message":"email rate limit exceeded"}}` on every signup
including the first of a cold run; and `auth.users` holds 24 users, 11
unconfirmed, **with nothing created since 2026-08-21** — 19 days of refused
signups.

Confirmation ON means every `signUp()` also sends mail, and Supabase's built-in
SMTP allows a couple of messages per hour per project. 57 specs then time out on
`expect(page).toHaveURL(/\/welcome/)` and the real error never reaches the report.
**Raising the email rate limit will not fix it** — with confirmation ON,
`signUp()` returns no session, so the user is never logged in and `/welcome` is
never reached.

**Owner action, dev project only:** Authentication → Sign In / Providers → Email →
turn **off** "Confirm email". Keep `AUTH_EMAIL_CONFIRMATION=off` to match.

**Second owner item:** `E2E_ADMIN_EMAIL` is unset, so `admin.spec.ts` and
`analytics.spec.ts` skip — 9 of 58 tests and the whole `/admin` surface. Needs a
seeded admin on the *dev* project whose address is in `ADMIN_EMAILS`.
`seed-users.md` documents accounts on **production**, so it is not a shortcut.

**Shipped:** `scripts/e2e-preflight.mjs` reads the target project's auth settings
before the browser starts and names the blocker with dashboard steps; it also
blocks any run pointed at the production ref, since the suite writes real users.
Wired through `global-setup.ts` as Playwright's `globalSetup` rather than an npm
hook, so `npx playwright test <file>` cannot walk around it. It **aborts** a run;
it never skips a spec or widens a timeout, and a structural test asserts neither
file contains `test.skip` / `testIgnore` / `grepInvert` / `--pass-with-no-tests`.
The `"//engines"` note now records the disproven claim and the open item — raise
`.nvmrc` to ≥ 22.12.

---

## Integration (2026-09-10)

Branch `integration/audit-2026-09-05`, 18 commits ahead of `main`. All eight Wave
B branches merged, plus this document. **Not merged to `main`, not pushed** —
migration `0070` is still unapplied, and merging to `main` deploys.

`tsc --noEmit` clean · `eslint` clean · **93 test files, 1368 tests, all passing**.

**Seven of the eight merged clean.** The predicted three-way conflict on
`app/src/app/page.tsx` and `journal/page.tsx` mostly did not materialise — the
agents kept their edits local, as instructed, so git resolved them.

**One real conflict, and it was substantive.** B5 and B3 had independently found
the same defect — the onboarding checklist offered Free users two steps they
could not complete, on a card that only hides itself when every step is done —
and fixed it in opposite directions:

- **B5** hid both steps below Trader.
- **B3** kept the review step visible and made it *achievable*, ticking on the
  new ungated `process_logs` route.

Resolved by taking each where it is right. Tagging has no ungated route, so it
stays hidden. The review step stays visible and ticks on either source —
`reviewViews > 0 || processLogs.some(l => l.kind === 'review')` — because hiding
a step that the user can now actually complete would be the worse answer.

That left B5's structural guard asserting the wrong invariant: it required *both*
steps to sit inside a conditional spread. Re-aimed at what actually matters —
**no step is offered which the account cannot finish** — with the two cases
checked separately. Mutation-checked: strip the `processLogs` clause and the new
test fails.

### Still required before this reaches production

1. Apply `app/supabase/migrations/0070_process_logs.sql` by hand.
2. Merge `integration/audit-2026-09-05` to `main` and push (this deploys).
3. Four constituent branches still carry generated worktree names — cosmetic
   now that the integration branch exists, but rename them if they become PRs.

---

## Wave C — the Basic Cycle (approved and built, 2026-09-10)

The owner approved the free-tier proposal. Three agents, all merged into
`integration/audit-2026-09-05`. **`tsc` clean · `eslint` clean · `next build`
succeeds · 96 test files, 1465 tests passing.** Still not merged to `main`, still
not pushed.

The line every decision resolved against: **Free gets the inputs to reflection;
paid gets the analysis of performance.**

### C1 — gates (`feat/basic-cycle-c1-free-tier`)

`mistake_tagging` to free; new `mistake_analysis: 'trader'` so the *card* stays
paid while the *tag* does not; new `multiple_goals: 'trader'` with
`FREE_ACTIVE_GOAL_LIMIT = 1`. `strategy_tracking` untouched, with a comment at the
call site saying so, because it is the change most likely to be made "while we're
in here".

The goal cap **counts, never deletes** — an account over the cap keeps every goal
and its progress, can still remove one, and only cannot add. A failed count is
treated as *at* the cap, not under it.

### C2 — per-trade reflection (`feat/per-trade-rule-reflection`)

Two nullable columns on `trades` rather than a side table. The deciding argument:
a side table would need a *fresh* argument about imported rows and could pick up
`0053`'s `source = 'manual'` reasoning by mistake, which is the opposite of what a
reflection needs. Columns inherit the answer `0028` already gives, and a test
reads `0028` and fails if either column name ever enters the locked-fields tuple.

`process_logs` untouched — its `(user_id, day, kind)` index is the anti-farm cap.
The two records answer different questions: `0070` is "did you reflect today"
(habit, capped), `0071` is "did this trade follow the plan" (evidence). Only the
second produces *three of four sessions followed your checklist*.

Import hands off to a reflect card rather than inlining the prompt — one upload
can land 200 trades, and a 200-step wizard is a 200-step dismissal. On a mixed
day the first answer stands, because amending would let the last trade answered
rewrite the day's label by click order.

### C3 — the basic weekly review (`feat/basic-weekly-review`)

Ungated card above the paid one: focus and its progress, trades closed, `n of m`
reflections, days stood aside, the four buckets, a followed-rate that says
**"not 0%, none"** when nothing is answered, keep/revise/retire, and last week's
decision on file. None of the paid figures — enforced by *two* structural guards:
an identifier blocklist, and an import blocklist forbidding `@/lib/weekly`,
`@/lib/trade`, `@/lib/insights` and `@/lib/journal-stats`, so the card cannot
compute a paid figure without a visible reach-past.

**Counts over the week window, not `visibleTrades`** — the latter is capped at 30
on Free, so a review of "this week" would silently omit trades.

A rest-only week is **complete, not empty**, and says so.

**New table `weekly_reviews` (0073).** `authenticated` gets SELECT on its own rows
and **no INSERT/UPDATE/DELETE at all**; the action re-derives every count from
`trades` and `process_logs` and writes with the service client. A user can decide
anything about their own focus; they cannot author the evidence. A CHECK
constraint refuses any row where the four buckets fail to partition.

### Three things caught in integration that a brief would not have

1. **C1 and C2 both shipped a `0071_`.** Different filenames, so git merged both
   happily. C3 spotted it and renumbered the one with a single test reference.
2. **My C3 brief would have caused a double-count.** "Free, and everyone" would
   have mounted two `weekly_review_viewed` emitters on a Trader+ page. The by-day
   union in `goals.ts` would have absorbed it, but **every rate computed on the
   raw event would have halved**. Now exactly one emitter mounts at any tier.
3. **Mistake tags were write-only for Free.** C1 moved the tag to free but nothing
   renders `mistake_tags` outside the Trader+ card, the Pro report and the digest
   email. C3 passes them as a separate prop built from an own-rows-only query
   rather than widening `JTrade` — an optional field would be a standing
   invitation to add the column to the public-profile select "to satisfy the
   type"; a separate argument cannot be picked up by a component rendering
   someone else's rows.

### Four migrations, all unapplied

`0070_process_logs` · `0071_trade_reflections` · `0072_mistake_tagging_free` ·
`0073_weekly_reviews`

Two of them fail in opposite directions if skipped. `0071` carries a
`grant update` — `0045` revoked the table-wide default, so without it PostgREST
rejects every reflection write outright. `0072` is inert until applied: ship its
code without it and the pricing page advertises free mistake tagging that the
flag row still denies. **Apply the migration before the code, not after.**

### Flagged, not changed

The weekly digest email (`api/cron/lifecycle-emails/route.ts`) is ungated at every
tier and sends Free users `winRate` and `netR` — a pre-existing breach of the
free/paid line that predates all three C tasks. Its most-tagged-mistake line will
also start firing for Free accounts once `0072` runs; that part is now consistent,
since those users can find the tag in their journal.
