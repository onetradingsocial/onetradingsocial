import { NextResponse, type NextRequest } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { priceForPlan, type Tier, type Interval } from '@/lib/entitlements'
import { getReferralStats } from '@/lib/server/referral'
import { earnedMonths } from '@/lib/referral'
import { rateLimit, clientKey, tooMany } from '@/lib/server/rate-limit'
import { ADS_DEFAULT, CONSENT_COOKIE, parseConsent } from '@/lib/consent'
import { stripeTermsConsent } from '@/lib/terms-acceptance'
import { trackServer } from '@/lib/server/track'
import { logError } from '@/lib/server/log'

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
    tier?: Tier; interval?: Interval; flow?: 'referral' | 'trial_end'
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

  // What the customer is actually being sold, after the referral flow's
  // server-side override. Used for the price lookup and stamped onto the
  // session so the webhook can report the plan on the `subscribed` event.
  const soldTier: Tier = flow === 'referral' ? 'pro' : (tier as Tier)
  const soldInterval: Interval = flow === 'referral' ? 'monthly' : (interval as Interval)

  const price = priceForPlan(soldTier, soldInterval, env)
  if (!price) return NextResponse.json({ error: 'price not configured' }, { status: 500 })

  const stripe = getStripe()

  // Ensure a Stripe customer, store its id on the profile.
  // Service client for the READ as well as the write: 0047 revokes SELECT on
  // stripe_customer_id from anon and authenticated (0042 had already revoked
  // UPDATE). Scoped to user.id from getUser(), so it reads only the caller's row.
  const { data: prof } = await createServiceClient()
    .from('profiles').select('stripe_customer_id').eq('id', user.id).single()
  let customerId = prof?.stripe_customer_id as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { user_id: user.id },
    })
    customerId = customer.id
    // Service client: stripe_customer_id is NOT in the column grant of 0042.
    // It is the key the webhook maps a Stripe customer back to a user with, so
    // letting a client PATCH it would let one user claim another's subscription.
    const { error: persistError } = await createServiceClient()
      .from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id)
    if (persistError) {
      logError('billing checkout', persistError, { note: 'failed to persist stripe_customer_id' })
      return NextResponse.json({ error: 'could not save customer' }, { status: 500 })
    }
  }

  // Every checkout now returns to the billing page. tier/interval ride along so
  // that page can attach a value to the ad-pixel Subscribe event; the pixel
  // component strips them after firing.
  const successUrl = flow === 'referral'
    ? `${SITE}/settings/billing?status=referral&months=${referralMonths}`
    : `${SITE}/settings/billing?status=success&tier=${tier}&interval=${interval}`
  const cancelUrl = `${SITE}/settings/billing?status=cancelled`

  // Beta promo: 76% off the annual list price (= 80% off the 12x monthly rate,
  // since annual list already includes 2 months free). First invoice only —
  // renewals bill at the full annual price. Remove the env var to end the promo.
  const betaCoupon = process.env.STRIPE_COUPON_BETA_ANNUAL

  const adsConsent =
    parseConsent(request.cookies.get(CONSENT_COOKIE)?.value)?.ads ?? ADS_DEFAULT

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
    // Stripe's own terms acceptance (item 5 finding 2). Undefined unless
    // STRIPE_TOS_CONSENT=on, because Stripe rejects this when no ToS URL is set
    // in the Dashboard — see stripeTermsConsent() for the full reasoning and
    // the order the two switches must be flipped in.
    consent_collection: stripeTermsConsent(),
    // Advertising consent, carried to the webhook (audit item 17 finding 6).
    // The Purchase conversion is fired from the Stripe webhook, which has no
    // browser context and therefore cannot read the consent cookie. Stamping
    // the answer on the session is how the visitor's choice survives the trip
    // through Stripe — without it, declining advertising would silently stop
    // the signup conversion but not the purchase one.
    //
    // tier/interval/flow ride along for the same reason: the `subscribed`
    // funnel event is fired from the webhook, which knows the price id but not
    // the plan the customer thought they were buying.
    metadata: {
      ads_consent: adsConsent ? '1' : '0',
      tier: soldTier,
      interval: soldInterval,
      flow: flow ?? 'direct',
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  })
  if (!session.url) return NextResponse.json({ error: 'no session url' }, { status: 500 })

  // Funnel: checkout_started. The bottom two steps of the admin funnel
  // (`checkout_started`, `subscribed`) were in the dashboard query and in the
  // client allowlist but had no emitter anywhere, so both rows read zero no
  // matter how many people actually paid. This is the first of the two.
  //
  // Fired here rather than from the client because this is the point at which
  // a Stripe session genuinely exists — a click that fails validation or rate
  // limiting above is not a started checkout.
  await trackServer('checkout_started', user, {
    tier: soldTier,
    interval: soldInterval,
    flow: flow ?? 'direct',
  })

  return NextResponse.json({ url: session.url })
}
