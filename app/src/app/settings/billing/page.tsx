import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { getEntitlements, getSubscription } from '@/lib/server/entitlements'
import { planForPrice } from '@/lib/entitlements'
import { PlanCards } from './BillingActions'
import { MetaPixel } from '@/app/_components/MetaPixel'
import { subscribeParams } from '@/lib/meta'

const PLAN_LABEL = { free: 'Free', trader: 'Trader', pro: 'Pro Trader' } as const

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tier?: string; interval?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')

  const [{ tier, gate }, sub] = await Promise.all([
    getEntitlements(supabase, user.id),
    getSubscription(supabase, user.id),
  ])
  const renews = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString()
    : null

  // Which interval they actually pay on. Without this the plan cards compare on
  // tier alone, so a monthly subscriber sees the ANNUAL card marked "your plan"
  // and can never switch to it.
  const currentInterval = sub
    ? planForPrice(sub.priceId, process.env as Record<string, string | undefined>)?.interval ?? null
    : null

  // A trial grants tier 'pro' without any Stripe object, so "are they paying?"
  // must be answered by the subscription, never by the tier.
  const onTrial = gate.state === 'active' && !sub

  return (
    <main className="ts-page" style={{ maxWidth: 1040 }}>
      {sp.status === 'success' && (
        <MetaPixel
          event="Subscribe"
          params={subscribeParams(sp.tier, sp.interval)}
          email={user.email}
          externalId={user.id}
          requireParam="status"
          requireValue="success"
          strip
        />
      )}
      <p className="eyebrow">Account</p>
      <h1 className="ts-h1 mt-3">Billing &amp; plans</h1>
      <p className="ts-sub">
        {onTrial ? (
          <>
            You&apos;re on the <b>Pro trial</b> — {gate.daysLeft}{' '}
            {gate.daysLeft === 1 ? 'day' : 'days'} left. Pick a plan to keep your
            tools when it ends.
          </>
        ) : (
          <>
            You&apos;re on the <b>{PLAN_LABEL[tier]}</b> plan
            {sub?.status && sub.status !== 'active' ? ` · ${sub.status}` : ''}.
            {sub?.cancelAtPeriodEnd && renews
              ? ` Cancels on ${renews} — access continues until then.`
              : renews
                ? ` Renews ${renews}.`
                : ''}
          </>
        )}
      </p>

      <PlanCards
        currentTier={tier}
        currentInterval={currentInterval}
        hasSubscription={!!sub}
        onTrial={onTrial}
      />
    </main>
  )
}
