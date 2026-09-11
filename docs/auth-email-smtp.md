# Turning on email confirmation

Everything in the application is already built and shipped dark behind
`AUTH_EMAIL_CONFIRMATION`. What follows is configuration only — three dashboard
areas and one environment variable, per project.

**Do dev first.** The confirmation code has never been exercised against a live
toggle.

---

## Why custom SMTP is not optional

Supabase's built-in mailer **refuses to deliver to any address that is not a
member of the project's organization team**; everyone else fails with
*"Email address not authorized."*

With confirmation on, that means a real customer would get an account and no
email — no session, no way in, and no resend that could ever reach them. The
hourly cap is the lesser problem, and it is also the one value you cannot raise
from the dashboard: it is adjustable only once your own SMTP is configured.

This is also the real reason the E2E suite has failed since 2026-08-21. Its test
users are not team members, so those signups were never going to work at any
volume.

---

## 1. Resend: a separate sending key

Create a **new API key** in Resend for Supabase — do not reuse the app's
`RESEND_API_KEY`. Sending-only permission.

Two reasons: Supabase stores it as an SMTP password and the app stores it as a
bearer token, so one rotation should not break both; and if the auth sender is
ever abused you want to revoke it without silencing the weekly digests. Record it
alongside the others in [secret-rotation.md](secret-rotation.md).

### Use a different sender address from the lifecycle mail

The app sends lifecycle email as `TradingSocial <updates@tradingsocial.io>`
(`EMAIL_FROM`, defaulted in `app/src/lib/server/email.ts`). **Auth email should
not share it.**

If enough people mark a weekly digest as spam, that damages the reputation of
`updates@`. Sharing the address means a reputation hit on marketing mail can stop
people confirming their accounts — a marketing problem escalating into a
can't-log-in problem. Suggested: `TradingSocial <accounts@tradingsocial.io>`, on
the same verified domain, so DKIM/SPF (confirmed 2026-08-28) already covers it.

---

## 2. Supabase → Authentication → Emails → SMTP Settings

Enable **Custom SMTP** and enter:

| Field | Value |
|---|---|
| Sender email | `accounts@tradingsocial.io` |
| Sender name | `TradingSocial` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` — literally the word, not an email address |
| Password | the Resend API key from step 1 |

Port 465 is implicit TLS. If the provider or network blocks it, `587` (STARTTLS)
is the fallback; Resend also accepts 25, 2465 and 2587.

Saving this imposes a starting cap of **30 messages per hour**. Raise it on
**Authentication → Rate Limits** once a test send has worked. At ~11 signups a
month the steady-state need is negligible; the headroom is for E2E bursts, which
create users far faster than a human ever will.

---

## 3. Redirect URL allowlist

`signUp` and `resendConfirmation` both set `emailRedirectTo` to
`authRedirectUrl('/auth/confirm')`, which resolves against `NEXT_PUBLIC_SITE_URL`
(defaulting to `https://app.tradingsocial.io`).

Add to **Authentication → URL Configuration → Redirect URLs**:

- production project: `https://app.tradingsocial.io/auth/confirm`
- dev project: `http://localhost:3000/auth/confirm`

An address missing here does not fail loudly — Supabase silently falls back to
the Site URL, so the link lands on the home page, the token goes unconsumed, and
the user sees no error and no confirmation.

---

## 4. The toggle and the flag, together

- **Authentication → Sign In / Providers → Email → Confirm email:** on
- **`AUTH_EMAIL_CONFIRMATION=on`** in that environment (Vercel for production)

**In production, set the variable and redeploy first, then flip the toggle the
moment the deploy is live.** A Vercel environment change only takes effect on the
next deployment, so "together" really means "variable first". That order is safe:
while the toggle is still off, signup still returns a session and the flag is
never consulted. The reverse order sends new users a confirmation email but
drops them on the wrong page, because the code has not been told to expect it.

These must end up matching, and the application says so itself. With the flag off
but the toggle on, `signUp` logs
`no session with AUTH_EMAIL_CONFIRMATION off — check the dashboard setting`
and routes the user somewhere safe instead of `/welcome`. With the flag on but
the toggle off, the neutral "check your inbox" response becomes a lie, because no
email is sent.

---

## What changes the moment it is on

- Signup no longer returns a session. Users land on `/check-email`, which reads
  the pending address from an httpOnly cookie and offers a resend.
- Signup stops leaking whether an address is already registered — one neutral
  response either way, with the email telling the truth.
- **The 14-day Pro trial now starts at confirmation, not signup** (`0074`), so
  nobody burns trial days sitting in their inbox.
- `signup_completed` carries `confirmed: false` for these, so the funnel reads
  the change as a new step rather than a cliff.

## Verifying it took

```
curl -s -H "apikey: <project publishable key>" \
  https://<project-ref>.supabase.co/auth/v1/settings
```

`"mailer_autoconfirm": false` means confirmation is required. It is `false` on
both projects today — production has simply never had the toggle on, so the flow
has never run there either.

Then sign up with a real address that is **not** on the Supabase team, and
confirm the email arrives. That is the check the built-in mailer could never
pass.
