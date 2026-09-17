import { redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import { getEntitlements, getSubscription } from '@/lib/server/entitlements'
import { planForPrice } from '@/lib/entitlements'
import { PlanCards } from './BillingActions'
import { MetaPixel } from '@/app/_components/MetaPixel'
import { subscribeParams } from '@/lib/meta'
import { formatBillingDate } from '@/lib/locale-format'

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
    ? formatBillingDate(sub.currentPeriodEnd)
    : null

  // Which interval they actually pay on. Without this the plan cards compare on
  // tier alone, so a monthly subscriber sees the ANNUAL card marked "your plan"
  // and can never switch to it.
  const currentInterval = sub
    ? planForPrice(sub.priceId, process.env as Record<string, string | undefined>)?.interval ?? null
    : null

  // "Are they paying?" must still be answered by the subscription, never by the
  // tier — a trial grants 'pro' either way.
  //
  // But `gate.state === 'active' && !sub` is no longer the way to ask "are they
  // on a trial". That read "a trial is a user with no subscription", which was
  // true only while a trial created no Stripe object. A Stripe trialist fails
  // BOTH halves — gate.state tracks the local trial only, and they do have a
  // subscription — so the page fell through to the paid branch and told someone
  // who has paid nothing that their plan "renews" on the day of their FIRST
  // charge, labelled with the raw Stripe status "trialing".
  //
  // gate.trial understands both mechanisms; cardOnFile says whether money
  // follows.
  const onTrial = !!gate.trial
  const trialDaysLeft = gate.trial?.daysLeft ?? 0
  const trialCardOnFile = gate.trial?.cardOnFile === true
  // A card on file is not the same as a charge coming: a trialist who cancelled
  // still has one. Telling them "the card you saved will be charged" was the
  // exact complaint that surfaced the missing `cancel_at` handling.
  const trialCancelling = trialCardOnFile && gate.trial?.cancelling === true

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
            You&apos;re on the <b>Pro trial</b> — {trialDaysLeft}{' '}
            {trialDaysLeft === 1 ? 'day' : 'days'} left.{' '}
            {trialCancelling ? (
              <>
                {renews
                  ? <>You&apos;ve cancelled, so your trial ends on {renews} and you won&apos;t be charged.</>
                  : <>You&apos;ve cancelled, so your trial ends without a charge.</>}
                {' '}Your account moves to Free after that.
              </>
            ) : trialCardOnFile ? (
              <>
                {renews
                  ? <>Your plan starts on {renews} and the card you saved will be charged.</>
                  : <>Your plan starts when the trial ends and the card you saved will be charged.</>}
                {' '}Cancel before then and you won&apos;t be charged.
              </>
            ) : (
              <>Pick a plan to keep your tools when it ends.</>
            )}
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

      {/* A failed renewal used to show as a bare " · past_due" appended to the
          plan line, with no explanation and no call to action, while every paid
          feature vanished the same instant. Now the tier is held for the grace
          window (PAST_DUE_GRACE_DAYS) and this says so plainly. */}
      {sub?.status === 'past_due' && (
        <p className="ts-callout mt-3" role="status">
          <b>We couldn&apos;t take your last payment.</b>{' '}
          {sub.inGrace
            ? `Your paid features stay on for another ${sub.graceDaysLeft} ${sub.graceDaysLeft === 1 ? 'day' : 'days'} while your bank retries.`
            : 'Your paid features are paused until the payment goes through.'}{' '}
          Update your card under <b>Manage billing &amp; invoices</b> below — nothing you&apos;ve
          logged has been deleted.
        </p>
      )}

      <PlanCards
        currentTier={tier}
        currentInterval={currentInterval}
        hasSubscription={!!sub}
        onTrial={onTrial}
      />
    </main>
  )
}
