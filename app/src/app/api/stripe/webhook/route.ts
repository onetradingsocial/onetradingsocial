import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/service'
import { subscriptionRow } from '@/lib/billing-webhook'
import { sendRedditConversion } from '@/lib/server/reddit-capi'
import { markReferralPaid } from '@/lib/server/referral'

export const runtime = 'nodejs'

// Resolve our user id from the Stripe customer (via stored stripe_customer_id),
// falling back to the customer's metadata.user_id.
async function resolveUserId(
  svc: ReturnType<typeof createServiceClient>,
  stripe: Stripe,
  customerId: string,
): Promise<string | null> {
  const { data } = await svc
    .from('profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle()
  if (data?.id) return data.id
  const customer = await stripe.customers.retrieve(customerId)
  if (customer && !customer.deleted && customer.metadata?.user_id) return customer.metadata.user_id
  return null
}

async function upsertFromSubscription(
  svc: ReturnType<typeof createServiceClient>,
  stripe: Stripe,
  sub: Stripe.Subscription,
) {
  const row = subscriptionRow(sub as never, process.env as Record<string, string>)
  if (!row) return // unknown price -> ack, skip
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  const userId = await resolveUserId(svc, stripe, customerId)
  if (!userId) {
    console.error('[stripe webhook] could not resolve user for customer', customerId, 'sub', sub.id)
    throw new Error(`could not resolve user for customer ${customerId}`)
  }
  await svc.from('subscriptions').upsert({ ...row, user_id: userId }, { onConflict: 'id' })

  // Referral funnel (row 39): a live subscription promotes the referral to
  // 'paid'. Best-effort — never fail the webhook over bookkeeping.
  const status = (row as { status?: string }).status
  if (status === 'active' || status === 'trialing') {
    try { await markReferralPaid(svc, userId) } catch { /* ignore */ }
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
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string)
          await upsertFromSubscription(svc, stripe, sub)

          // Best-effort Reddit Purchase conversion. session.id as conversion_id
          // makes webhook retries idempotent on Reddit's side. Never throws.
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
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertFromSubscription(svc, stripe, event.data.object as Stripe.Subscription)
        break
      }
      default:
        break // ignore unhandled types
    }
  } catch (err) {
    console.error('[stripe webhook] handler error', err)
    return NextResponse.json({ error: 'handler error' }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}
