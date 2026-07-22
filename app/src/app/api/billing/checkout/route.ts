import { NextResponse, type NextRequest } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { priceForPlan, type Tier, type Interval } from '@/lib/entitlements'
import { getReferralStats } from '@/lib/server/referral'
import { earnedMonths } from '@/lib/referral'
import { rateLimit, clientKey, tooMany } from '@/lib/server/rate-limit'

export const runtime = 'nodejs'

// Each call creates a Stripe customer/session; nobody legitimately needs more
// than a handful a minute.
const CHECKOUT_MAX = 10
const CHECKOUT_WINDOW = 60_000

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rl = rateLimit(clientKey(request, user.id), CHECKOUT_MAX, CHECKOUT_WINDOW)
  if (!rl.ok) return tooMany(rl.retryAfter)

  const { tier, interval, flow } = (await request.json().catch(() => ({}))) as {
    tier?: Tier; interval?: Interval; flow?: 'onboarding' | 'referral'
  }

  const env = process.env as Record<string, string | undefined>

  // Referral redemption: the referrer claims their earned free Pro. We ignore
  // any client-supplied tier/interval and force Pro monthly, then hand them the
  // free months they've actually earned as a Stripe trial. The count is
  // re-derived server-side so the free period can never be forged by the client.
  let referralMonths = 0
  if (flow === 'referral') {
    const svc = createServiceClient()
    const { data: codeRow } = await svc
      .from('referral_codes').select('code').eq('user_id', user.id).maybeSingle()
    if (codeRow?.code) {
      const stats = await getReferralStats(svc, user.id, codeRow.code)
      referralMonths = earnedMonths(stats.activated)
    }
    if (referralMonths < 1) {
      return NextResponse.json({ error: 'no referral reward earned yet' }, { status: 400 })
    }
  } else if ((tier !== 'trader' && tier !== 'pro') || (interval !== 'monthly' && interval !== 'annual')) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  const price = flow === 'referral'
    ? priceForPlan('pro', 'monthly', env)
    : priceForPlan(tier as Tier, interval as Interval, env)
  if (!price) return NextResponse.json({ error: 'price not configured' }, { status: 500 })

  const stripe = getStripe()

  // Ensure a Stripe customer, store its id on the profile.
  const { data: prof } = await supabase
    .from('profiles').select('stripe_customer_id').eq('id', user.id).single()
  let customerId = prof?.stripe_customer_id as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { user_id: user.id },
    })
    customerId = customer.id
    const { error: persistError } = await supabase
      .from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id)
    if (persistError) {
      console.error('[billing checkout] failed to persist stripe_customer_id', persistError)
      return NextResponse.json({ error: 'could not save customer' }, { status: 500 })
    }
  }

  // During signup the checkout sits between the plan selector and onboarding,
  // so on success we send the user into onboarding rather than back to billing.
  // tier/interval ride along so the landing page can attach a value to the
  // ad-pixel Subscribe event; the pixel component strips them after firing.
  const successUrl = flow === 'onboarding'
    ? `${SITE}/onboarding?checkout=success&tier=${tier}&interval=${interval}`
    : flow === 'referral'
      ? `${SITE}/settings/billing?status=referral&months=${referralMonths}`
      : `${SITE}/settings/billing?status=success&tier=${tier}&interval=${interval}`
  const cancelUrl = flow === 'onboarding'
    ? `${SITE}/select-plan?checkout=cancelled`
    : `${SITE}/settings/billing?status=cancelled`

  // Beta promo: 76% off the annual list price (= 80% off the 12x monthly rate,
  // since annual list already includes 2 months free). First invoice only —
  // renewals bill at the full annual price. Remove the env var to end the promo.
  const betaCoupon = process.env.STRIPE_COUPON_BETA_ANNUAL

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    discounts: flow !== 'referral' && interval === 'annual' && betaCoupon
      ? [{ coupon: betaCoupon }] : undefined,
    // Free-Pro reward: collect a card up front ($0 due today) and open the
    // subscription in a trial that lasts one month per earned referral. When the
    // trial ends Stripe bills Pro monthly automatically — the "free now, billed
    // later" flow the client asked for. The card is required so conversion is
    // frictionless; the T&Cs (billed monthly after the free period) are shown at
    // checkout and on the referral modal.
    subscription_data: flow === 'referral'
      ? { trial_period_days: referralMonths * 30 } : undefined,
    payment_method_collection: flow === 'referral' ? 'always' : undefined,
    success_url: successUrl,
    cancel_url: cancelUrl,
  })
  if (!session.url) return NextResponse.json({ error: 'no session url' }, { status: 500 })
  return NextResponse.json({ url: session.url })
}
