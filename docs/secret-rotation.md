# Secret rotation runbook

Every secret the app uses, where it lives, how to rotate it, and what breaks
while you do. Rotate on a schedule **and** immediately after any suspected
exposure (a key pasted into a chat, a laptop lost, a contributor leaving).

> **Rewritten by WS8** (audit item 10, finding 7). The previous version listed
> ten secrets and was wrong in three directions at once: it omitted six that the
> app genuinely uses — including `EXCHANGE_KEY_SECRET`, the master key
> protecting every user's exchange credentials — it listed two that do not exist
> (Cloudflare R2 and Anthropic), and its verification step sent you to upload a
> chart to R2, which has been Supabase Storage since commit `e70c396`. This is
> the document you reach for during an incident; under pressure, a runbook that
> omits the important key and sends you chasing a token that was never issued
> costs the minutes that matter most.

## Standing facts, verified

- **Nothing has ever leaked through git.** The only env files in the history on
  any branch are `app/.env.example` and `automation/n8n/.env.example`. That
  matters, because `github.com/onetradingsocial/onetradingsocial` is **public**.
  Nothing below is being rotated because of a proven exposure.
- **Treat any future accidental commit as permanently compromised.** Forks and
  GitHub's cached views survive a force-push. Rotate; do not rewrite history and
  hope.
- **`app/.env.local` on the dev machine is a DEV profile** — it points at the
  dev Supabase project (`sixix…`, not prod `jmpanzrjxflovdfwcbye`) and holds an
  `sk_test_` Stripe key. See "Known gap" for the one exception.

## Inventory

Ordered by what a rotation would cost you and what it would buy, not
alphabetically. `n/a` under Rotate means it is not a credential.

