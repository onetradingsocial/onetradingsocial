'use client'

import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { TRIAL_DAYS } from '@/lib/entitlements'
import { PAID_PLANS } from '@/lib/plans'

const CHK: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
const ARROW: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)

const PRO = PAID_PLANS.find((p) => p.tier === 'pro')!

export function TrialWelcome() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

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

        <h1>Your {TRIAL_DAYS} days of <span className="gr">Pro start now</span>.</h1>
        <p>Every tool we make, unlocked from day one. No card, no charge — decide what you want to keep at the end.</p>
      </div>

      <div className="fl-plan-body">
        <ul className="fl-pfeats fl-trial-feats">
          <span className="fl-pfeats-lbl">{PRO.name} includes</span>
          {PRO.feats.map((f, i) => (
            <li key={i}><span className="chk">{CHK}</span><span>{f.t}</span></li>
          ))}
        </ul>
      </div>

      <div className="fl-plan-foot">
        <span className="fl-plan-note">No card required · nothing to cancel</span>
        <span className="sp" />
        <button
          type="button"
          className="fl-continue"
          disabled={busy}
          onClick={() => { setBusy(true); router.push('/onboarding') }}
        >
          {busy ? 'Loading…' : 'Start my trial'}
          {ARROW}
        </button>
      </div>
    </div>
  )
}
