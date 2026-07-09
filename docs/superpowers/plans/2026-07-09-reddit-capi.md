# Reddit Conversions API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send server-side SignUp (deduped with the browser pixel) and Purchase conversions to Reddit's Conversions API.

**Architecture:** A pure, unit-tested payload/hash module (`lib/reddit-capi.ts`) plus a thin server-only network sender (`lib/server/reddit-capi.ts`). SignUp fires from `saveOnboarding` via `after()` and is deduped against the browser pixel by a shared `conversion_id` threaded through `/?signup=1&cid=...`. Purchase fires server-only from the Stripe webhook.

**Tech Stack:** Next.js 15.5 App Router, TypeScript, Node `crypto`, Vitest (`tests/unit/**/*.test.ts`), Stripe SDK.

## Global Constraints

- Token env var: `REDDIT_CONVERSIONS_TOKEN` — server-only, **never** `NEXT_PUBLIC_`. When unset, the sender is a silent no-op (feature ships dark).
- Pixel id: `a2_jbawbd7fkiwo` (via `process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID` with that literal fallback).
- Endpoint: `POST https://ads-api.reddit.com/api/v3/pixels/<pixelId>/conversion_events`, header `Authorization: Bearer <token>`.
- The sender must **never throw** — a CAPI failure cannot break signup or checkout.
- Payload field names (confirmed): `data.events[].type.tracking_type`, base-level `click_id`, `event_metadata.conversion_id`, `user.{email,external_id,ip_address,user_agent}`. `email`/`external_id` SHA-256 hex hashed; ip/ua raw.
- Follow the existing pure-lib + thin-caller pattern (cf. `lib/billing-webhook.ts`).

---

### Task 1: Pure CAPI payload + hashing module

**Files:**
- Create: `app/src/lib/reddit-capi.ts`
- Test: `app/tests/unit/reddit-capi.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `hashSha256(value: string): string`
  - `normalizeEmail(email: string): string`
  - `type RedditEventType = 'SignUp' | 'Purchase'`
  - `interface ConversionInput { eventType: RedditEventType; conversionId: string; email?: string | null; externalId?: string | null; ip?: string | null; userAgent?: string | null; clickId?: string | null; actionSource?: string; eventAt?: number; testMode?: boolean; value?: number; currency?: string; itemCount?: number }`
  - `buildConversionBody(input: ConversionInput): { data: { test_mode: boolean; events: unknown[] } }`

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/unit/reddit-capi.test.ts
import { describe, it, expect } from 'vitest'
import { hashSha256, normalizeEmail, buildConversionBody } from '@/lib/reddit-capi'

describe('hashSha256', () => {
  it('produces the known SHA-256 hex for "abc"', () => {
    expect(hashSha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Test@Example.COM ')).toBe('test@example.com')
  })
})

describe('buildConversionBody', () => {
  it('builds a SignUp event with hashed email + external_id and a conversion_id', () => {
    const body = buildConversionBody({
      eventType: 'SignUp',
      conversionId: 'cid-123',
      email: 'Test@Example.com',
      externalId: 'user-abc',
      eventAt: 1730000000000,
    })
    const ev = body.data.events[0] as Record<string, any>
    expect(body.data.test_mode).toBe(false)
    expect(ev.type).toEqual({ tracking_type: 'SignUp' })
    expect(ev.action_source).toBe('website')
    expect(ev.event_at).toBe(1730000000000)
    expect(ev.user.email).toBe(hashSha256('test@example.com'))
    expect(ev.user.external_id).toBe(hashSha256('user-abc'))
    expect(ev.event_metadata.conversion_id).toBe('cid-123')
    expect('click_id' in ev).toBe(false)
  })

  it('includes click_id only when provided', () => {
    const body = buildConversionBody({ eventType: 'SignUp', conversionId: 'c', clickId: 'clk_1' })
    expect((body.data.events[0] as any).click_id).toBe('clk_1')
  })

  it('maps Purchase value/currency into event_metadata', () => {
    const body = buildConversionBody({
      eventType: 'Purchase', conversionId: 'sess_1', value: 12.5, currency: 'USD', itemCount: 1,
    })
    const meta = (body.data.events[0] as any).event_metadata
    expect(meta.value_decimal).toBe(12.5)
    expect(meta.currency).toBe('USD')
    expect(meta.item_count).toBe(1)
  })

  it('respects testMode', () => {
    expect(buildConversionBody({ eventType: 'SignUp', conversionId: 'c', testMode: true }).data.test_mode).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/reddit-capi.test.ts`
Expected: FAIL — cannot resolve `@/lib/reddit-capi`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/lib/reddit-capi.ts
import { createHash } from 'crypto'

