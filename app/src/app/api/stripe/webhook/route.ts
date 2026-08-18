import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/service'
import { subscriptionRow, paymentFailure, trialEnding, mirrorNeedsRepair } from '@/lib/billing-webhook'
import { sendRedditConversion } from '@/lib/server/reddit-capi'
import { ADS_DEFAULT } from '@/lib/consent'
import { markReferralPaid } from '@/lib/server/referral'
import { shouldAckTrialOnSubscription } from '@/lib/entitlements'
import { raiseAlert } from '@/lib/server/alerts'
import {
  resolveUserId, notifyPaymentFailed, notifyTrialWillEnd, willChargeAtTrialEnd,
} from '@/lib/server/billing'
import { logError, logInfo } from '@/lib/server/log'

export const runtime = 'nodejs'

const customerIdOf = (v: string | { id: string } | null | undefined): string | null =>
  !v ? null : typeof v === 'string' ? v : v.id

async function upsertFromSubscription(
  svc: ReturnType<typeof createServiceClient>,
  stripe: Stripe,
  sub: Stripe.Subscription,
) {
  const row = subscriptionRow(sub as never, process.env as Record<string, string>)
  if (!row) {
    // Unknown price -> ack 200 and skip, because a poison event must not wedge
    // the queue. But NOT silently: this is what a rotated Stripe price or an
    // env drift in Vercel looks like, and its consequence is that every
    // subscription on the new price becomes invisible — paying customers
    // compute as 'free' while Stripe's event log shows a clean 200. Log it and
    // raise a system_alert so it surfaces in /admin and the alert webhook.
    const priceId = (sub as unknown as { items?: { data?: Array<{ price?: { id?: string } }> } })
      .items?.data?.[0]?.price?.id ?? 'none'
    logError('stripe webhook', undefined, { note: 'unknown price sub status', priceId, id: sub.id, status: sub.status })
    await raiseAlert(
      svc,
      'billing_unknown_price',
      `Stripe subscription ${sub.id} is on price ${priceId}, which matches none of the four STRIPE_PRICE_* env values. Subscribers on this price are being treated as Free.`,
      { count: 1 },
    )
    return
  }
  const customerId = customerIdOf(sub.customer) ?? ''
  const userId = await resolveUserId(svc, stripe, customerId)
  if (!userId) {
    logError('stripe webhook', undefined, { note: 'could not resolve user for customer sub', customerId, id: sub.id })
    throw new Error(`could not resolve user for customer ${customerId}`)
  }
  // Only write when something actually changed. `subscriptions_touch_updated_at`
  // fires on every UPDATE whether or not any value differs, and `updated_at` is
  // the clock the past_due grace window is measured from — so a redelivered
  // event, or a subscription.updated carrying a change we do not mirror, would
  // otherwise silently restart the grace period. Idempotency, made explicit.
  const { data: existing } = await svc
    .from('subscriptions')
    .select('status, tier, price_id, current_period_end, cancel_at_period_end')
    .eq('id', row.id).maybeSingle()
  if (mirrorNeedsRepair(existing, row)) {
    const { error } = await svc
      .from('subscriptions').upsert({ ...row, user_id: userId }, { onConflict: 'id' })
    // PostgREST reports failures in the result object rather than throwing, so
    // without this an unwritten mirror row looks exactly like a successful one.
    if (error) {
      logError('stripe webhook', error.message, { note: 'mirror upsert failed', id: sub.id })
      throw new Error(`mirror upsert failed for ${sub.id}`)
    }
    logInfo('stripe webhook', { note: 'mirror written', id: sub.id, status: row.status, tier: row.tier })
  } else {
    logInfo('stripe webhook', { note: 'mirror already current', id: sub.id, status: row.status })
  }

  // Referral funnel (row 39): a live subscription promotes the referral to
  // 'paid'. Best-effort — never fail the webhook over bookkeeping.
  const status = (row as { status?: string }).status
  if (status === 'active' || status === 'trialing') {
    try { await markReferralPaid(svc, userId) } catch { /* ignore */ }

    // A paid subscription is itself an answer to the end-of-trial modal, so the
    // user is never re-walled if they later churn — but ONLY once the trial has
    // actually expired. Acking mid-trial resolves the trial and so revokes its
    // 'pro' grant, silently downgrading someone who bought Trader on day 2 from
    // the Pro they were promised for 14 days. Best-effort throughout:
    // bookkeeping must never fail the webhook.
    try {
      const { data: prof, error: readError } = await svc.from('profiles')
        .select('trial_started_at, trial_ack_at').eq('id', userId).maybeSingle()
      if (readError) logError('stripe webhook', readError, { note: 'trial read failed' })

      if (prof && shouldAckTrialOnSubscription(prof.trial_started_at, prof.trial_ack_at, new Date())) {
        // .is(null) keeps this idempotent across webhook retries.
        const { error: ackError } = await svc.from('profiles')
          .update({ trial_ack_at: new Date().toISOString() })
          .eq('id', userId).is('trial_ack_at', null)
        // PostgREST returns failures in the result object rather than throwing,
        // so the enclosing try/catch would never see this one.
        if (ackError) logError('stripe webhook', ackError, { note: 'trial ack failed' })
      }
    } catch (err) { logError('stripe webhook', err, { note: 'trial ack skipped' }) }
  }
}

