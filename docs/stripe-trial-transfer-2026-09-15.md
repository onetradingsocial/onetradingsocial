# Transferring the 14-day trial onto Stripe

**Date:** 2026-09-15 · **Status:** plan, nothing implemented

**Decisions taken by the owner:**

1. Card required at trial start, auto-converting on day 14.
2. **Everyone trials Pro**, on the Pro monthly price. No plan picker at signup;
   anyone who wants Trader downgrades before day 14 in the billing portal. The
   trial offer therefore does not change — only the card does.

## 0. Applied state

Migrations are hand-applied here and deploys are not, so this is the record of
what is actually live. Update it whenever one moves.

| Migration | dev `sixixwutvrguqemqzvvw` | prod `jmpanzrjxflovdfwcbye` | Notes |
|---|---|---|---|
| 0076 subscriptions trial window | ✅ 2026-09-15 | ✅ 2026-09-15 | Must precede the code merge — the columns are written, not read |
| 0077 `trial_eligible` DEFAULT false | ⛔ held | ⛔ held | Launch day only, **with** step 6. Applying it alone withdraws the advertised trial |
| 0078 `admin_search_users` tiebreak | ✅ 2026-09-15 | ✅ 2026-09-15 | Read-only function, safe in any order |

Env, both unset — the code ships inert until these move:

| Variable | State | Flip when |
|---|---|---|
| `LOCAL_TRIAL_DISABLED` | unset (local trial armed) | Launch day, with 0077 and step 6 |
| `TRIAL_WALL_ENABLED` | unset | Becomes a no-op for new accounts anyway — see 5.7 |

Branch `feat/trial-to-stripe` holds steps 0–5 (terms). **Nothing user-visible has
changed yet**, by design: the columns exist and sit unused, the latch is still
armed, and the Stripe checkout branch does not exist.

### Launch day — these flip together or not at all

Each one alone is wrong in some direction, so treat this as one atomic change.

| # | Action | Alone, it would… |
|---|---|---|
| 1 | Ship the `flow: 'trial'` checkout branch (step 6) | — |
| 2 | Set `LOCAL_TRIAL_DISABLED=true` in Vercel | leave new signups with no trial at all |
| 3 | Apply **0077** to both projects | same, and durably |
| 4 | Publish Terms §8 | describe a card requirement that does not exist |
| 5 | **Re-bump** `terms` version + "Last updated" to the real launch date | date a document to a day nobody could read it |

Step 4's terms text is drafted and committed but carries a `MUST NOT BE
PUBLISHED BEFORE` comment for exactly this reason. Item 5 is the one most easily
forgotten: the drafting date (2026-09-15) is a placeholder.

## 1. Where we are today

Two trial mechanisms exist and they share no code.

| | Advertised 14-day Pro trial | Referral reward trial |
|---|---|---|
| State | `profiles.trial_started_at` / `trial_ack_at` / `trial_eligible` | a real Stripe subscription |
| Card | none | required (`payment_method_collection: 'always'`) |
| Stripe objects | **none at all** | `trial_period_days: months × 30` |
| Ends by | expiring into a modal wall | Stripe billing Pro monthly |
| `trial_will_end` | can never fire | fires, day −3 |

`lib/billing-webhook.ts:173` and `api/stripe/webhook/route.ts:224` both say it
outright: the advertised trial creates no Stripe object. That is the thing this
work changes.

## 2. Production state, 2026-09-15

Read from `jmpanzrjxflovdfwcbye`, not assumed:

- 500 profiles. **451 are internal/seed.**
- `subscriptions` holds **exactly one row, `canceled`**. There is no live
  recurring revenue to endanger.
- 3 profiles carry a `stripe_customer_id`.
- Trial states: 430 never trialed, 26 active, 42 expired-unresolved, 2 resolved.

**The 26 active trials are only 7 real people.** 19 are internal:

| days left | real users | internal |
|---:|---:|---:|
| 14 | 2 | — |
| 11 | 1 | — |
| 8 | 1 | 11 |
| 7 | — | 6 |
| 6 | — | 2 |
| 4 | 1 | — |
| 2 | 2 | — |

So the "transfer" is a **7-row problem**, and the whole cohort has drained
within 14 days of the switchover regardless of what we do.

## 3. The constraint that decides the design

**A card-required trial cannot be applied retroactively.** Creating a Stripe
subscription needs a payment method; those 7 people have none, and they were
sold a trial that explicitly took no card (Terms §8 draws that exact
distinction). Silently moving them onto a subscription that bills them on day 14
is not a data migration, it is charging people who never gave us a card.

Therefore:

> The in-flight trials are **grandfathered on the local mechanism and invited to
> add a card**. The Stripe-native trial applies to **new signups only**. The
> local trial code stays alive until the last grandfathered trial drains
> (≤ 14 days after launch), then is removed.

"Transferring the trials" is one migration plus one conversion campaign, not one
migration.

## 4. Target flow

```
NEW SIGNUP
  confirm/callback  ->  session exists
        |
        v
  /welcome : "14 days of Pro Trader, free" - one CTA,
        |     no plan picker. TrialPlanPicker.tsx stays unused.
        v
  POST /api/billing/checkout  { flow:'trial' }
        |
        |  tier/interval forced server-side to pro/monthly,
        |  exactly as the referral branch already forces them,
        |  so the price can never be chosen by the client
        |
        |  mode: 'subscription'
        |  subscription_data.trial_period_days: 14
        |  subscription_data.trial_settings
        |      .end_behavior.missing_payment_method: 'cancel'
        |  payment_method_collection: 'always'
        |  adaptive_pricing: { enabled: false }          <- keep, AUD is quoted
        v
  Stripe Checkout  ->  A$0 due today, card stored
        |
        v
  customer.subscription.created   status='trialing'
        |  -> mirror row, tier granted by tierFromSubscriptions
        |     (ACTIVE_STATUSES already contains 'trialing' - no new gate logic)
        |  -> ack the LOCAL trial  (see 5.2, this is the trap)
        v
  day 1 / 7 / 12 lifecycle emails   <- MUST be re-keyed, see 5.3
        |
        v
  day 11  customer.subscription.trial_will_end
        |  -> notifyTrialWillEnd, currently referral-only copy
        v
  day 14  invoice -> paid : status='active'
                  -> failed: past_due, 14-day grace already implemented
