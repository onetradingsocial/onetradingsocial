import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: prof } = await supabase
    .from('profiles').select('stripe_customer_id').eq('id', user.id).single()
  const customerId = prof?.stripe_customer_id as string | null
  if (!customerId) return NextResponse.json({ error: 'no customer' }, { status: 400 })

  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${SITE}/settings/billing`,
  })
  return NextResponse.json({ url: session.url })
}
