# Reddit Conversions API (server-side events) — Design

**Date:** 2026-07-09
**Status:** Approved (pending spec review)

## Goal

Add server-to-server conversion events to complement the already-live browser
pixel. Server-side events survive ad blockers and tracking protection, so
conversions are attributed even when the browser beacon is blocked. Reddit
deduplicates browser + server events that share a `conversion_id`.

Pixel id: `a2_jbawbd7fkiwo`.
Endpoint: `POST https://ads-api.reddit.com/api/v3/pixels/a2_jbawbd7fkiwo/conversion_events`.

## Scope

Two events:

1. **SignUp** — dual-fire (browser pixel + CAPI), deduped by a shared
   `conversion_id`. The account-creation signal.
2. **Purchase** — server-only, fired from the Stripe webhook when a user
   upgrades to a paid plan. The highest-value signal for ad optimization. No
   browser equivalent, so no dedup needed.

Out of scope: PageVisit stays browser-only (marketing + auth funnel). No other
events.

## Authentication

Reddit's **Conversion Access Token** is a dedicated, **non-expiring** credential
(Events Manager → Conversions API → Generate Access Token). This is NOT the
OAuth2 developer token — no hourly refresh flow is required.

- Stored as a single server-only env var: `REDDIT_CONVERSIONS_TOKEN`.
- **Never** prefixed `NEXT_PUBLIC_` — it must not reach the client bundle.
- Sent as `Authorization: Bearer <token>`.
- Documented (empty) in `app/.env.example`; real value in `app/.env.local`
  (local) and Vercel env (Production/Preview).
- If the env var is unset, the sender is a no-op (feature ships dark, like the
  MetaApi pattern) — never an error.

## Components

### 1. Sender module — `app/src/lib/server/reddit-capi.ts` (server-only)

Single exported function:

```ts
type RedditEvent = 'SignUp' | 'Purchase'

interface ConversionInput {
  eventType: RedditEvent
  conversionId: string          // dedup / idempotency key
  email?: string | null         // raw; hashed here
  externalId?: string           // raw user id; hashed here
  ip?: string | null            // sent raw
  userAgent?: string | null     // sent raw
  clickId?: string | null       // rdt_cid cookie if available
  actionSource?: string         // default 'website'
}

export async function sendRedditConversion(input: ConversionInput): Promise<void>
```

Responsibilities:
- Bail early (no-op) if `REDDIT_CONVERSIONS_TOKEN` is unset.
- SHA-256 hash `email` (trimmed + lowercased) and `externalId` (Node `crypto`,
  hex output). IP and user-agent sent raw (Reddit does not hash those).
- Build the v3 payload and POST with the Bearer header.
- **Never throw.** Wrap in try/catch; log failures (status + body) via the
  existing logging convention. A CAPI failure must never break signup or
  checkout.
- Short fetch timeout (e.g. 3s via AbortController) so a slow Reddit endpoint
  can't hang a webhook.

**Payload shape** (base from Reddit's template; exact v3 field names —
`event_type` vs `type`, `user` sub-fields, `event_metadata.conversion_id` —
VERIFIED against Reddit's live API docs at implementation time before first
POST):

```jsonc
{
  "data": {
    "events": [{
      "event_at": 1730000000000,               // ms epoch, <7 days old
      "action_source": "website",
      "event_type": { "tracking_type": "SignUp" },
      "click_id": "<rdt_cid or omit>",
      "user": {
        "email": "<sha256 hex>",
        "external_id": "<sha256 hex>",
        "ip_address": "<raw>",
        "user_agent": "<raw>"
      },
      "event_metadata": { "conversion_id": "<shared id>" }
    }]
  }
}
```

### 2. SignUp — dual-fire with dedup

- `saveOnboarding` (`app/src/app/actions/profile.ts`): after the profile update
  succeeds, generate `conversionId = crypto.randomUUID()`.
- Schedule the CAPI send with Next 15 `after()` (from `next/server`) so the POST
  runs after the response — signup latency unaffected. Pass `email`,
  `externalId = user.id`, IP + UA from `headers()`, and `clickId` from the
  `rdt_cid` cookie if present.
- Redirect to `/?signup=1&cid=<conversionId>`.
- `RedditPixel` gains a `conversionId?: string` prop. On the home page, read
  `cid` from the query (already handled client-side) and pass it so the browser
  fires `rdt('track', 'SignUp', { conversionId })`. Strip both `signup` and
  `cid` params after firing (existing replaceState logic extended).
- Reddit dedupes the two on the shared `conversion_id`.

### 3. Purchase — server-only

- Stripe webhook (`app/src/app/api/stripe/webhook/route.ts`),
  `checkout.session.completed` branch with a subscription: after the existing
  subscription upsert, call `sendRedditConversion`.
- `conversionId = session.id` (Stripe checkout session id) — stable, so webhook
  retries are idempotent on Reddit's side.
- Match keys: email from the Stripe customer / session, `externalId = user_id`
  (already resolved in the handler). IP/UA are not available in a webhook — that
  is fine; hashed email + external_id carry attribution.
- `await` directly (webhooks are not user-facing latency).

## Data flow

```
Email/Google signup → saveOnboarding
  ├─ after(): sendRedditConversion(SignUp, cid, email, userId, ip, ua)  → Reddit CAPI
  └─ redirect /?signup=1&cid=<cid> → RedditPixel → rdt('track',SignUp,{conversionId:cid}) → Reddit pixel
       (Reddit dedupes the two on cid)

Pro upgrade → Stripe checkout.session.completed webhook
  └─ sendRedditConversion(Purchase, session.id, email, userId) → Reddit CAPI
```

## Error handling

- Sender never throws; failures logged, swallowed.
- Missing token → silent no-op.
- Fetch timeout guards against a hanging webhook/action.
- Purchase idempotency via stable `conversion_id`; SignUp via `after()` best-effort.

## Config / env

Add to `app/.env.example`:
```
# Reddit Conversions API — non-expiring token from Events Manager → Conversions API.
# Server-only. Feature no-ops when empty.
REDDIT_CONVERSIONS_TOKEN=
```
Real value: `app/.env.local` (local) + Vercel env (Production, optional Preview).

## Testing / verification

- Unit: hashing (known email → known SHA-256), no-op when token unset, payload
  shape.
- Local: set token in `.env.local`, complete a signup, confirm a CAPI POST is
  attempted (log line / network) and the browser SignUp carries the same `cid`.
- Reddit-side: Events Manager shows SignUp/Purchase with a "server" source and
  dedup working (browser+server counted once).

## User responsibilities (Reddit-side, cannot be done from the codebase)

1. Register **SignUp** and **Purchase** as events in the pixel (Events Manager).
2. Generate the **Conversion Access Token** and paste it into Vercel env +
   `.env.local`. Claude never handles the token value.

## Open items to verify at implementation time

- Exact v3 payload field names (`event_type`/`type`, `user` fields,
  `conversion_id` location) against Reddit's current API reference.
- Browser `rdt('track', event, { conversionId })` option name (`conversionId`
  vs `conversion_id`) against Reddit pixel docs — the beacon showed
  `m.conversionId=`.