```

Cancel path is the existing billing portal. The end-of-trial **wall**
(`shouldShowWall`, `TRIAL_WALL_ENABLED`) becomes dead for new users: Stripe
either bills them or cancels them, so there is nothing to wall.

## 5. What breaks, ranked by how quietly

### 5.0 The launch-day landmine — fix this first or do not launch

`0075_trial_eligible_marker.sql` sets `profiles.trial_eligible` **DEFAULT true**,
and the chokepoint in `lib/server/trial-start.ts` arms a local trial on the first
authenticated render of any eligible account. **Nothing else gates it.**

So on launch day, a new signup gets a Stripe Pro trial *and* a local Pro trial.
They land in both cron cohorts. On day 12 the legacy sequence emails them
`lib/server/email.ts` copy that reads **"You will not be charged"** — two days
before Stripe charges their card.

That is not a quiet failure. It is a written promise not to charge, sent to
someone we are about to charge, generated by our own cron.

**Flipping the default is necessary but NOT sufficient.** An earlier draft said
it was a one-line migration; the entitlements audit found two ways it is
defeated, and both must be closed in the same change:

1. **The marker-free fallback re-arms trials, bypassing the column entirely.**
   `lib/server/trial-start.ts:179-187` drops the `trial_eligible` filter and
   writes with only `.is('trial_started_at', null)` whenever `markerMissing()`
   returns true — and that helper accepts **`PGRST204`**, which is PostgREST's
   *stale schema cache*, not just a genuinely missing column. So a cache blip on
   any of the three entry points arms a local trial for a brand-new account
   regardless of the default. Under the old flow this was the documented safe
   degradation; under the new one, "no marker" must mean "no local trial". This
   fallback is the only code path that can create a local trial without
   consulting the column, and a DEFAULT change cannot protect you from it.
2. **0075's `set default true` is unguarded.** `0075_trial_eligible_marker.sql:71`
   runs `alter column trial_eligible set default true` with no `if not exists`
   equivalent, and 0075's own header says it **"MUST BE APPLIED BY HAND TO BOTH
   PROJECTS"**. Hand application is exactly where ordering is not enforced: a
   replay, a cherry-picked hotfix, or someone re-running 0075 because they think
   it did not take will silently re-arm every subsequent signup. Do not fix this
   by editing 0075 in place — it is already applied to both projects, so an edit
   changes nothing live, and `tests/unit/trial-start.test.ts:388` reads 0075's
   SQL text and asserts the `default true`.

So step 0 is: new migration flipping the default, **plus** deleting the
marker-free fallback, **plus** removing the three entry-point call sites.

Everything else on this list is recoverable after the fact. This one is not.

### 5.1 The entitlement core DOES need a change — 28 free days on a declined card

An earlier draft of this plan said the entitlement core needed no work because
`ACTIVE_STATUSES` already contains `trialing`. **That was wrong**, and the error
is worth recording because it is a natural one to make.

The grant path is indeed free. The *failure* path is not:

1. Day 14, the card declines. Stripe does **not** use `incomplete` — that status
   is only for a subscription whose very first payment fails at creation. A
   converting trial was `trialing`, which Stripe treats as established, so it
   lands in **`past_due`**.
2. `subscriptionGrantsTier` grants `past_due` a **14-day grace window**.
3. `notifyPaymentFailed` emails "Your latest payment didn't go through… you keep
   your paid features for the next 14 days" — to someone who has never paid us
   anything.

**14 days of trial + 14 days of grace = 28 days of Pro on a card that never
worked, repeatable per account, with a courtesy email confirming it.**

The code already holds the right principle — `entitlements.ts` withholds grace
from `incomplete` precisely because "the customer has therefore never held the
tier". The invariant it *intends* is "no grace to someone who never paid". The
invariant it *expresses* is "no grace if the status is `incomplete`". Those were
the same thing until trials created subscriptions.

The lever needed already exists and is unused: `billing_reason` is declared on
`StripeInvoiceLike` at `lib/billing-webhook.ts:92` and never read. The robust
discriminator is "has this subscription ever had a paid invoice", which is a
further argument for the mirror column in 5.3.

### 5.1b The referral reward pays out on a signup — funded abuse, one line

`api/stripe/webhook/route.ts:79` calls `markReferralPaid` whenever a
subscription is `active` **or `trialing`**. Today only a real purchase reaches
that branch. Once every signup opens a trialing subscription, it promotes the
referral from `signed_up` straight to `paid`, **skipping the `activated` gate
that requires the referred user to actually log a trade**. `getReferralStats`
counts `paid` toward `activated`, and `earnedMonths()` pays the referrer on that
number.

Net: a referred user signs up, enters a card, never trades — and their referrer
immediately earns a free month of Pro. This is real money leaving, triggered by
one status string in one condition.

### 5.1c The ads pixel starts reporting every signup as a $0 purchase

`checkout.session.completed` fires the Reddit `Purchase` conversion with
`value: session.amount_total / 100`, which is **0** for a trial session, and the
`subscribed` funnel event alongside it. Every signup becomes a zero-value
purchase. That poisons ad optimisation — the platform learns to find people who
convert at $0 — and it flatters the funnel at the same time (see 5.3b).
Gate on `amount_total > 0` or `flow !== 'trial'`, and fire `StartTrial` instead.

### 5.2 The double-grant trap — largely dissolved by decision 2

`effectiveTier` takes the **highest** of comp / Stripe / local trial, and the
local trial grants **Pro**. Had the trial run on the user's chosen price, a
grandfathered user starting a Stripe **Trader** trial would have kept Pro until
their local trial lapsed and then silently dropped a tier mid-trial.

Because every Stripe trial is now **Pro**, both grants are the same tier and
`higherTier` is a no-op. A grandfathered user holding both sees Pro throughout
and nothing flips. This removes the hardest correctness problem in the change.

**But the cliff survives the decision.** The audit found the decision removed the
plan picker *at signup* and nothing else: Trader is still purchasable mid-trial
from `TrialPlanPicker.tsx:37` (reached via the nav chip and the ≤3-day banner)
and from `BillingActions.tsx:288`. A grandfathered user who buys Trader on day 2
holds Pro until T0+14d exactly, then drops. Fifteen features flip at that
instant, `maxStrategyTags` goes 8→1 and silently truncates saved trades, and
worst — `api/cron/crypto-sync/route.ts:31` and `api/mt5-sync/collect/route.ts:148`
**park the account in `status:'error'`** with "Auto-sync requires the Pro plan".
Their broker feed stops overnight with no notice.

The residual question is still worth stating explicitly rather than inferring:
`shouldAckTrialOnSubscription` deliberately refuses to ack mid-trial, because
acking resolves the local trial and so revokes its Pro grant. With both grants
at Pro that revocation is now harmless, but the predicate should be re-derived
deliberately — not left to coincidence, since it silently becomes load-bearing
again the day anyone offers a Trader trial.

### 5.2b The new risk decision 2 creates: A$50 is the default outcome

Every trial now converts to **Pro monthly, A$50**, unless the user actively
downgrades. Two consequences:

- The day-11 `trial_will_end` email stops being a courtesy and becomes the
  **legally load-bearing notice**. It must name the amount (`A$50`), the exact
  date, and the route to downgrade or cancel, before any money moves.
- **The downgrade route must actually exist.** Verify the Stripe billing portal
  configuration behind `api/billing/portal/route.ts` permits switching Pro →
  Trader during the trial. If it only allows cancellation, the offer reduces to
  "Pro or nothing", which is not what was decided.
- Annual is unreachable from the trial, so the beta annual coupon
  (`STRIPE_COUPON_BETA_ANNUAL`, 76% off the first invoice) never applies to a
  trialling user. Someone who wants annual has to switch in the portal, where
  the coupon will not follow them. That is a real discount gap, not a bug —
  flagged for a pricing decision.

### 5.3 The lifecycle emails go silently dead — highest risk in the whole change

`api/cron/lifecycle-emails/route.ts` selects on `trial_started_at is not null`
for both the day-1/7/12 sequence and the expiry notice. Once new signups get a
Stripe trial and that column is never written, **every trial email stops for
every new user**, the cron keeps returning 200, and nothing logs an error. This
is the same failure class as the 2026-09-04 `/admin/feedback` outage and the
feedback-triage dropdown: green tests, green logs, no product.

Both queries must be re-keyed to the subscription trial window before, or in the
same deploy as, the checkout change. Two complications found by the audit:

**The day-1/7/12 sequence is recoverable. The expiry notice is not.** The
`subscriptions` mirror has no `trial_end` column (`0009_billing.sql`), and once a
trial ends the row is either `active` (converted — no notice wanted) or
`past_due`/`canceled` (a different email entirely). There is no state meaning
"the 14 days elapsed on date X". Note `sub.trial_end` is **already read** into
`StripeSubLike` at `lib/billing-webhook.ts:14` and used at `:187` — it is simply
never persisted by `subscriptionRow()`. So the fix is small: add `trial_end`
(and `trial_start`) to the mirror and populate them there.

**The emails contradict each other during grandfathering.** `trialSequenceHtml`
and `trialExpiredHtml` hardcode "No card was taken and none is needed" and "You
will not be charged". A legacy trialist must keep that copy; a Stripe trialist
must get the opposite. They are one function today and need a `cardOnFile`
argument before either branch is re-enabled. Dual-read window is **~21 days**,
not 14 — the expiry notice has its own 7-day window on top.

### 5.3b The admin numbers break upward, which is worse than breaking down

Every new signup now carries a `trialing` subscription row, and three places
treat `trialing` as paid:

- `lib/server/funnel.ts` counts `['active','trialing']` as **Paid**, so every
  trialist reads as a paying customer from day 0.
- The `checkout_started` / `subscribed` funnel steps now fire at signup, so
  conversion reads **~100%**.
- `lib/admin-users.ts` and `admin/users/[id]/page.tsx` label every trialist
  **"Pro, source Paid"** — no way left to tell a trialist from a customer.

A metric that silently inflates is harder to catch than one that zeroes, because
nobody investigates good news. Needs a distinct `Trialing` bucket in all three,
plus the `HINTS` copy in `admin/analytics/page.tsx` updated in the same commit.

### 5.3c The e2e suite goes green while the button stops working

Every e2e spec's signup helper clicks `button:has-text("Start my trial")` on
`/welcome`, and that page only checks `onboarding_completed` — it never reads
`trial_started_at`. The whole suite stays green while the button stops starting
anything. `tests/e2e/trial.spec.ts` and `welcome-popup.spec.ts` are worse: they
write `trial_started_at` directly via the service client, manufacturing the exact
state production stops producing. No test anywhere asserts the lifecycle cron
selected a non-empty cohort.

### 5.4 `trial_will_end` copy is referral-shaped

`notifyTrialWillEnd` and `willChargeAtTrialEnd` in `lib/server/billing.ts`, and
the handler comment in the webhook, all assume the only card-backed trial is the
referral reward. Under this change it becomes the **default** path and the copy
is wrong for it.

### 5.5 Legal and pricing copy is a hard dependency, not a follow-up

The audit found this is far larger than "a few strings". Roughly **50 distinct
claims across 18 static pages, 12 app surfaces and 8 email templates** become
false on the day this ships. Full inventory is in the audit; the load-bearing
parts:

**Terms §8 inverts, sentence by sentence.** `terms.html:1147-1150` currently
reads "**No payment details are required** — we do not ask for a card and we do
not create a subscription or any other billing record for it" and "**It does not
convert into a paid subscription.** Nothing is ever charged, because there is
nothing to charge." Both become the exact opposite of the mechanism. §8's whole
structure also collapses: `:1156` frames the referral reward as "the one
exception", and after this change it is not an exception — it is the same thing.

**§10 has no first-charge branch.** It is written entirely around a *renewal*
failing. After this change the most common dunning event is the **day-14 first
charge**, on someone who has never paid and does not consider themselves a
subscriber. Ties directly to the 28-day grace defect in 5.1.

**The worst single line in the codebase** is `lib/server/email.ts:270`, day 12:
"**You will not be charged.** The trial never asked for a card and there is
nothing to cancel." Non-suppressible by design, sent to every trialist, **two
days before we charge them** — and one day *after* Stripe's `trial_will_end`
email has told them they will be. Two contradictory emails about money, 24 hours
apart. `:274` then adds "Happy to carry on with Free? Nothing to do" —
instructing the inaction that causes the charge.

**JSON-LD structured data outlives an HTML edit.** `compare/tradezella-
alternative.html:1545` and `for/index.html:1496` assert the no-card trial in
machine-readable form, are eligible for rich results, and persist in Google's
cache after the page is fixed.

**The referral share text cannot be recalled.** `ReferralModal.tsx:37` generates
outbound text users paste into X, WhatsApp and email advertising a "free 14-day
Pro trial" with no card disclosure.

**`STRIPE_TOS_CONSENT` ships OFF.** `lib/terms-acceptance.ts:85-91` gates
Stripe's own consent checkbox behind a flag that defaults off, because Stripe
rejects the parameter when no ToS URL is set in the Dashboard. That checkbox is
about to become the acceptance record for the entire user base, and it does not
currently render. `LEGAL_VERSION` must also be bumped when §8 is rewritten, or
pre- and post-change consent records are indistinguishable.

**GST, and why day 14 sharpens it.** `lib/plans.ts` still carries the unresolved
placeholder marked "owner decision required", citing ACL s48. Today the gap is a
defect in a *quotation* — the user takes several deliberate steps before money
moves, each a chance to disclose the true total. Once the card is captured at
signup and day 14 is automatic, the quoted figure stops being an invitation and
becomes **the authority for a debit the user never re-confirms**. If A$30/A$50
exclude GST, the amount leaving the account is one the customer was never shown.
The day-12 notice and the conversion receipt cannot be written correctly until
this is answered, and both are now mandatory rather than optional.

**Two surfaces are already right, and are the template.**
`ReferralModal.tsx:168` ("A card is required to claim — A$0 due today. After
your free months end, Pro renews automatically at A$50/month…") and the
`willCharge: true` branch of `trialEndingHtml` at `email.ts:186-189`. Both name
amount, date and cancel route before money moves. Every trial surface has to
start doing what these two already do.

### 5.6 Stale Stripe customer ids are armed

Production moved to a live key on/around 2026-09-07; eight early profiles carry
`cus_` ids minted under the sandbox namespace. `api/billing/checkout` already
re-mints once via `isMissingCustomer`. Any new code path that creates a
subscription must go through that same helper, not a bare `sessions.create`.

### 5.7 The wall dies silently, and a failed card throws confetti

Two findings from the entitlements audit that have no home above.

**`shouldShowWall` becomes structurally dead.** `TrialState` is derived *only*
from `profiles.trial_started_at` / `trial_ack_at`. Once the latch is disarmed,
every new account is `'none'` forever, so the wall can never fire whatever
`TRIAL_WALL_ENABLED` is set to. The env var silently becomes a no-op for the
entire user base while `getEntitlements` keeps evaluating it. The wall survives
only for the ~7 grandfathered accounts. That may be fine — Stripe now bills or
cancels, so there is nothing to wall — but it should be a decision, not a
side effect nobody noticed.

**A user whose card fails gets a celebratory "Welcome to Free".** Traced end to
end: day 0 the popup fires for Pro and writes `welcome_tier_seen = 'pro'`; day
14 Stripe cancels for a missing card, tier drops to `'free'`, and
`shouldShowWelcome('pro', 'free', 'none', false, true)` returns **true** — the
`trial === 'expired' && tier === 'free'` guard does not apply, because `trial`
is `'none'`, not `'expired'`. The user is shown "You're on Free · A$0/month ·
free forever" with confetti, at the moment their trial died unpaid.

This is precisely what that guard was written to prevent — its own comment calls
it "a confetti *Welcome to Free* at exactly the moment the user lost Pro". It
misses because the guard keys on `TrialState`, which no longer tracks the thing
that ended. Root cause: `welcome_tier_seen` is a single undirected scalar, so
`seen !== tier` cannot tell an upgrade from a downgrade. Note
`tests/unit/welcome.test.ts:37` asserts this behaviour is *correct*.

### 5.8 The ack rule, stated as a predicate

The old rule ("never ack mid-trial") is now **actively harmful**: leaving a
paying Pro subscriber unacked keeps them in the lifecycle cron's cohort, which
emails them "Your Pro trial ends in 2 days" and, at day 14, "you are capped at
30 trades" — both false for a live subscriber. Under this flow you ack *earlier*,
not later.

The reason acking is safe is **not** "a subscription exists". It is: *the Stripe
grant already outranks the local grant, so resolving the local one cannot lower
the effective tier.* Write it as a rank comparison so it stays correct if anyone
ever ships a Trader trial:

```
ack ⟺ state ∉ {none, resolved}
    ∧ subscriptionGrantsTier(sub, now)
    ∧ effectiveTier(comp, sub.tier, 'resolved')
      === effectiveTier(comp, sub.tier, state)
