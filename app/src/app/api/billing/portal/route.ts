import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingCustomer } from '@/lib/server/billing'
import { logError } from '@/lib/server/log'

export const runtime = 'nodejs'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Service client: 0047 revokes SELECT on stripe_customer_id from both client
  // roles, because a column grant is role-wide and cannot be narrowed to "your
  // own row". The filter is user.id from getUser(), never a client parameter,
  // so bypassing RLS here reads exactly the caller's own row and nothing else.
  const { data: prof } = await createServiceClient()
    .from('profiles').select('stripe_customer_id').eq('id', user.id).single()
  const customerId = prof?.stripe_customer_id as string | null
  if (!customerId) return NextResponse.json({ error: 'no customer' }, { status: 400 })

  /**
   * The same stale-id failure as checkout, with the opposite remedy.
   *
   * Checkout can mint a replacement customer and carry on, because what it
   * needs is somewhere to attach a NEW subscription. The portal cannot: it
   * exists to show invoices and manage an EXISTING subscription, and a
   * freshly-minted customer has neither. Re-minting here would open an empty
   * portal and call that success — the user would be told, in effect, that they
   * have no billing history.
   *
   * So this end reports the truth. A stored id Stripe cannot see means the link
   * between this account and its billing record is broken, and that needs a
   * person, not a retry.
   */
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${SITE}/settings/billing`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    if (!isMissingCustomer(err, customerId)) throw err
    logError('billing portal', err, {
      note: 'stored stripe_customer_id not found in this Stripe mode',
      customerId,
    })
    return NextResponse.json({ error: 'billing record not found' }, { status: 409 })
  }
}
