import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { getTier, getSubscription } from '@/lib/server/entitlements'
import { PlanCards } from './BillingActions'

const PLAN_LABEL = { free: 'Free', trader: 'Trader', pro: 'Pro Trader' } as const

export default async function BillingPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const tier = await getTier(supabase, user.id)
  const sub = await getSubscription(supabase, user.id)
  const renews = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString()
    : null

  return (
    <main className="ts-page" style={{ maxWidth: 1040 }}>
      <p className="eyebrow">Account</p>
      <h1 className="ts-h1 mt-3">Billing &amp; plans</h1>
      <p className="ts-sub">
        You&apos;re on the <b>{PLAN_LABEL[tier]}</b> plan
        {sub?.status && sub.status !== 'active' ? ` · ${sub.status}` : ''}.
        {sub?.cancelAtPeriodEnd && renews
          ? ` Cancels on ${renews} — access continues until then.`
          : renews
            ? ` Renews ${renews}.`
            : ''}
      </p>

      <PlanCards currentTier={tier} isPaid={tier !== 'free'} />
    </main>
  )
}