```

Read as: **ack exactly when the local trial's grant is already redundant.** It
reduces to today's rule for `expired` (so churned subscribers are still never
re-walled), acks on day 1 for a Stripe Pro trial, and correctly refuses for a
Trader trial — with no special case.

## 6. Sequencing

Migrations are manual on both projects (`jmpanzrjxflovdfwcbye`,
`sixixwutvrguqemqzvvw`) and deploys are not, so every step below applies the
migration **before** the merge.

0. **Disarm the local trial latch** (see 5.0). ✅ **Shipped to the working tree
   2026-09-15**, with one correction to the original plan.

   The original step 0 could not ship on its own. Flipping the DEFAULT *is* the
   disarm, so applying it before the Stripe checkout exists (step 6) would leave
   every new signup with **no trial at all**, while 18 static pages still
   promise fourteen days of Pro. The plan's claim that steps 0–3 were "invisible
   to users" was wrong for step 0 specifically. So it is split into two levers:

   - **Now, and reversible:** `LOCAL_TRIAL_DISABLED` in `trial-start.ts`, an
     opt-in-to-disable env switch (the `WELCOME_POPUP_DISABLED` shape, not the
     `TRIAL_WALL_ENABLED` one, so a typo leaves the live trial running). Unset,
     behaviour is byte-identical to before. It short-circuits *before any I/O*
     at the chokepoint, which also answers the per-render marker read that
     5.0 flagged would otherwise hit the entire future user base.
   - **Now, unconditional:** the marker-free fallback is **deleted**. Both bases
     fail closed on an unreachable marker. This was the only path that could
     create a local trial without consulting `trial_eligible`, and PGRST204
     made it reachable on a transient schema-cache blip.
   - **Launch day, with step 6:** apply `0077_trial_eligible_default_off.sql`,
     written and held with a `DO NOT APPLY THIS YET` header. The env switch is
     the lever; the migration makes the disarm durable against a 0075 replay.

   The three entry-point call sites are **kept**. The audit wanted them removed
   because they made the fallback reachable — with the fallback gone, that
   reason is gone, and they are still needed until launch. They inherit the
   switch automatically, since it lives in the latch.

   Tests: 1544 passing, `tsc` clean. The one test that encoded the fallback as
   correct was inverted rather than deleted, and the switch has five of its own,
   including "cannot restart a grandfathered trial even while OFF".
1. Add `trial_end` / `trial_start` to the `subscriptions` mirror and populate
   them in `subscriptionRow()`. Without this the expiry-notice branch cannot be
   rebuilt at all.
2. Re-key the lifecycle-email queries to read BOTH mechanisms, and split the
   copy on `cardOnFile`. ✅ **Shipped 2026-09-15.**

   `lib/trial-window.ts` resolves which trial a user is on. **Stripe wins when
   both run** — a safety ordering, not a recency one, because the Stripe window
   is the one ending in a charge and so the one every line must describe. It
   holds even when the local trial ends later.

   - **Day 1/7/12 sequence** now covers both cohorts. The Stripe cohort cannot
     be expressed as a filter on `profiles` — the qualifying fact is in another
     table — so it is a second read, unioned by id.
   - **Stage 12 is suppressed for card-on-file trials.** Stripe's own
     `trial_will_end` fires on day 11 and owns the pre-charge notice; sending
     both is two emails about one charge a day apart. Still stamped, so the
     ratchet does not re-evaluate nightly.
   - **A bug found while writing it, not in any audit:** a grandfathered user
     who takes the add-a-card invitation holds *both* trials. When the local one
     lapsed a few days later, the expiry branch would have mailed them "You were
     never charged and there's nothing to cancel — the trial never asked for a
     card", days before Stripe charged them. The expiry branch now skips anyone
     with a Stripe trial.
   - **The expiry notice stays local-only, deliberately.** A Stripe trial does
     not expire into Free: it converts (nothing ended) or Stripe cancels it for
     a missing card (a different message). Both are copy about money and belong
     with step 4, not invented here.
   - **Failure direction is chosen.** If the `subscriptions` read fails, both
     branches *skip* rather than fall back to "nobody has a card" — the
     pre-Stripe assumption, which is wrong in the dangerous direction.

   Guarded by `tests/unit/trial-window.test.ts`: the card-on-file copy is
   asserted to contain none of the six unconditional denials, while *keeping*
   the conditional "cancel before then and you will not be charged" — the
   distinction being "a charge is impossible" versus "here is how to prevent
   it". 1580 tests pass.
3. Give `funnel.ts`, `admin-users.ts` and the admin user page a distinct
   `Trialing` bucket. ✅ **Shipped 2026-09-15.**

   - `TierSource` gains `'Trialing'`; a `trialing` subscription still grants the
     tier but no longer reads as `Paid`. Amber badge, deliberately not the green
     `Paid` one — at a glance those must not look like the same thing.
   - Lifecycle gains a `Trialing` row. `Paid` is now `active` **only**, and the
     two are disjoint: a user holding both is Paid, so the table still adds up.
   - `past_due` stays in **neither**, unchanged. It reads as "was paying, now in
     dunning" — but after a failed trial conversion it is also the status of
     someone who has never paid a cent (see 5.1), so putting it in `Paid` would
     re-inflate the exact number this split protects. Revisit once the
     never-paid signal exists.
   - The `HINTS` copy moved in the same commit, per that file's own warning that
     nothing notices when a key stops matching a label.
   - **Migration 0078**, found while doing the above: `admin_search_users` picks
     a user's representative subscription ordering on **tier alone**. Now that
     `sub_status` names the source, a user with two rows in the active set at the
     same tier gets whichever Postgres returns first — so a paying customer can
     read as "Trialing", and the label can change between page loads. Fixed with
     a status tiebreak, mirrored in `admin/users/[id]/page.tsx` so the list and
     detail pages agree. Verified against the live production definition before
     replacing it — `CREATE OR REPLACE` swaps the whole body, which is the 0041
     lesson, and there is a test asserting every filter survived.

   1595 tests pass.
4. Generalise the `trial_will_end` path and its copy. ✅ **Shipped 2026-09-15.**

   This event used to be reachable only from the referral flow — a handful of
   people who had deliberately claimed free months. Once the advertised trial
   runs on Stripe it fires on **day 11 for every signup** and becomes the
   product's principal pre-charge notice: the last thing a customer sees before
   money leaves their account, and the document a chargeback or ACCC complaint
   would be argued from.

   - `TrialEnding` gains **`kind`**, inferred from the trial's own length —
     anything longer than `TRIAL_DAYS` is referral months. Inference is safe
     here precisely because it picks a **noun, never a number**: the amount,
     date, card and cancel route are identical on both branches and come from
     Stripe. Get it wrong and someone reads "free months" instead of "free
     trial". (If a durable answer is wanted, stamp
     `subscription_data.metadata.flow` at checkout and prefer it.)
   - **A real defect in the fallback:** when the amount was missing the email
     read *"the standard Pro monthly price"* — naming the wrong plan and the
     wrong interval for any Trader or annual subscriber, in the one email that
     exists to say what will be taken. Now "the price shown on your billing
     page".
   - Copy no longer says "the card you saved when you claimed the reward" to
     someone who never claimed one, and the no-card branch no longer tells a
     Trader subscriber to keep "Pro".
   - Carries the AUD and GST lines, now that §7 settles them.
   - `NotificationBell`'s `trial_ending` label was "Your free Pro months are
     nearly up" — wrong for two of the three cases that type covers. Now
     neutral.
   - `willChargeAtTrialEnd` is unchanged but documented: Checkout attaches the
     card to the **customer**, not the subscription, so the `customers.retrieve`
     branch is the normal path, not a fallback — one Stripe call per trialling
     user per conversion. Fine at this volume, and the correctness argument
     outranks it; cache on the mirror if it ever needs to be cheaper.

   `tests/unit/trial-ending-notice.test.ts` pins the three things that must hold
   on every branch, for every plan and interval: the **amount**, the **date**,
   the **way out**. 1614 tests pass.
5. Terms / pricing / welcome copy, and the GST decision. ✅ **Shipped 2026-09-15.**

   - **Terms** §8 rewritten (card required, A$0 today, converts at A$50/mo,
     day-11 notice, cancel costs nothing), §9 gains a free-period branch, §10 a
     first-charge branch, §7 qualified. Grandfathering is **self-identifying**
     rather than date-stamped — the switchover date is unknown at drafting and a
     wrong date in a contract is worse than none. §11 deliberately unchanged:
     a trial-specific refund promise is a business decision, still **open**.
   - **Static site**, 18 files. The shared hero note carried "No card required"
     verbatim on 14 pages; five comparison pages had a "Start free — no card"
     button. Leading with the card requirement costs some conversion, and that
     is the right trade — a user who meets a card form after being told none is
     needed is a support ticket and a trust problem.
   - **Two JSON-LD blocks** carried the claim machine-readably and each had a
     visible twin that had to move with it. Those matter more than visible copy:
     eligible for rich results, and they outlive an HTML edit in Google's cache.
     Every `ld+json` block on the touched pages was re-parsed after editing.
   - **Not changed, on purpose:** "the Free plan logs trades with no card
     required" on two `for/` pages. That describes the **Free plan**, which
     genuinely takes no card.

   ⚠ **That exemption creates a hard requirement for step 6.** It holds only
   while a user can decline the trial and reach Free *without* entering a card —
   and Terms §7 now says so in writing. **`/welcome` must keep a way past the
   card form.** If it does not, those two lines become false, Terms §7 becomes
   false, and the Free plan is unreachable without a card.

6. `/welcome` gains the card CTA **and keeps a decline route** (see 5); checkout
   gains the `flow: 'trial'` branch. ✅ **Shipped 2026-09-15.**

   - **`trial_settings.end_behavior.missing_payment_method: 'cancel'`**, set
     explicitly for both trial flows. This is the line that closes the 28-day
     exploit in 5.1: the account default is `create_invoice`, which routes a
     card-less trial into `past_due` and hands it the dunning grace. It is not
     observable from this repo, so it is never relied on.
   - Server-priced like the referral flow — the client cannot choose the plan.
   - **Two pre-existing bugs fixed in passing**, both from reading the raw
     request body instead of the server-priced value: the success URL would have
     carried `undefined` for a server-priced flow, and the annual coupon guard
     could have been slipped by posting `interval: 'annual'`.
   - The Reddit **Purchase** conversion is now gated on `amount_total > 0`.
     Every trial checkout is A$0, so without this each signup reports a
     zero-value purchase — teaching the ad platform to find people who convert
     at nothing, and burying the real purchases.
   - `subscription_data.metadata.flow` is stamped, so `trialEnding()` reads the
     answer rather than inferring it from the trial's length (the length test
     remains as a fallback for older subscriptions).
   - **The decline route exists and is styled as a real button.** Terms §7 and
     two `for/` pages depend on it — see 5.

   **E2E:** all 18 signup helpers clicked `Start my trial`, which now opens
   Stripe and cannot complete in a browser test. They now take the decline
   route — the affordance terms required turns out to be what keeps signup
   testable at all. Their tier assumptions still hold **only because**
   `LOCAL_TRIAL_DISABLED` is unset and 0077 unapplied, so the chokepoint still
   stamps a local trial on first render. On launch day that stops being true and
   `trial.spec.ts` / `welcome-popup.spec.ts` must grant the tier explicitly
   rather than inheriting it. Noted in `tests/e2e/utils/onboard.ts`.

   Verified by `next build` (clean) and 1625 unit tests. **Not** verified in a
   browser: `/welcome` needs an authenticated mid-signup user, and `next dev` on
   Node 22 breaks form submits here.
7. Grandfathering banner for the 7, plus an explicit marker so internal accounts
   are never swept into it.
8. After the last local trial drains (~21 days, per 5.3), delete the local trial
   mechanism.

Steps 0–3 are all invisible to users and can ship today, ahead of any product
decision. That is deliberate: it means the GST and copy questions in §7 do not
block the risky parts from being de-risked.

## 7. Open questions for the owner

1. ~~GST~~ — **settled 2026-09-15**: the entity is **not registered for GST**, so
   no GST is charged and A$30/A$50 are the total payable. All six placeholders
   resolved (`plans.ts`, `TrialPlanPicker`, `BillingActions`, `pricing.html` ×3,
   `terms.html` §7). No repricing needed.

   Terms §7 gained a GST paragraph, which tripped the legal-body hash guard —
   correctly. `LEGAL_VERSION` is now
   `terms=2026-09-15,privacy=2026-08-18,disclaimer=2026-06-24`, the page's "Last
   updated" line moved with it, and a dated changelog entry was added. That was
   audit item 24, and it means consent records written from here on are
   distinguishable from pre-change ones.

   Recorded in `plans.ts`: if the entity ever registers, ACL s48 forbids adding
   10% at checkout for consumers, so A$30 would stay A$30 and net A$27.27. That
   makes registering a **repricing decision**, not a copy change — plus
   location logic, since sales to non-residents are GST-free exports.
2. ~~Trial tier~~ — **settled**: Pro for everyone, then their pick. See decision 2.
3. **The 42 expired-unresolved users** — in scope for the same add-a-card
   campaign, or left alone?
4. **Annual during the trial** — the beta coupon cannot reach a trialling user
   (see 5.2b). Accept the gap, or extend the coupon to portal switches?
5. **The wall** — it becomes a no-op for all new accounts (5.7). Retire it
   deliberately, or re-key it to Stripe?
6. **Mid-trial Trader purchase** — still reachable from two surfaces and still
   produces a day-14 cliff that stops broker sync (5.2). Close it, or keep it
   and warn?

## 8. Consolidated defect list, ranked

Across all four audits. Items 1–3 cost money or make false statements about
money; they gate the ship.

| # | Defect | Where |
|---|---|---|
| 1 | Day-12 email says "**You will not be charged**" two days before we charge; day-14 email says "you were never charged" after we did | `lib/server/email.ts:270, 205` |
| 2 | 28 free days on a declined card — `past_due` grace granted to a trial that never paid, repeatable | `lib/entitlements.ts:87-96` + `api/stripe/webhook/route.ts:198` |
| 3 | Terms §8 asserts no card is taken and nothing converts — both inverted | `terms.html:1147-1150` |
| 4 | Local trial re-armed alongside the Stripe trial, putting users in both cohorts | `0075:71` + `trial-start.ts:179-187` |
| 5 | Referral reward pays out on a signup, skipping the "logged a trade" gate | `api/stripe/webhook/route.ts:79` |
| 6 | `missing_payment_method` unset — defaults to `create_invoice`, which feeds defect 2 | `api/billing/checkout/route.ts:136` |
| 7 | Reddit `Purchase` + `subscribed` fire at A$0 for every signup, poisoning ad optimisation | `api/stripe/webhook/route.ts:151-182` |
| 8 | Day-1/7/12 and expiry emails stop entirely for new users; cron stays green | `api/cron/lifecycle-emails/route.ts:302, 350` |
| 9 | ~50 "no card required" claims across 18 static pages, incl. JSON-LD that outlives the edit | `index.html`, `pricing.html`, `for/*`, `compare/*` |
| 10 | Trialists count as "Paid"; funnel conversion reads ~100% | `lib/server/funnel.ts:203` + `lib/admin-users.ts:19` |
| 11 | Confetti "Welcome to Free" when a card fails | `lib/entitlements.ts:287` |
| 12 | `onTrial = gate.state === 'active' && !sub` becomes permanently false — trialists see no trial copy, no amount, no date | `settings/billing/page.tsx:38` |
| 13 | Mid-trial Trader purchase → day-14 cliff parks broker sync in `error` | `TrialPlanPicker.tsx:37`, `api/cron/crypto-sync/route.ts:31` |
| 14 | Reconcile: unbounded mirror read (1000-row cap), 2000-sub Stripe cap, shares a 60s budget with every lifecycle email | `lib/server/billing-reconcile.ts:70, 43` |
| 15 | `STRIPE_TOS_CONSENT` ships off, so Stripe's consent checkbox does not render on the flow about to carry every signup | `lib/terms-acceptance.ts:85` |
| 16 | Beta annual coupon may be consumed by the A$0 trial-start invoice, so day 14 bills full price after a 76%-off quote | `api/billing/checkout/route.ts:128` |
| 17 | `shouldShowWall` / `TRIAL_WALL_ENABLED` become no-ops for all new accounts | `lib/entitlements.ts:249` |
| 18 | E2E suite stays green while "Start my trial" stops starting anything | `tests/e2e/*` |
