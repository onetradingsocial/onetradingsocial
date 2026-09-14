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

---

## 5. The email templates — the step this runbook was missing

**Authentication → Emails → Confirm signup / Reset password.**

Everything above can be right and the flow still strands people, because the
link inside the mail is what decides whether a session is ever created. This was
missed when confirmation went on in production on 2026-09-10, and cost eleven
accounts — see [pending-2026-09-14.md](pending-2026-09-14.md).

### Why the default link cannot work

`{{ .ConfirmationURL }}` renders as
`…/auth/v1/verify?token=pkce_…&type=signup&redirect_to=…`. `@supabase/ssr`
hardcodes `flowType: 'pkce'`, so GoTrue issues a PKCE token: `/auth/v1/verify`
spends it, stamps `email_confirmed_at`, and redirects to us with `?code=…`.
`exchangeCodeForSession` can only redeem that code in the browser that started
the signup, because the `code_verifier` is in that browser's cookie.

Open the mail on a phone, or in Gmail's in-app browser, and the address is
confirmed and the session is never created. The token is spent, so there is no
second chance — and the same applies to the reset link, which is the page our
own error path sends those users to.

### The link shape to use instead

`{{ .TokenHash }}` → `verifyOtp`, which is browser-independent. Both routes
already prefer it (`lib/auth-recovery.ts`, `lib/server/auth-grant.ts`).

**Confirm signup:**

```html
<h2>Confirm your email address</h2>

<p>Follow the link below to confirm this email address and finish signing up.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=signup">Confirm email address</a></p>
```

**Reset password:**

```html
<h2>Reset your password</h2>

<p>We received a request to reset your password. Follow the link below to choose a new one.</p>
<p><a href="{{ .SiteURL }}/auth/reset?token_hash={{ .TokenHash }}&amp;type=recovery">Reset password</a></p>

<p>If you didn't request this, you can safely ignore this email.</p>
```

Three things that will bite if changed:

- **`&type=` is mandatory.** `parseRecoveryRequest` defaults a missing `type` to
  `recovery`, which is not in `/auth/confirm`'s `expectTypes`, so a new signup
  would be bounced to `/forgot-password?error=denied`.
- **`{{ .SiteURL }}` must be the app origin.** Check
  **Authentication → URL Configuration → Site URL** is `https://app.tradingsocial.io`
  on production (`http://localhost:3000` on dev). If it points anywhere else,
  hardcode the origin instead of using the variable.
- **`&amp;` or `&` both work** — Go escapes the ampersand in an href context
  either way, and the browser sees `&`.

### Verifying it took

Do not test by clicking the link on the machine that signed up. That is the one
path that works whatever the template says, and it is why the 2026-09-11 test
passed while production was stranding people.

Sign up on a desktop, open the mail **on a phone**, and confirm you land signed
in on `/welcome`. Then check the row: `auth.users.last_sign_in_at` must be set,
not just `email_confirmed_at`.

```sql
select email_confirmed_at, last_sign_in_at from auth.users order by created_at desc limit 1;
```

A confirmed row with a null `last_sign_in_at` means the link is still PKCE, or
something consumed it before the human did.

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
