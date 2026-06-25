import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { getTier, getSubscription } from '@/lib/server/entitlements'
import { UpgradeButtons, ManageButton } from './BillingActions'

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
    <main className="ts-page" style={{ maxWidth: 620 }}>
      <p className="eyebrow">Account</p>
      <h1 className="ts-h1 mt-3">Billing</h1>
      <p className="ts-sub">Current plan: <b>{PLAN_LABEL[tier]}</b></p>

      <section className="ts-card mt-7">
        {tier === 'free' ? (
          <>
            <h2 className="ts-h2">Upgrade</h2>
            <p className="ts-sub mb-5">Unlock unlimited journal history, advanced stats and the full learning hub.</p>
            <UpgradeButtons />
          </>
        ) : (
          <>
            <h2 className="ts-h2">Your subscription</h2>
            <p className="ts-sub mb-2">{PLAN_LABEL[tier]} · status {sub?.status}</p>
            {sub?.cancelAtPeriodEnd && renews && (
              <p className="ts-sub mb-2">Cancels on {renews} — access continues until then.</p>
            )}
            {!sub?.cancelAtPeriodEnd && renews && (
              <p className="ts-sub mb-4">Renews {renews}.</p>
            )}
            <ManageButton />
          </>
        )}
      </section>
    </main>
  )
}
