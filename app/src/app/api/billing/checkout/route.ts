import { NextResponse, type NextRequest } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'
import { priceForPlan, type Tier, type Interval } from '@/lib/entitlements'

export const runtime = 'nodejs'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { tier, interval } = (await request.json().catch(() => ({}))) as {
    tier?: Tier; interval?: Interval
  }
  if ((tier !== 'trader' && tier !== 'pro') || (interval !== 'monthly' && interval !== 'annual')) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  const price = priceForPlan(tier, interval, process.env as Record<string, string | undefined>)
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

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    success_url: `${SITE}/settings/billing?status=success`,
    cancel_url: `${SITE}/settings/billing?status=cancelled`,
  })
  if (!session.url) return NextResponse.json({ error: 'no session url' }, { status: 500 })
  return NextResponse.json({ url: session.url })
}
