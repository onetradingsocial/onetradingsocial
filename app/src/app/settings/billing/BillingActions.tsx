'use client'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { trackMeta } from '@/app/_components/MetaPixel'
import { CUR, CURRENCY_NOTE } from '@/lib/plans'

const MARKETING = process.env.NEXT_PUBLIC_MARKETING_URL ?? 'https://www.tradingsocial.io'

type Tier = 'free' | 'trader' | 'pro'
type Interval = 'monthly' | 'annual'

async function post(url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) { alert('Something went wrong. Please try again.'); return }
  const { url: redirect } = await res.json()
  if (redirect) window.location.href = redirect
}

const CHK: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const LIM: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
)

type PlanDef = {
  tier: Tier
  name: string
  pip: string
  tag: string
  monthly: number
  annual: number
  billedM: string
  billedA: string
  featsLabel: string
  feats: { t: string; lim?: boolean }[]
}

const PLANS: PlanDef[] = [
  {
    tier: 'free', name: 'Free', pip: 'pip-free', tag: 'Start building your trading profile.',
    monthly: 0, annual: 0, billedM: 'Free forever', billedA: 'Free forever',
    featsLabel: "What's included",
    feats: [
      { t: 'Public TradingSocial profile' },
      { t: 'Basic trading journal & manual logging' },
      { t: 'Basic stats dashboard' },
      { t: 'Follow traders, feed & leaderboard' },
      { t: 'Journal history — last 30 trades', lim: true },
    ],
  },
  {
    tier: 'trader', name: 'Trader', pip: 'pip-trader', tag: 'Build discipline and improve faster.',
    monthly: 30, annual: 6, billedM: 'Billed monthly', billedA: 'A$72 first year, then A$300/yr',
    featsLabel: 'Everything in Free, plus',
    feats: [
      { t: 'Unlimited journal entries' },
      { t: 'Import MT5 history (statement upload)' },
      { t: 'Advanced stats & full performance dashboard' },
      { t: 'Strategy tracking & mistake tagging' },
      // Learn hidden for now — we are not financial advisors. Restore
      // `{ t: 'Full beginner & intermediate courses' },` here when compliant.
      { t: 'Advanced leaderboard filters' },
    ],
  },
  {
    tier: 'pro', name: 'Pro Trader', pip: 'pip-pro', tag: 'Advanced tools for serious traders.',
    monthly: 50, annual: 10, billedM: 'Billed monthly', billedA: 'A$120 first year, then A$500/yr',
    featsLabel: 'Everything in Trader, plus',
    feats: [
      { t: 'Automatic MT5 sync — hourly' },
      { t: 'Advanced analytics & reporting' },
      { t: 'Monthly downloadable trader reports' },
      // Learn hidden for now — we are not financial advisors. Restore
      // `{ t: 'Premium courses & psychology modules' },` here when compliant.
      { t: 'Creator profile & Pro badge' },
      { t: 'Premium challenges & competitions' },
    ],
  },
]

