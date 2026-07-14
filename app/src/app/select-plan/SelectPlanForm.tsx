'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Tier, Interval } from '@/lib/entitlements'
import { trackMeta } from '@/app/_components/MetaPixel'

/* ───────────────── icons ───────────────── */
const CHK: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const LIM: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
)
const ARROW: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
const BACK: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
)
const LOCK: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
)

/* ───────────────── plan data (mirrors settings/billing) ───────────────── */
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
    tier: 'free', name: 'Free', pip: 'free', tag: 'Start building your trading profile.',
    monthly: 0, annual: 0, billedM: 'Free forever', billedA: 'Free forever',
    featsLabel: "What's included",
    feats: [
      { t: 'Public TradingSocial profile' },
      { t: 'Basic journal & manual logging' },
      { t: 'Basic stats dashboard' },
      { t: 'Follow traders, feed & leaderboard' },
      { t: 'Journal history — last 30 trades', lim: true },
    ],
  },
  {
    tier: 'trader', name: 'Trader', pip: 'trader', tag: 'Build discipline and improve faster.',
    monthly: 30, annual: 6, billedM: 'Billed monthly', billedA: '$72 first year, then $300/yr',
    featsLabel: 'Everything in Free, plus',
    feats: [
      { t: 'Unlimited journal entries' },
      { t: 'Import MT5 history (statement upload)' },
      { t: 'Advanced stats & full dashboard' },
      { t: 'Strategy tracking & mistake tagging' },
      { t: 'Private (solo) profile option' },
      { t: 'Advanced leaderboard filters' },
    ],
  },
  {
    tier: 'pro', name: 'Pro Trader', pip: 'pro', tag: 'Advanced tools for serious traders.',
    monthly: 50, annual: 10, billedM: 'Billed monthly', billedA: '$120 first year, then $500/yr',
    featsLabel: 'Everything in Trader, plus',
    feats: [
      { t: 'Automatic MT5 sync — hourly' },
      { t: 'Advanced analytics & reporting' },
      { t: 'Monthly downloadable reports' },
      { t: 'Premium courses & psychology' },
      { t: 'Creator profile & Pro badge' },
      { t: 'Premium challenges & competitions' },
    ],
  },
]

export function SelectPlanForm() {
  const router = useRouter()
  const [interval, setInterval] = useState<Interval>('monthly')
  const [selected, setSelected] = useState<Tier>('free')
  const [busy, setBusy] = useState(false)

  // animated billing-toggle thumb — track the active option's box
  const switchRef = useRef<HTMLDivElement>(null)
  const monthlyRef = useRef<HTMLButtonElement>(null)
  const annualRef = useRef<HTMLButtonElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number }>({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const el = interval === 'monthly' ? monthlyRef.current : annualRef.current
    const wrap = switchRef.current
    if (el && wrap) setThumb({ left: el.offsetLeft, width: el.offsetWidth })
  }, [interval])

  const onContinue = async () => {
    setBusy(true)
    if (selected === 'free') {
      router.push('/onboarding')
      return
    }
    trackMeta('InitiateCheckout', { content_name: `${selected}_${interval}` })
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier: selected, interval, flow: 'onboarding' }),
    })
    if (!res.ok) {
      alert('Something went wrong starting checkout. Please try again.')
      setBusy(false)
      return
    }
    const { url } = (await res.json()) as { url?: string }
    if (url) window.location.href = url
    else { alert('Could not start checkout. Please try again.'); setBusy(false) }
  }

  const selectedPlan = PLANS.find((p) => p.tier === selected)!

  return (
    <div className="fl-card fl-plan">
      <div className="fl-plan-top">
        <div className="fl-tex" />
        <div className="fl-steps">
          <div className="fl-step done">
            <span className="num">{CHK}</span><span className="lbl">Account</span>
          </div>
          <span className="fl-step-sep done" />
          <div className="fl-step on">
            <span className="num">2</span><span className="lbl">Plan</span>
          </div>
          <span className="fl-step-sep" />
          <div className="fl-step">
            <span className="num">3</span><span className="lbl">Profile</span>
          </div>
        </div>

        <h1>Pick the plan that <span className="gr">matches your edge</span>.</h1>
        <p>Start free and upgrade anytime — or unlock advanced analytics, private journaling and premium tools from day one.</p>

        <div className="fl-billing">
          <div className="fl-bswitch" ref={switchRef}>
            <span className="fl-bthumb" style={{ left: thumb.left, width: thumb.width }} />
            <button type="button" ref={monthlyRef} className={`fl-bopt${interval === 'monthly' ? ' on' : ''}`} onClick={() => setInterval('monthly')}>Monthly</button>
            <button type="button" ref={annualRef} className={`fl-bopt${interval === 'annual' ? ' on' : ''}`} onClick={() => setInterval('annual')}>Annual</button>
          </div>
          <span className="fl-bsave">Beta — 80% off yearly</span>
        </div>
      </div>

      <div className="fl-plan-body">
        <div className="fl-pgrid">
          {PLANS.map((p) => {
            const pop = p.tier === 'trader'
            const on = p.tier === selected
            const amt = interval === 'monthly' ? p.monthly : p.annual
            const billed = interval === 'monthly' ? p.billedM : p.billedA
            return (
              <div
                key={p.tier}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                onClick={() => setSelected(p.tier)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(p.tier) } }}
                className={`fl-pcard${pop ? ' pop' : ''}${on ? ' on' : ''}`}
              >
                {pop && <span className="fl-pbadge">Most popular</span>}
                <span className="fl-pname"><span className={`fl-pip ${p.pip}`} />{p.name}</span>
                <span className="fl-ptag">{p.tag}</span>
                <div className="fl-pprice">
                  <span className="cur">$</span><span className="amt">{amt}</span><span className="per">/mo</span>
                </div>
                <div className="fl-pbilled">{billed}</div>
                <ul className="fl-pfeats">
                  <span className="fl-pfeats-lbl">{p.featsLabel}</span>
                  {p.feats.map((f, i) => (
                    <li key={i}>
                      <span className={f.lim ? 'lim' : 'chk'}>{f.lim ? LIM : CHK}</span>
                      <span>{f.t}</span>
                    </li>
                  ))}
                </ul>
                <div className="fl-psel">
                  <span className="dot">{CHK}</span>
                  {on ? 'Selected' : 'Select'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="fl-plan-foot">
        <button type="button" className="fl-plan-back" onClick={() => router.push('/onboarding')}>
          {BACK} Skip for now
        </button>
        <span className="fl-plan-note">{LOCK} Secure checkout · cancel anytime</span>
        <span className="sp" />
        <button type="button" className="fl-continue" onClick={onContinue} disabled={busy}>
          {busy
            ? 'Loading…'
            : selected === 'free'
              ? 'Continue with Free'
              : `Continue with ${selectedPlan.name}`}
          {ARROW}
        </button>
      </div>
    </div>
  )
}