| # | Secret | Where it lives | Blast radius if leaked | Rotate |
|---|---|---|---|---|
| 1 | **`EXCHANGE_KEY_SECRET`** | Vercel (app), `app/.env.local` | **Critical and currently irreversible.** AES-256-GCM master key for every user's exchange API key/secret. With a database dump it converts inert ciphertext into live exchange credentials | **Cannot be rotated safely today — see below.** Fix the design first |
| 2 | `SUPABASE_SERVICE_ROLE_KEY` | Vercel (app), `app/.env.local` (dev project's key), GitHub Actions | **Total** — bypasses all RLS, full read/write on every table. Used by 12+ routes | Every 90 days |
| 3 | `STRIPE_SECRET_KEY` | Vercel (app) — live key. `.env.local` holds `sk_test_` only | **High** — can charge and refund customers | Every 90 days |
| 4 | **n8n credential set** — `N8N_ENCRYPTION_KEY`, `IG_ACCESS_TOKEN`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN`, `TELEGRAM_*` | `automation/n8n/.env` and `instagram-token.json`, both untracked, dev machine only | Medium — post as the brand on Instagram/TikTok/Telegram. `N8N_ENCRYPTION_KEY` decrypts n8n's own credential store | On laptop compromise or contributor offboarding |
| 5 | `METAAPI_TOKEN` | Vercel (app) | High — access to connected broker accounts | Every 90 days |
| 6 | `RESEND_API_KEY` | Vercel (app), when configured | Medium — send mail as your domain, i.e. phish your own users | Every 90 days |
| 7 | `STRIPE_WEBHOOK_SECRET` | Vercel (app) | Medium — forged webhook events could grant subscriptions. Well defended today (signature verified on the raw body before any DB touch) | On endpoint change |
| 8 | `REDDIT_CONVERSIONS_TOKEN` | Vercel (app) | Low/medium — write false conversion events into the Reddit ad account, skewing spend | Every 180 days |
| 9 | `CRON_SECRET` | Vercel (app) | Low/medium — trigger crypto sync, lifecycle emails (user-visible mail) or error alerts | Every 180 days |
| 10 | `TWELVEDATA_API_KEY` | Vercel (app), `app/.env.local` | Low — quota theft only (800 credits/day). Note rotation does **not** stop quota burn by an authenticated user; that is bounded in `lib/server/market-quota.ts` | Every 180 days |
| 11 | `ALERT_WEBHOOK_URL` | Vercel (app) | Low — anyone holding it can post into the team channel. It **is** a credential even though it looks like a URL | On channel change, or if it appears in a screenshot |
| 12 | `DELETION_HASH_SALT` | Vercel (app) | Low — without it the moderation-report pseudonyms become a lookup table of every address ever reported | **NEVER.** Rotating orphans every hash already stored |
| 13 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel, `.env.local`, shipped to every browser | Low — publishable by design; RLS is the control | Only on Supabase advice |
| 14 | `ADMIN_EMAILS` | Vercel, `app/.env.local` | Low — not a credential. Enumerates admin accounts as phishing targets | n/a — change when admin staffing changes |
| 15 | `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_REDDIT_PIXEL_ID` | Vercel, browser bundle | None — pixel ids are public by nature | n/a |
| 16 | `VERCEL_OIDC_TOKEN` | `app/.env.local` only | Very low — short-lived, auto-issued by `vercel env pull`, self-expiring | n/a — regenerates itself |

**Deleted from this inventory, deliberately.** `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` —
all five are present in `app/.env.local` as **empty strings** with zero call
sites anywhere in `app/src`. There is no Cloudflare credential to rotate; delete
the five dead lines from `.env.local`. `ANTHROPIC_API_KEY` was likewise listed
here and exists nowhere — a phantom entry.

## `EXCHANGE_KEY_SECRET` — read this before touching it

`lib/server/secrets.ts:14-22` reads exactly one environment variable:

```ts
const raw = process.env.EXCHANGE_KEY_SECRET
```

There is no second key and no key selection on the `v1` envelope prefix, even
though the prefix exists. So **rotating this secret makes every
`api_key_enc` / `api_secret_enc` row permanently undecryptable.** Crypto sync
fails for every Pro user who has connected an exchange, and there is no recovery
path short of asking each of them to re-enter their Binance credentials.

This is the one entry in this document where following the standing rule
("rotate immediately after any suspected exposure") destroys data. A key that
cannot be rotated is a key that will not be rotated, so the fix is engineering
work, not a procedure:

1. Change `masterKey()` to read a key **set**: `EXCHANGE_KEY_SECRET` (current,
   used to encrypt) plus optional `EXCHANGE_KEY_SECRET_PREVIOUS` (decrypt-only).
2. Select the key on the envelope's version prefix, and write new ciphertext
   under a bumped prefix (`v2`).
3. Re-encrypt existing rows lazily on next successful decrypt, or in one pass.
4. Only then does the standard order of operations below apply to it.

Until that lands: **do not rotate this value.** If it is ever exposed, the
correct emergency action is to revoke the *exchange-side* API keys (which users
can do at Binance, and which the account-deletion flow already tells them to
do) rather than to rotate this key.

**Also confirm, once:** whether the value in `app/.env.local` is the same as the
production value. Vercel → project → Settings → Environment Variables → reveal
`EXCHANGE_KEY_SECRET` for Production and compare the last 4 characters against
the local one. If they match, generate a distinct value for local development —
otherwise laptop compromise plus a database dump exposes real user exchange
credentials, and the "dev profile" reassurance above does not hold for this one
variable.

## Order of operations (zero-downtime)

Supabase, Stripe, Resend and MetaApi all support two live keys at once. Always:

1. **Create** the new key in the provider console — do not delete the old one.
2. **Update** every store: Vercel env vars (app + marketing), GitHub Actions
   secrets, your local `app/.env.local`.
3. **Redeploy** the app so the new value is picked up (env changes need a new
   build).
4. **Verify** — see the checks below.
5. **Revoke** the old key only once verification passes.

Skipping the 1→5 ordering causes an outage. Revoking first is the classic
mistake.

## Per-secret notes

**`SUPABASE_SERVICE_ROLE_KEY`** — Supabase dashboard → Settings → API → roll the
service role key. This breaks every server route until redeployed (analytics,
admin, crons, referrals, MT5 sync, both storage upload routes and the
`/api/private-image` read gateway). Do it during a quiet window.

**Stripe keys** — dashboard → Developers → API keys → "Roll key", choose an
expiry for the old one (e.g. 24 h) so you get an overlap window. The webhook
secret is separate: Developers → Webhooks → your endpoint → roll signing secret.
A stale webhook secret is silent from the app's side — the endpoint returns 400
and subscriptions simply stop provisioning — so check recent deliveries in the
Stripe dashboard after rotating, not just the app.

**`RESEND_API_KEY`** — Resend dashboard → API Keys → create new → update Vercel →
redeploy → revoke old. Failure is **silent**: `sendEmail()` returns
`{ sent: false }` and callers fall back to an in-app notification, so nothing
errors and the mail just stops. Verify by triggering one lifecycle email.

**`METAAPI_TOKEN`** — app.metaapi.cloud → API tokens. Rotating invalidates the
provisioning session; connected broker accounts keep syncing, but re-verify one
account afterwards.

**`REDDIT_CONVERSIONS_TOKEN`** — Reddit Events Manager → Conversions API →
regenerate the non-expiring token. The feature no-ops when unset, so failure is
silent here too.

**`CRON_SECRET`** — any long random string (`openssl rand -hex 32`). Vercel sends
it as `Authorization: Bearer <secret>` automatically. `authorizedCron()` fails
closed, so a mismatch silently stops crons rather than erroring loudly — run the
verification curls below immediately after rotating.

**`ALERT_WEBHOOK_URL`** — Discord/Slack → the channel → Integrations → Webhooks →
delete and recreate. There is no overlap window; the old URL dies the moment you
delete it, which is fine because losing one day of alert summaries is harmless.

**n8n credential set** — `automation/n8n/.env` and `instagram-token.json`, both
gitignored and neither ever committed. The Instagram long-lived token is
refreshed by `automation/n8n/set-instagram-token.mjs`; the TikTok refresh token
comes from the TikTok developer console. **Changing `N8N_ENCRYPTION_KEY`
invalidates every credential n8n has stored**, so treat it like
`EXCHANGE_KEY_SECRET`: only with a plan to re-enter them all.

**`DELETION_HASH_SALT`** — do not rotate. Every `trade_reports.reported_user_hash`
already written was computed with the current value; a new salt orphans all of
them and the moderation history stops linking to anything. If it is ever
exposed, the correct response is to accept it and note that pre-exposure hashes
are now brute-forceable against a known address list — not to rotate.

## Verification checklist

After any rotation, confirm:

```bash
# app + database reachable
curl -s -o /dev/null -w "%{http_code}\n" https://app.tradingsocial.io/api/health   # expect 200

# cron auth works (expect 200 with the secret, 401 without)
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $CRON_SECRET" \
  https://app.tradingsocial.io/api/cron/error-alert
curl -s -o /dev/null -w "%{http_code}\n" https://app.tradingsocial.io/api/cron/error-alert
```

Then in the app:

- load `/admin` (service role);
- upload a trade chart and confirm it renders — that exercises **Supabase
  Storage** and the `/api/private-image` gateway, *not* R2, which does not exist;
- open `/settings/billing` (Stripe);
- if `RESEND_API_KEY` was touched, trigger one lifecycle email and confirm
  delivery rather than trusting the absence of an error.

Check `/admin/audit` afterwards — rotation work often accompanies other admin
changes and they should all be recorded.

## If a secret is exposed

1. Revoke **immediately** — accept the downtime, it is cheaper than the breach.
   The one exception is `EXCHANGE_KEY_SECRET`; see its section above.
2. Rotate as above.
3. If `SUPABASE_SERVICE_ROLE_KEY` leaked: assume full data exposure. Review
   `admin_audit` and `trade_audits` for unexpected activity, and Supabase logs
   for unfamiliar IPs.
4. If Stripe leaked: check for unexpected charges/refunds in the dashboard.
5. If it was committed to git: it is permanently compromised regardless of
   whether the commit is removed. Rotate.
6. Record what happened and when in this file's history (git log).

## Known gap

Secrets live in plaintext in `app/.env.local` on the dev machine and in Vercel
env vars. There is no secret manager (Vault, Doppler, 1Password Secrets
Automation). For a team of this size that is a reasonable trade-off.

The previous version of this document warned that "laptop compromise equals full
production compromise". **That is overstated and has been corrected**:
`app/.env.local` points at the dev Supabase project and carries an `sk_test_`
Stripe key, so a laptop compromise does not hand over production billing or
production data. The two real exposures on that machine are the n8n credential
set (item 4 above) and — pending the check described in its section —
`EXCHANGE_KEY_SECRET`.
