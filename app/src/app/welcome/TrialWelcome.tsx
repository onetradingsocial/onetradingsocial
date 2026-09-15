'use client'

import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { TRIAL_DAYS } from '@/lib/entitlements'
import { PAID_PLANS, CUR, CURRENCY_NOTE, GST_NOTE } from '@/lib/plans'
import { trackMeta } from '@/app/_components/MetaPixel'

const CHK: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const ARROW: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)

const PRO = PAID_PLANS.find((p) => p.tier === 'pro')!

/**
 * The signup trial screen.
 *
 * ── WHAT CHANGED, AND THE ONE RULE THAT CONSTRAINS IT ───────────────────────
 *
 * This used to start the trial by doing nothing at all: the trial was two
 * timestamps on `profiles`, so the button just pushed to /onboarding. Now the
 * trial is a real Stripe subscription with a card behind it, so the button
 * opens Checkout and the trial begins when that completes.
 *
 * THE DECLINE ROUTE IS NOT OPTIONAL. Terms §7 says the Free plan is free
 * forever and that a user can use it indefinitely without ever paying us, and
 * two `for/` landing pages still say the Free plan needs no card. Both are only
 * true while someone can get past this screen WITHOUT entering one. So
 * "Continue on Free" is a load-bearing legal affordance, not a courtesy exit —
 * removing it silently falsifies the terms and the marketing site together.
 *
 * It is styled as the secondary action because the trial is what we want people
 * to take, but it is a real button with a real label, not a greyed-out link.
 *
 * ── WHAT THIS SCREEN HAS TO SAY ─────────────────────────────────────────────
 *
 * The card is the surprise, so it is disclosed before the button rather than
 * under it: what is taken today (nothing), what is charged and when, and that
 * cancelling first costs nothing. Those are the same four facts terms §8 and
 * the day-11 email carry, and they must not disagree with either.
 */
export function TrialWelcome() {
  const router = useRouter()
  const [busy, setBusy] = useState<'trial' | 'free' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startTrial = async () => {
    setBusy('trial'); setError(null)
    trackMeta('InitiateCheckout', { content_name: `trial_${PRO.tier}_monthly` })
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // No tier or interval: the server prices this flow, so the plan cannot
        // be chosen from here. See api/billing/checkout.
        body: JSON.stringify({ flow: 'trial' }),
      })
      const { url } = (await res.json().catch(() => ({}))) as { url?: string }
      // Stay busy on success — we are navigating to Stripe, and re-enabling the
      // button would only invite a second session.
      if (res.ok && url) { window.location.href = url; return }
      setError('Could not start your trial. Please try again, or continue on Free.')
    } catch {
      setError('Could not start your trial. Please try again, or continue on Free.')
    }
    setBusy(null)
  }

  return (
    <div className="fl-card fl-plan">
      <div className="fl-plan-top">
        <div className="fl-tex" />
        <div className="fl-steps">
          <div className="fl-step done"><span className="num">{CHK}</span><span className="lbl">Account</span></div>
          <span className="fl-step-sep done" />
          <div className="fl-step on"><span className="num">2</span><span className="lbl">Trial</span></div>
          <span className="fl-step-sep" />
          <div className="fl-step"><span className="num">3</span><span className="lbl">Profile</span></div>
        </div>

        <h1>{TRIAL_DAYS} days of <span className="gr">Pro, free</span>.</h1>
        <p>
          Every tool we make, unlocked from day one. We take a card to start it,
          but <b>{CUR}0 today</b> — and if you cancel before day {TRIAL_DAYS} you
          are not charged at all.
        </p>
      </div>

      <div className="fl-plan-body">
        <ul className="fl-pfeats fl-trial-feats">
          <span className="fl-pfeats-lbl">{PRO.name} includes</span>
          {PRO.feats.map((f, i) => (
            <li key={i}><span className="chk">{CHK}</span><span>{f.t}</span></li>
          ))}
        </ul>

        {/* The four facts, before the button rather than under it. Same four
            terms §8 and the day-11 email carry; they must not disagree. */}
        <p className="fl-plan-terms">
          After {TRIAL_DAYS} days, {PRO.name} continues at <b>{CUR}{PRO.monthly}/month</b> unless
          you cancel in Settings → Billing. We email you before that happens.
          {' '}{CURRENCY_NOTE} {GST_NOTE}
        </p>
      </div>

      <div className="fl-plan-foot">
        {/* Load-bearing: see the note at the top of this file. */}
        <button
          type="button"
          className="fl-plan-decline"
          disabled={busy !== null}
          onClick={() => { setBusy('free'); router.push('/onboarding') }}
        >
          {busy === 'free' ? 'Loading…' : 'Continue on Free'}
        </button>
        <span className="sp" />
        <button
          type="button"
          className="fl-continue"
          disabled={busy !== null}
          onClick={startTrial}
        >
          {busy === 'trial' ? 'Starting…' : `Start my ${TRIAL_DAYS}-day trial`}
          {ARROW}
        </button>
      </div>

      {error && <p className="fl-plan-error" role="alert">{error}</p>}
    </div>
  )
}