export type RedditEventType = 'SignUp' | 'Purchase'

export function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export interface ConversionInput {
  eventType: RedditEventType
  conversionId: string
  email?: string | null
  externalId?: string | null
  ip?: string | null
  userAgent?: string | null
  clickId?: string | null
  actionSource?: string
  eventAt?: number
  testMode?: boolean
  value?: number
  currency?: string
  itemCount?: number
}

export function buildConversionBody(input: ConversionInput) {
  const user: Record<string, unknown> = {}
  if (input.email) user.email = hashSha256(normalizeEmail(input.email))
  if (input.externalId) user.external_id = hashSha256(input.externalId)
  if (input.ip) user.ip_address = input.ip
  if (input.userAgent) user.user_agent = input.userAgent

  const eventMetadata: Record<string, unknown> = { conversion_id: input.conversionId }
  if (input.value != null) eventMetadata.value_decimal = input.value
  if (input.currency) eventMetadata.currency = input.currency
  if (input.itemCount != null) eventMetadata.item_count = input.itemCount

  const event: Record<string, unknown> = {
    event_at: input.eventAt ?? Date.now(),
    action_source: input.actionSource ?? 'website',
    type: { tracking_type: input.eventType },
    user,
    event_metadata: eventMetadata,
  }
  if (input.clickId) event.click_id = input.clickId

  return { data: { test_mode: input.testMode ?? false, events: [event] } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/reddit-capi.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/reddit-capi.ts app/tests/unit/reddit-capi.test.ts
git commit -m "feat(capi): pure Reddit conversion payload + hashing module"
```

---

### Task 2: Server-only network sender + env docs

**Files:**
- Create: `app/src/lib/server/reddit-capi.ts`
- Modify: `app/.env.example` (append the token line)

**Interfaces:**
- Consumes: `buildConversionBody`, `ConversionInput` from Task 1.
- Produces: `sendRedditConversion(input: ConversionInput): Promise<void>` — never throws; no-op when `REDDIT_CONVERSIONS_TOKEN` unset.

- [ ] **Step 1: Write the sender**

```ts
// app/src/lib/server/reddit-capi.ts
import 'server-only'
import { buildConversionBody, type ConversionInput } from '@/lib/reddit-capi'

const PIXEL_ID = process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID || 'a2_jbawbd7fkiwo'
const ENDPOINT = `https://ads-api.reddit.com/api/v3/pixels/${PIXEL_ID}/conversion_events`
const TIMEOUT_MS = 3000

// Fire a Reddit conversion. Best-effort: never throws, no-ops when the token is
// unset. Callers should not await this on a user-facing hot path (use after()).
export async function sendRedditConversion(input: ConversionInput): Promise<void> {
  const token = process.env.REDDIT_CONVERSIONS_TOKEN
  if (!token) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildConversionBody(input)),
      signal: controller.signal,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[reddit-capi] non-ok response', res.status, detail)
    }
  } catch (err) {
    console.error('[reddit-capi] send failed', err)
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 2: Append env documentation**

Add to the end of `app/.env.example`:

```
# Reddit Conversions API — non-expiring token from Events Manager -> Conversions API.
# Server-only (no NEXT_PUBLIC). Feature no-ops when empty.
REDDIT_CONVERSIONS_TOKEN=
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/server/reddit-capi.ts app/.env.example
git commit -m "feat(capi): server-only Reddit conversion sender + env docs"
```

---

### Task 3: SignUp dual-fire with shared-conversion_id dedup

**Files:**
- Modify: `app/src/app/actions/profile.ts` (saveOnboarding success path)
- Modify: `app/src/app/_components/RedditPixel.tsx` (add `conversionId` prop; strip `cid`)
- Modify: `app/src/app/page.tsx` (read `cid`, pass through)

**Interfaces:**
- Consumes: `sendRedditConversion` from Task 2.
- Produces: browser `RedditPixel` accepts `conversionId?: string`; `saveOnboarding` redirects to `/?signup=1&cid=<uuid>`.

- [ ] **Step 1: Fire SignUp server-side in saveOnboarding**

In `app/src/app/actions/profile.ts`, add imports at the top:

```ts
import { after } from 'next/server'
import { headers, cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { sendRedditConversion } from '@/lib/server/reddit-capi'
```

Replace the success tail of `saveOnboarding` (currently `redirect('/')`, following the `if (error) { ... }` block):

```ts
  const conversionId = randomUUID()
  const hdrs = await headers()
  const cookieStore = await cookies()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = hdrs.get('user-agent')
  const clickId = cookieStore.get('rdt_cid')?.value ?? null
  const email = user.email ?? null

  // Best-effort Reddit SignUp conversion, deduped with the browser pixel via cid.
  after(async () => {
    await sendRedditConversion({
      eventType: 'SignUp',
      conversionId,
      email,
      externalId: user.id,
      ip,
      userAgent,
      clickId,
    })
  })

  redirect(`/?signup=1&cid=${conversionId}`)
```

(`user` is the already-resolved `supabase.auth.getUser()` result in this action, exposing `.id` and `.email`.)

- [ ] **Step 2: Add conversionId to the browser pixel + strip cid**

In `app/src/app/_components/RedditPixel.tsx`, add `conversionId` to the props type:

```ts
  conversionId?: string
```

In the `useEffect`, extend the param-strip to also drop `cid`, and pass the option to `track`. Replace the strip block and the track call:

```ts
    if (requireParam) {
      const params = new URLSearchParams(window.location.search)
      if (params.get(requireParam) !== '1') return
      params.delete(requireParam)
      params.delete('cid')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
```

```ts
    rdt('init', PIXEL_ID, Object.keys(keys).length ? keys : undefined)
    rdt('track', event, conversionId ? { conversionId } : undefined)
```

Add `conversionId` to the effect dependency array: `[event, email, externalId, conversionId, requireParam]`.

- [ ] **Step 3: Thread cid through the home page**

In `app/src/app/page.tsx`, widen the searchParams type and read `cid`:

```ts
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ signup?: string; cid?: string }>
}) {
  const sp = await searchParams
  const justSignedUp = sp.signup === '1'
  const conversionId = sp.cid
```

Update the conditional render:

```tsx
      {justSignedUp && (
        <RedditPixel
          event="SignUp"
          email={user.email}
          externalId={user.id}
          conversionId={conversionId}
          requireParam="signup"
        />
      )}
```

- [ ] **Step 4: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Verify behavior in the preview browser**

Start the app (`preview_start` name `app`), navigate to `/?signup=1&cid=test-cid-123`, then in the page context confirm:
- `window.rdt` is a function and `redditstatic.com/ads/pixel.js` loaded.
- The `alb.reddit.com/rp.gif` beacon carries `event=SignUp` and `m.conversionId=test-cid-123`.
- After firing, `window.location.search` is empty (both `signup` and `cid` stripped).

(Beacon DNS may fail in the sandbox; the constructed request URL is the proof.)

- [ ] **Step 6: Commit**

```bash
git add app/src/app/actions/profile.ts app/src/app/_components/RedditPixel.tsx app/src/app/page.tsx
git commit -m "feat(capi): server SignUp conversion, deduped with browser pixel via cid"
```

---

### Task 4: Purchase conversion from the Stripe webhook

**Files:**
- Modify: `app/src/app/api/stripe/webhook/route.ts` (`checkout.session.completed` branch)

**Interfaces:**
- Consumes: `sendRedditConversion` (Task 2), existing `resolveUserId` in the route.
- Produces: a `Purchase` conversion with `conversion_id = session.id`.

- [ ] **Step 1: Add the import**

At the top of `app/src/app/api/stripe/webhook/route.ts`:

```ts
import { sendRedditConversion } from '@/lib/server/reddit-capi'
```

- [ ] **Step 2: Fire Purchase after the subscription upsert**

Replace the `checkout.session.completed` case body:

```ts
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string)
          await upsertFromSubscription(svc, stripe, sub)

          // Best-effort Reddit Purchase conversion. session.id as conversion_id
          // makes webhook retries idempotent on Reddit's side.
          const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
          const userId = await resolveUserId(svc, stripe, customerId)
          await sendRedditConversion({
            eventType: 'Purchase',
            conversionId: session.id,
            email: session.customer_details?.email ?? null,
            externalId: userId ?? undefined,
            value: session.amount_total != null ? session.amount_total / 100 : undefined,
            currency: session.currency ? session.currency.toUpperCase() : undefined,
          })
        }
        break
      }
```

(`sendRedditConversion` never throws, so it cannot turn a successful checkout into a 500.)

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Run the existing webhook test to confirm no regression**

Run: `cd app && npx vitest run tests/unit/billing-webhook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/stripe/webhook/route.ts
git commit -m "feat(capi): Reddit Purchase conversion on paid upgrade"
```

---

## Post-implementation verification (manual, with real token)

Once `REDDIT_CONVERSIONS_TOKEN` is set locally, temporarily pass `testMode: true`
in one `sendRedditConversion` call (or a scratch script) and POST a SignUp — a
`200` with no schema error confirms field names. Reddit's Events Manager shows
test-mode events separately. Remove the temporary `testMode` before shipping.
Confirm dedup by completing a real signup and checking Events Manager counts the
SignUp once across browser + server.