export function PlanCards({ currentTier, currentInterval, hasSubscription, onTrial }: {
  currentTier: Tier
  /** The interval they actually pay on, or null when there is no subscription. */
  currentInterval: Interval | null
  /** A real Stripe subscription exists. NOT the same as tier !== 'free': a trial
   *  grants 'pro' with no Stripe object at all. */
  hasSubscription: boolean
  onTrial: boolean
}) {
  const [interval, setBillingInterval] = useState<Interval>('monthly')
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<void>) => { setBusy(true); await fn(); setBusy(false) }

  // animated billing-toggle thumb — track the active option's box (mirrors /select-plan)
  const switchRef = useRef<HTMLDivElement>(null)
  const monthlyRef = useRef<HTMLButtonElement>(null)
  const annualRef = useRef<HTMLButtonElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number }>({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const el = interval === 'monthly' ? monthlyRef.current : annualRef.current
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth })
  }, [interval])

  return (
    <>
      <div className="ts-plan-toggle mt-6">
        <div className="ts-bswitch" ref={switchRef}>
          <span className="ts-bthumb" style={{ left: thumb.left, width: thumb.width }} />
          <button type="button" ref={monthlyRef} className={`ts-bopt${interval === 'monthly' ? ' on' : ''}`} onClick={() => setBillingInterval('monthly')}>Monthly</button>
          <button type="button" ref={annualRef} className={`ts-bopt${interval === 'annual' ? ' on' : ''}`} onClick={() => setBillingInterval('annual')}>Annual</button>
        </div>
        <span className="ts-bsave">Beta — 80% off yearly</span>
      </div>

      <div className="ts-plan-grid mt-6">
        {PLANS.map((p) => {
          const popular = p.tier === 'trader'
          // "Your plan" keys off the EFFECTIVE tier. Interval only narrows it
          // for people who actually pay: comparing tier alone marked the annual
          // card as current for a monthly subscriber, which both misstated
          // their bill and disabled the only route onto the annual plan. But
          // requiring an interval match outright left every tier granted
          // WITHOUT Stripe — admin bypass, referral comp — matching no card at
          // all, so a comped Pro was shown "Upgrade to Pro Trader" and a live
          // checkout for the plan they already hold. Free counts as current
          // only when nothing else is granting a higher tier.
          const isCurrent = onTrial
            ? false
            : p.tier === 'free'
              ? currentTier === 'free' && !hasSubscription
              : p.tier === currentTier && (!hasSubscription || interval === currentInterval)
          const amt = interval === 'monthly' ? p.monthly : p.annual
          const billed = interval === 'monthly' ? p.billedM : p.billedA
          return (
            <article key={p.tier} className={`pcard${popular ? ' pcard--pop' : ''}${isCurrent ? ' pcard--current' : ''}`}>
              {popular && <span className="pcard-badge">Most popular</span>}
              {isCurrent && <span className="pcard-current-tag">Your plan</span>}
              <div className="pcard-head">
                <span className="pcard-name"><span className={`pip ${p.pip}`} />{p.name}</span>
                <span className="pcard-tag">{p.tag}</span>
              </div>
              <div className="pcard-price">
                <span className="cur">{CUR}</span><span className="amt">{amt}</span><span className="per">/month</span>
              </div>
              <div className="pcard-billed">{billed}</div>

              <div className="pcard-feats">
                <span className="pcard-feats-lbl">{p.featsLabel}</span>
                <ul>
                  {p.feats.map((f, i) => (
                    <li key={i}>
                      <span className={f.lim ? 'lim' : 'chk'}>{f.lim ? LIM : CHK}</span>
                      <span>{f.t}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <PlanCta
                plan={p}
                isCurrent={isCurrent}
                interval={interval}
                hasSubscription={hasSubscription}
                onTrial={onTrial}
                busy={busy}
                act={act}
              />
            </article>
          )
        })}
      </div>

      {/* GST PLACEHOLDER — OWNER DECISION REQUIRED. A GST line belongs in this
          block once the entity's GST registration status is confirmed. */}
      <p className="ts-price-fine mt-6">
        {CURRENCY_NOTE} Paid plans renew automatically at the price shown until you
        cancel. Cancel any time via <b>Manage billing &amp; invoices</b> — access
        continues to the end of the period you have already paid for.{' '}
        <a href={`${MARKETING}/terms#subscriptions`} target="_blank" rel="noopener noreferrer">Subscription terms</a>
      </p>

      {/* APP 5, audit item 4 finding 7 / S5. A payment was taken with no link to
          any policy on the page. Checkout sends Stripe the user's email address
          and account id (api/billing/checkout/route.ts:65-68) and then hands the
          browser to Stripe for the card. "We never see or store your card
          details" is true and is worth saying at exactly this moment. */}
      <p className="ts-price-fine mt-3">
        Payments are processed by <b>Stripe</b>. We send Stripe your email address and account
        identifier; you enter your card on Stripe&apos;s own page and{' '}
        <b>we never see or store your card details</b>.{' '}
        <a href={`${MARKETING}/privacy`} target="_blank" rel="noopener noreferrer">How we handle your data</a>
      </p>

      {hasSubscription && (
        <div className="mt-6" style={{ textAlign: 'center' }}>
          <button className="btn btn-ghost" disabled={busy} onClick={() => act(() => post('/api/billing/portal'))}>
            Manage billing & invoices
          </button>
        </div>
      )}
    </>
  )
}

function PlanCta({ plan, isCurrent, interval, hasSubscription, onTrial, busy, act }: {
  plan: PlanDef
  isCurrent: boolean
  interval: Interval
  hasSubscription: boolean
  onTrial: boolean
  busy: boolean
  act: (fn: () => Promise<void>) => Promise<void>
}) {
  if (isCurrent) {
    return <button className="btn btn-ghost pcard-cta" disabled>✓ Current plan</button>
  }

  // Free is never something you buy. With a subscription, dropping to Free is a
  // cancellation and belongs in the portal. On a trial it is simply what happens
  // next, so say so rather than offering a button that cannot work.
  if (plan.tier === 'free') {
    if (onTrial) {
      return <button className="btn btn-ghost pcard-cta" disabled>Your plan when the trial ends</button>
    }
    // No subscription means no Stripe customer, so there is no portal session to
    // open — a comped/admin tier would just hit an error dialog.
    if (!hasSubscription) {
      return <button className="btn btn-ghost pcard-cta" disabled>Included with every account</button>
    }
    return (
      <button className="btn btn-ghost pcard-cta" disabled={busy}
        onClick={() => act(() => post('/api/billing/portal'))}>
        Manage plan
      </button>
    )
  }

  // ANY change to an existing subscription — different tier or different
  // interval — must go through the Stripe portal. Opening a fresh Checkout
  // session would create a SECOND active subscription against the same customer
  // and bill them twice, rather than moving them onto the new plan.
  if (hasSubscription) {
    return (
      <button className="btn btn-ghost pcard-cta" disabled={busy}
        onClick={() => act(() => post('/api/billing/portal'))}>
        Switch to {plan.name} {interval === 'annual' ? 'annual' : 'monthly'}
      </button>
    )
  }

  // No subscription (free or on trial) — a real first purchase, so Checkout.
  return (
    <button className={`btn pcard-cta ${plan.tier === 'trader' ? 'btn-primary' : 'btn-ghost'}`} disabled={busy}
      onClick={() => {
        trackMeta('InitiateCheckout', { content_name: `${plan.tier}_${interval}` })
        return act(() => post('/api/billing/checkout', { tier: plan.tier, interval }))
      }}>
      {onTrial ? `Continue with ${plan.name}` : `Upgrade to ${plan.name}`}
    </button>
  )
}
