import { NextResponse } from 'next/server'
import { authorizedCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { getStripe } from '@/lib/stripe'
import { reconcileBilling } from '@/lib/server/billing-reconcile'
import { logInfo } from '@/lib/server/log'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Billing reconciliation (WS1). Walks Stripe — the authority — and repairs
 * `public.subscriptions` to match, so the webhook is no longer the single
 * point of truth for who is entitled to what.
 *
 * NOT SCHEDULED IN app/vercel.json, on purpose. The Vercel Hobby plan caps cron
 * jobs at two and both slots are already taken (error-alert, lifecycle-emails);
 * adding a third entry would be REJECTED AT DEPLOY. So the reconciliation is
 * invoked in-process at the top of api/cron/lifecycle-emails — the same "one
 * route because Vercel Hobby caps cron jobs" idiom that route's own docblock
 * already describes — and this endpoint exists so it can also be run on demand
 * (or scheduled directly if the project moves to Pro):
 *
 *     curl -H "authorization: Bearer $CRON_SECRET" \
 *       https://app.tradingsocial.io/api/cron/billing-reconcile
 *
 * Idempotent: running it twice in a row is a no-op the second time, because
 * rows that already match Stripe are never rewritten.
 */
export async function GET(req: Request) {
  if (!authorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let stripe
  try {
    stripe = getStripe()
  } catch {
    // STRIPE_SECRET_KEY unset — a real misconfiguration, but a 500 here would
    // be indistinguishable from a transient failure. Say what is wrong.
    return NextResponse.json({ error: 'stripe not configured' }, { status: 503 })
  }

  const result = await reconcileBilling(createServiceClient(), stripe)
  logInfo('billing reconcile', { result })
  // 200 even with errors in the payload: this is a report, and a non-2xx would
  // only make the platform retry a job that is safe but not free to repeat.
  return NextResponse.json({ ok: result.errors.length === 0, ...result })
}
