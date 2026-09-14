# Turning on CAPTCHA

The code ships inert. With no `NEXT_PUBLIC_TURNSTILE_SITE_KEY` the widget
renders nothing and submits no token, which is the correct state right up until
the Supabase switch is flipped. What follows is configuration, in an order that
matters.

## Why

From 2026-09-06, every signup was automated. Every account carries a random
16–20 character mixed-case username — `eassHCjHNSBhWfTnaMj`, `WvGLlkoMrzsAfHLC`
— and not one of them completed onboarding. The addresses are other people's,
and they read as a scraped list: `nasa.gov`, `lexingtontn.gov`, `bsu.edu`,
`jtc.edu.au`, `pointloma.edu`, `wcfpd.net`.

The run signs up and then requests a password reset 6–49 seconds later, so each
address receives two unsolicited emails from us; the ones created before
confirmation was switched on also got the whole lifecycle drip.
`jason.holmes@lexingtontn.gov` now hard-bounces and three more addresses are
suppressed in Resend. Full detail in
[pending-2026-09-14.md](pending-2026-09-14.md).

Rate limiting does not answer this. `lib/server/auth-throttle.ts` is a Map in
one serverless instance's memory and says so itself; it stops one client
hammering one address, not a distributed run against a list.

## The order, and why reversing it breaks every login

**Supabase's setting is one switch for the whole project.** Turn it on and
GoTrue demands a token on **signup, sign-in and recovery** — not just signup. If
the switch is on before a deploy carrying the site key is live, every auth
request in the product fails with `captcha protection: request disallowed`,
including logins by existing users.

`NEXT_PUBLIC_` variables are inlined at **build** time, not read at runtime, so
"set the variable" means "set it and then redeploy".

1. **Cloudflare → Turnstile → Add site.** Domain `app.tradingsocial.io`. Widget
   mode: Managed. Keep both keys: the **site key** is public, the **secret key**
   is not.
2. **Vercel → Settings → Environment Variables.** Add
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = the site key, Production.
3. **Redeploy.** Until this deploy is live the site key is not in the bundle.
4. **Verify the widget is actually there** before going further — load
   `/signup`, `/login`, `/forgot-password` and `/check-email` and confirm a
   challenge renders on each. If it does not, stop: enabling step 5 now would
   lock everyone out.
5. **Supabase → Authentication → Attack Protection → Enable CAPTCHA
   protection.** Provider: Turnstile. Paste the **secret** key. Save.
6. **Test a real login and a real password reset**, not only a signup. Those are
   the two paths that break if the widget is missing from a form, and they are
   the two nobody thinks to check.

## Rolling it back

Turn off the Supabase switch. The token the forms send is then ignored, and
nothing else has to change or redeploy. Do that first if anything goes wrong —
removing the Vercel variable without disabling the switch is the broken state,
not the fix.

## What the code does

- `app/src/app/_components/Turnstile.tsx` — explicit-render widget, one script
  tag per document, own hidden input (`cf-turnstile-response`). `resetOn` takes
  the server action's returned state, which is a new object on every result, so
  a refused submit gets a fresh challenge rather than replaying a spent token.
- `app/src/app/actions/auth.ts` — `captchaToken(formData)` reads that field and
  is passed to `signUp`, `signInWithPassword`, `resetPasswordForEmail` and
  `resend`. A captcha failure is mapped to plain copy by `friendlyAuthError`.
- `app/tests/unit/captcha.test.ts` — fails if any of those four callers drops
  the token, if a form stops rendering the widget or renders it outside the
  `<form>`, if the field name drifts between the two ends, or if the CSP loses
  `challenges.cloudflare.com`.

Verified locally against Cloudflare's always-pass test key
(`1x00000000000000000000AA`): the widget renders on every form, issues a token,
and puts it inside the submitted form.

## What this does not fix

The ~29 bot accounts already in `auth.users` stay there until someone removes
them, and every signup count since 2026-09-06 is mostly them — including
whatever `signup_completed` has been reporting.