export async function POST(request: NextRequest) {
  const stripe = getStripe()
  const sig = request.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!sig || !secret) return NextResponse.json({ error: 'bad request' }, { status: 400 })

  const body = await request.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret)
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }

  const svc = createServiceClient()
  // One line per accepted delivery. The whole reason WS1 exists is that this
  // path had never been OBSERVED working end to end in production — the single
  // mirror row's updated_at had not moved since creation, and nothing in the
  // logs could tell "no events arrived" apart from "events arrived and did
  // nothing". This makes that distinction visible in Vercel logs immediately.
  logInfo('stripe webhook', { note: 'received', type: event.type, id: event.id })
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string)
          await upsertFromSubscription(svc, stripe, sub)

          // Best-effort Reddit Purchase conversion. session.id as conversion_id
          // makes webhook retries idempotent on Reddit's side. Never throws.
          //
          // Advertising consent (audit item 17 finding 6) rides in on the
          // session metadata, stamped by api/billing/checkout when it could
          // still read the cookie. A session created before this shipped has no
          // metadata key; those fall back to the documented default rather than
          // being treated as consent.
          const adsConsent = session.metadata?.ads_consent
          const adsAllowed = adsConsent != null ? adsConsent === '1' : ADS_DEFAULT
          if (adsAllowed) {
            const customerId = customerIdOf(sub.customer) ?? ''
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
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertFromSubscription(svc, stripe, event.data.object as Stripe.Subscription)
        break
      }

      // A renewal payment failed. Stripe will keep retrying on its own
      // schedule; our job is to (a) refresh the mirror so the grace clock in
      // entitlements.ts starts from a real timestamp, and (b) actually TELL
      // the customer — until now this event fell through to `default: break`
      // and the first they knew of it was every paid feature disappearing.
      case 'invoice.payment_failed': {
        const invoice = event.data.object as unknown as Parameters<typeof paymentFailure>[0]
        const failure = paymentFailure(invoice)
        if (!failure) break // one-off invoice, nothing to do

        // Pull the subscription and mirror it first. The status change to
        // past_due arrives on its own customer.subscription.updated, but
        // ordering between the two is not guaranteed and the grace window is
        // measured from the mirror row, so make this event self-sufficient.
        const sub = await stripe.subscriptions.retrieve(failure.subscriptionId)
        await upsertFromSubscription(svc, stripe, sub)

        if (!failure.notify) {
          logInfo('stripe webhook', { note: 'payment_failed attempt - no notice this time', attempt: failure.attempt })
          break
        }
        const customerId = customerIdOf(sub.customer) ?? ''
        const userId = await resolveUserId(svc, stripe, customerId)
        if (!userId) {
          logError('stripe webhook', undefined, { note: 'payment_failed for unresolvable customer', customerId: customerId })
          break
        }
        await notifyPaymentFailed(svc, userId, failure)
        break
      }

      // Stripe fires this three days before a trial converts. The advertised
      // 14-day Pro trial takes no card and creates no Stripe object, so it can
      // never produce this event; the referral flow — which DOES put a card on
      // file and auto-charges Pro monthly — is the only thing that can. Terms
      // §8 draws that exact distinction, and this handler is where the code
      // keeps it: name the amount, the date and the cancel route before any
      // money moves.
      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object as Stripe.Subscription
        const notice = trialEnding(sub as never)
        if (!notice) break
        const customerId = customerIdOf(sub.customer) ?? ''
        const userId = await resolveUserId(svc, stripe, customerId)
        if (!userId) {
          logError('stripe webhook', undefined, { note: 'trial_will_end for unresolvable customer', customerId: customerId })
          break
        }
        const willCharge = await willChargeAtTrialEnd(stripe, customerId, notice)
        await notifyTrialWillEnd(svc, userId, notice, willCharge)
        break
      }

      default:
        break // ignore unhandled types
    }
  } catch (err) {
    logError('stripe webhook', err, { note: 'handler error' })
    return NextResponse.json({ error: 'handler error' }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}
