# Secret rotation runbook

Every secret the app uses, where it lives, how to rotate it, and what breaks
while you do. Rotate on a schedule **and** immediately after any suspected
exposure (a key pasted into a chat, a laptop lost, a contributor leaving).

## Inventory

| Secret | Where it lives | Blast radius if leaked | Rotate |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (app), `app/.env.local`, GitHub Actions | **Total** — bypasses all RLS, full read/write on every table | Every 90 days |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel, `.env.local`, shipped to browsers | Low — RLS still applies. Public by design | Only on Supabase advice |
| `STRIPE_SECRET_KEY` | Vercel (app) | **High** — can charge/refund customers | Every 90 days |
| `STRIPE_WEBHOOK_SECRET` | Vercel (app) | Medium — forged webhook events | On endpoint change |
| `CRON_SECRET` | Vercel (app) | Low/medium — can trigger cron routes | Every 180 days |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Vercel, `.env.local`, GitHub Actions | High — read/write on the media bucket | Every 90 days |
| `METAAPI_TOKEN` | Vercel (app) | High — access to connected broker accounts | Every 90 days |
| `TWELVEDATA_API_KEY` | Vercel (app) | Low — quota theft only | Every 180 days |
| `RESEND_API_KEY` | Vercel (app), when configured | Medium — can send mail as your domain | Every 90 days |
| `ANTHROPIC_API_KEY` | local only (seed script) | Medium — quota theft | Every 180 days |

## Order of operations (zero-downtime)

Supabase, Stripe and R2 all support two live keys at once. Always:

1. **Create** the new key in the provider console — do not delete the old one.
2. **Update** every store: Vercel env vars (app + marketing), GitHub Actions
   secrets, your local `app/.env.local`.
3. **Redeploy** the app so the new value is picked up (env changes need a new build).
4. **Verify** — see the checks below.
5. **Revoke** the old key only once verification passes.

Skipping step 1→5 ordering causes an outage. Revoking first is the classic mistake.

## Per-secret notes

**`SUPABASE_SERVICE_ROLE_KEY`** — Supabase dashboard → Settings → API → roll the
service role key. This breaks every server route until redeployed (analytics,
admin, crons, referrals, MT5 sync). Do it during a quiet window.

**Stripe keys** — dashboard → Developers → API keys → "Roll key", choose an
expiry for the old one (e.g. 24h) so you get an overlap window. Webhook secret
is separate: Developers → Webhooks → your endpoint → roll signing secret.

**`CRON_SECRET`** — any long random string (`openssl rand -hex 32`). Vercel sends
it as `Authorization: Bearer <secret>` automatically. `authorizedCron()` fails
closed, so a mismatch silently stops crons rather than erroring loudly — verify
explicitly after rotating.

**R2** — Cloudflare dashboard → R2 → Manage API tokens. Create the new token
first; existing signed URLs already issued stay valid until they expire.

**MetaApi** — rotating invalidates the provisioning session; connected broker
accounts keep syncing, but re-verify one account afterwards.

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

Then in the app: load `/admin` (service role), upload a chart image (R2), and
open `/settings/billing` (Stripe). Check `/admin/audit` afterwards — rotation
work often accompanies other admin changes and they should all be recorded.

## If a secret is exposed

1. Revoke **immediately** — accept the downtime, it is cheaper than the breach.
2. Rotate as above.
3. If `SUPABASE_SERVICE_ROLE_KEY` leaked: assume full data exposure. Review
   `admin_audit` and `trade_audits` for unexpected activity, and Supabase logs
   for unfamiliar IPs.
4. If Stripe leaked: check for unexpected charges/refunds in the dashboard.
5. Record what happened and when in this file's history (git log).

## Known gap

Secrets currently live in plaintext in `app/.env.local` on the dev machine and
in Vercel env vars. There is no secret manager (Vault, Doppler, 1Password
Secrets Automation). For a team of this size that is a reasonable trade-off, but
it means **laptop compromise equals full production compromise** — which is the
main argument for keeping the 90-day cadence above.
