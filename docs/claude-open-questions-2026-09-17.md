# Open questions from Claude — 2026-09-17

Things I could not decide or do without you or Nathan. Each item says what I
found, what I did in the meantime, and the single decision needed.

---

## 1. Who sent ~90 emails through Resend on 2026-09-15, 10:37–11:22 UTC?

**Found:** Resend's API log shows a burst of about 90 `POST /emails` from a
`node` user agent in that window: a script, not the app's cron. At 13:38 the
nightly lifecycle cron got `429` on all 12 of its sends, which fits a spent
daily quota (Resend's free plan allows 100 emails a day).

**Consequence:** the cron marked those emails as sent anyway, so **1 trial-expiry
notice and 4 trial-sequence emails were never delivered** and won't be retried.

**Done meanwhile:** PR #49 stops the cron marking emails as sent after a
temporary failure, so this can't lose trial emails again.

**Decision needed:**
- Was the burst intentional (e.g. a manual invite send), and will it happen
  again? If yes, either run it after 13:40 UTC or move Resend to a paid plan.
- Do you want the 5 lost trial emails re-sent? I can find the affected accounts
  and clear their stamps so the next nightly run sends them. That changes
  production data, so I haven't done it. The trial-expiry notice is only
  sent within 7 days of the trial ending, so re-sending it is only possible
  until about 2026-09-22.

## 2. The lifecycle cron did not run at all on 2026-09-14

**Found:** no `cron_runs` row and no send stamps at 13:37 that day, unlike the
timeouts on 09-09 to 09-11, which left stamps. The cause isn't visible from
the database.

**Blocker:** the Vercel connection I have returns 403 for this project's logs
and deployments.

**Decision needed:** grant the Vercel connection access to the
`onetradingsocial-app` project (or check the 09-14 13:37 UTC cron invocation
in the Vercel dashboard yourself).

## 3. Raise the cron's `maxDuration`?

**Found:** the lifecycle route has `maxDuration = 60` and hit it three nights
running. PR #49 works within 60s (45s budget, most time-critical emails first,
leftovers deferred to the next night). Deferral still means digests and nudges
can slip as users grow.

**Decision needed:** which Vercel plan is the project on? If it allows a longer
duration, raising it is a one-line change. I didn't raise it blind, because a
value above the plan's limit fails the deploy.

## 4. MetaApi needs topping up: MT5 auto-sync is down

**Found:** the internal MT5 account (TheTradingSocial) has failed every hourly
deploy since 2026-09-14 with MetaApi's own message: *"To allow trading account
deployment please top up your account."* Last successful sync: 2026-09-14 06:10 UTC.
`mt5-sync.yml` has failed 33 runs in a row.

**Done meanwhile:** PR #52 stops a second, unrelated account (a real user whose
plan lapsed) from also failing those runs. Once it's merged, the workflow's
remaining failures are this top-up only.

**Decision needed:** top up the MetaApi balance, or decide auto-sync stays off
for now. Until then no MT5 trades import for anyone.

## 5. Does an n8n instance outside this repo read the MT5 sync responses?

**Found:** a test said the `/api/mt5-sync/*` response shape was pinned for
"the n8n asserts". No n8n workflow in `automation/n8n` reads those routes; the
GitHub Actions workflow does. PR #52 keeps every existing key (`synced`,
`deployed`, `total`, `skipped`), adds `notEntitled`, and no longer counts
lapsed-plan accounts in `total`.

**Decision needed:** only if an n8n instance outside the repo still calls
these routes. If so, check that it doesn't depend on `total` including lapsed
accounts.

## 6. Should a lapsed Pro user keep getting "sync failed" notices?

**Found:** when a user's plan no longer includes MT5 auto-sync, the hourly
collect run marks their broker connection as errored and sends a `sync_failed`
in-app notification: once when it first fails, then at most once a day while it
stays that way. One real user has been in this state since 2026-09-14. The
analytics already treat it as a skip, not a failure (`broker_sync_skipped`), but
the notice still reads as "your sync is broken".

**Decision needed (product):** keep the daily reminder (a nudge to upgrade), send
a single "auto-sync paused on your plan" notice instead, or send nothing. Small
code change once decided; I didn't guess because it's upgrade messaging.

---

## Status update (2026-09-17, later)

- **1. The ~90 emails:** answered. They came from the e2e suite, run locally with the real Resend key; all bounced. Fixed in #55: only production sends, and reserved test domains are never mailed. The 5 lost trial emails will not be re-sent (their dates have passed).
- **2. Missed run on 09-14:** still unexplained; Vercel logs aren't readable from here. The watchdog (#50) now alerts on any missed night.
- **3. Vercel plan:** Hobby (free). Staying within 60s (#49).
- **4. MetaApi top-up:** with Nathan. Cost report: https://claude.ai/artifact/SWMeLX5YhYwEPymrys1w9K
- **5. n8n:** closed; the sync is driven by GitHub Actions only.
- **6. Lapsed-user notice:** done in #56, with migration 0082 applied to dev and production. One "auto-sync paused" notice per lapse replaces the daily "sync failed".
