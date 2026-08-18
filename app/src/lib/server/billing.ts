import 'server-only'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PAST_DUE_GRACE_DAYS } from '@/lib/entitlements'
import type { PaymentFailure, TrialEnding } from '@/lib/billing-webhook'
import { insertSystemNotification } from '@/lib/notifications'
import { sendEmail, paymentFailedHtml, trialEndingHtml } from '@/lib/server/email'
import { logError } from '@/lib/server/log'

/**
 * Shared billing-side server helpers: mapping a Stripe customer back to one of
 * our users, and the two customer-facing notices the webhook now sends.
 *
 * Lives here rather than in the route so the reconciliation cron can resolve
 * users the same way the webhook does — one definition, one behaviour.
 */

/** Our user id for a Stripe customer, via the stored stripe_customer_id and
 *  falling back to the customer's metadata.user_id (set at creation in
 *  api/billing/checkout). Null when neither answers. */
export async function resolveUserId(
  svc: SupabaseClient,
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

/** Login email for a user. Emails live in auth.users, which PostgREST cannot
 *  reach, so this goes through the admin API — the same route
 *  api/cron/lifecycle-emails takes. */
export async function emailForUser(svc: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data } = await svc.auth.admin.getUserById(userId)
    return data.user?.email ?? null
  } catch (err) {
    logError('billing', err, { note: 'email lookup failed', userId: userId })
    return null
  }
}

/** Display name for email copy, degrading to something neutral rather than
 *  "undefined" or a bare uuid. */
async function displayName(svc: SupabaseClient, userId: string): Promise<string> {
  const { data } = await svc
    .from('profiles').select('display_name, username').eq('id', userId).maybeSingle()
  return data?.display_name || data?.username || 'there'
}

/** Notify a customer that a renewal payment failed.
 *
 *  Email plus an in-app notification, because either alone is unreliable: no
 *  email provider is configured in some environments (sendEmail no-ops and
 *  returns { sent: false }), and a customer who has not opened the app in a
 *  fortnight will never see the bell. Both are best-effort — this runs inside
 *  the Stripe webhook, and failing to send a courtesy email must never turn
 *  into a 500 that makes Stripe retry the whole event. */
export async function notifyPaymentFailed(
  svc: SupabaseClient,
  userId: string,
  failure: PaymentFailure,
): Promise<void> {
  try {
    const name = await displayName(svc, userId)
    const email = await emailForUser(svc, userId)
    if (email) {
      const res = await sendEmail({
        to: email,
        subject: failure.final
          ? 'Final notice: your TradingSocial payment failed'
          : 'Your TradingSocial payment didn\'t go through',
        html: paymentFailedHtml({
          name,
          amount: failure.amount,
          final: failure.final,
          // The window opens at the moment Stripe flips the subscription to
          // past_due, which is the same event that bumps subscriptions.updated_at.
          // At the first failure that is now, so the full window is ahead of them.
          graceDaysLeft: PAST_DUE_GRACE_DAYS,
          invoiceUrl: failure.invoiceUrl,
        }),
      })
      if (!res.sent) logError('billing', res.error, { note: 'payment_failed email not sent' })
    } else {
      logError('billing', undefined, { note: 'no email on file for payment_failed', userId: userId })
    }
    await insertSystemNotification({ supabase: svc, userId, type: 'payment_failed' })
  } catch (err) {
    logError('billing', err, { note: 'notifyPaymentFailed failed', userId: userId })
  }
}

/** Notify a customer that a Stripe trial with a card behind it is about to
 *  convert. Only the referral flow can produce one — see trialEnding(). */
export async function notifyTrialWillEnd(
  svc: SupabaseClient,
  userId: string,
  notice: TrialEnding,
  willCharge: boolean,
): Promise<void> {
  try {
    const name = await displayName(svc, userId)
    const email = await emailForUser(svc, userId)
    const endsOn = notice.trialEndsAt
      ? new Date(notice.trialEndsAt).toLocaleDateString('en-AU', {
          day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney',
        })
      : null
    if (email) {
      const res = await sendEmail({
        to: email,
        subject: willCharge
          ? 'Your free Pro months end soon — here\'s what you\'ll be charged'
          : 'Your free Pro months end soon',
        html: trialEndingHtml({
          name, amount: notice.amount, interval: notice.interval, endsOn, willCharge,
        }),
      })
      if (!res.sent) logError('billing', res.error, { note: 'trial_will_end email not sent' })
    } else {
      logError('billing', undefined, { note: 'no email on file for trial_will_end', userId: userId })
    }
    await insertSystemNotification({ supabase: svc, userId, type: 'trial_ending' })
  } catch (err) {
    logError('billing', err, { note: 'notifyTrialWillEnd failed', userId: userId })
  }
}

/** Whether a charge will actually be attempted when a Stripe trial ends.
 *
 *  The subscription's own default_payment_method is checked first; when it is
 *  empty the card may still live on the customer (invoice_settings), so the
 *  customer is retrieved before we tell anyone they will not be charged. That
 *  asymmetry is deliberate: a wrong "you will be charged" is an annoyance, a
 *  wrong "nothing will be charged" is a disclosure failure. Any error resolving
 *  it therefore assumes a charge IS coming. */
export async function willChargeAtTrialEnd(
  stripe: Stripe,
  customerId: string,
  notice: TrialEnding,
): Promise<boolean> {
  if (notice.cancelAtPeriodEnd) return false
  if (notice.paymentMethodOnSubscription) return true
  try {
    const customer = await stripe.customers.retrieve(customerId)
    if (!customer || customer.deleted) return false
    return !!(customer.invoice_settings?.default_payment_method || customer.default_source)
  } catch (err) {
    logError('billing', err, { note: 'customer payment-method lookup failed', customerId: customerId })
    return true // assume a charge is coming; never under-warn
  }
}
