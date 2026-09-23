# Acquisition, 2026-09-14

Production (`jmpanzrjxflovdfwcbye`), external accounts only, after the 31 bot
accounts were marked internal. Two corrections come out of this: the July
"traffic peak" was not audience, and acquisition is not the binding constraint.

## The apparent traffic collapse is mostly measurement

Raw page views say traffic fell off a cliff after mid-July. Split by who
generated them, it says something else:

| week of | views | logged out | by internal user | **by real user** |
|---|---|---|---|---|
| 07-13 | 593 | 213 | 380 | **0** |
| 07-20 | 555 | 119 | 342 | 94 |
| 07-27 | 328 | 69 | 220 | 39 |
| 08-03 | 43 | 22 | 21 | 0 |
| 08-10 | 170 | 87 | 16 | 67 |
| 08-17 | 77 | 64 | 8 | 5 |
| 08-24 | 55 | 20 | 12 | 23 |
| 08-31 | 179 | 22 | 98 | 59 |
| 09-07 | 115 | 50 | 45 | 20 |

The "peak" week of 07-13 — 168 distinct visitors on `/signup` — produced
**zero** page views from a real account and two signups. It was the E2E suite
and the seeding run: 253 `@tradingsocial.io` and 147 `.test` accounts were
created between 06-16 and 07-31, and their logged-out page loads are
indistinguishable from prospects in this table because `user_id` is null until
they authenticate.

`/select-plan` tells the same story: 85 visitors, every one between 07-16 and
07-26, none since.

What did fall is logged-out traffic, from ~213 views/week to ~50. Some of that
is E2E too, so treat it as "roughly four times fewer prospects reach the app
than in mid-July", not as a 95% collapse.

## The real signup history

34 external accounts between 07-13 and 09-06. Three of those are not people —
`rj.newtrader.test@gmail.com`, and two with the bot run's random-username
signature (`LFwWZZFVUjfmADJSWAX` on 07-15, `RrTxCLGiBVzAmJqyXOZD` on 07-30),
which means **the bot run predates 2026-09-06** and the marking sweep, which
started at 09-06, missed at least those two.

That leaves ~31 genuine signups in eight weeks, and they are not evenly spread:

- **07-20 → 07-30: 21 signups in 11 days.** A burst.
- **07-31 → 08-11: zero.**
- **08-12 → 09-04: 11, in ones and twos.**
- **09-05 → today: one** (`romanowski.jakub@gmail.com`, via Google).

So there is no decay curve to explain. There was a push in late July that
produced three weeks of signups and was never repeated, and a trickle either
side of it. The question is not "why did acquisition drop" but "what was that
push, and why did nothing follow it".

## The bigger hole is underneath acquisition

Of those ~31 genuine signups:

- **26 have never logged a single trade.** Five have 1-2. One
  (`pearz.kewalin@gmail.com`, 09-02) has 21.
- **All but two never came back after the day they signed up.**
  `last_sign_in_at` equals the signup date for the rest. The exceptions are
  `giagvo@gmail.com` (returned 09-09) and `phillwalter3969@gmail.com` (09-03).
- Onboarding is not the leak: most of them completed it. They finish setting up
  and then never return.

Doubling acquisition against that shape produces twice as many people who never
come back. The constraint is day-2, not day-0.

## Two data-quality notes

- `analytics_events.is_internal` is stamped at write time, so the 135
  `signup_completed` rows still counted as external include the bot run's. The
  flag fixes counts from here, not history — date-filter anything historical.
- Usernames are stored untrimmed: `" alvina"`, `"Phillip "`, `" matthewjones98"`.
  Cosmetic, but `validateUsername` should trim.
- Two accounts one day apart, `in.t.re.p.id.nmw@gmail.com` and
  `i.ntr.epid.nmw@gmail.com`, are the same Gmail mailbox with dots moved. Worth
  knowing before counting them as two people.

## What is not visible from here

This table only sees `app.tradingsocial.io`. The marketing site is a separate
codebase, so anyone who read the marketing site and never clicked through is
absent entirely — the top of the funnel is unmeasured. `@vercel/analytics` is
not installed (the app requests `/_vercel/insights/script.js` and gets a 404),
and two Vercel analytics branches are still unmerged. Until something measures
the marketing site, "where did the late-July push come from" cannot be answered
from data, only from memory.
