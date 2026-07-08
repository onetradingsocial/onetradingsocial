'use client'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

type Tier = 'free' | 'trader' | 'pro'
const RANK: Record<Tier, number> = { free: 0, trader: 1, pro: 2 }

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
    monthly: 30, annual: 6, billedM: 'Billed monthly', billedA: '$72 first year, then $300/yr',
    featsLabel: 'Everything in Free, plus',
    feats: [
      { t: 'Unlimited journal entries' },
      { t: 'Import MT5 history (statement upload)' },
      { t: 'Advanced stats & full performance dashboard' },
      { t: 'Strategy tracking & mistake tagging' },
      { t: 'Full beginner & intermediate courses' },
      { t: 'Advanced leaderboard filters' },
    ],
  },
  {
    tier: 'pro', name: 'Pro Trader', pip: 'pip-pro', tag: 'Advanced tools for serious traders.',
    monthly: 50, annual: 10, billedM: 'Billed monthly', billedA: '$120 first year, then $500/yr',
    featsLabel: 'Everything in Trader, plus',
    feats: [
      { t: 'Automatic MT5 sync — every 15 minutes' },
      { t: 'Advanced analytics & reporting' },
      { t: 'Monthly downloadable trader reports' },
      { t: 'Premium courses & psychology modules' },
      { t: 'Creator profile & Pro badge' },
      { t: 'Premium challenges & competitions' },
    ],
  },
]

export function PlanCards({ currentTier, isPaid }: { currentTier: Tier; isPaid: boolean }) {
  const [interval, setBillingInterval] = useState<'monthly' | 'annual'>('monthly')
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
          const isCurrent = p.tier === currentTier
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
                <span className="cur">$</span><span className="amt">{amt}</span><span className="per">/month</span>
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

              <PlanCta plan={p} currentTier={currentTier} interval={interval} busy={busy} act={act} />
            </article>
          )
        })}
      </div>

      {isPaid && (
        <div className="mt-6" style={{ textAlign: 'center' }}>
          <button className="btn btn-ghost" disabled={busy} onClick={() => act(() => post('/api/billing/portal'))}>
            Manage billing & invoices
          </button>
        </div>
      )}
    </>
  )
}

function PlanCta({ plan, currentTier, interval, busy, act }: {
  plan: PlanDef
  currentTier: Tier
  interval: 'monthly' | 'annual'
  busy: boolean
  act: (fn: () => Promise<void>) => Promise<void>
}) {
  if (plan.tier === currentTier) {
    return <button className="btn btn-ghost pcard-cta" disabled>✓ Current plan</button>
  }
  if (plan.tier === 'free') {
    // Viewer is on a paid plan; downgrade to Free happens via the Stripe portal.
    return <button className="btn btn-ghost pcard-cta" disabled={busy} onClick={() => act(() => post('/api/billing/portal'))}>Manage plan</button>
  }
  if (RANK[plan.tier] > RANK[currentTier]) {
    return (
      <button className={`btn pcard-cta ${plan.tier === 'trader' ? 'btn-primary' : 'btn-ghost'}`} disabled={busy}
        onClick={() => act(() => post('/api/billing/checkout', { tier: plan.tier, interval }))}>
        Upgrade to {plan.name}
      </button>
    )
  }
  // Lower than the current tier (e.g. on Pro, viewing Trader) — switch via portal.
  return <button className="btn btn-ghost pcard-cta" disabled={busy} onClick={() => act(() => post('/api/billing/portal'))}>Switch to {plan.name}</button>
}
