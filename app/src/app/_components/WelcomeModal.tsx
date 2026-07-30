'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import type { Tier } from '@/lib/entitlements'
import { WELCOME_TIERS, TRIAL_PRICE } from '@/lib/welcome-tiers'
import { ackWelcome } from '@/app/actions/welcome'
import { track } from '@/lib/track'

// The signup flow's own screens are wrapped by the root layout too. The server
// rule already requires onboarding_completed, so this is belt-and-braces.
const EXEMPT_PATHS = ['/onboarding', '/welcome']

const TOTAL = 6
const CONFETTI_COLORS = ['#3FB6E8', '#7C5CE6', '#C840BC', '#FF7A4D', '#ffffff']

/** Timings copied exactly from the mockup's inline script. */
const T_BADGE = 480
const T_EYEBROW = 780
const T_HEADLINE = 900
const T_SUB = 1040
const T_PRICE = 1160
const T_COUNTER = 1300
const SEG_EVERY = 260
const T_FEATS = T_COUNTER + TOTAL * SEG_EVERY + 100      // 2960
const FEAT_EVERY = 110
const T_FINISH = T_FEATS + TOTAL * FEAT_EVERY + 200      // 3820

type Phase = {
  badge: boolean; eyebrow: boolean; headline: boolean; sub: boolean
  price: boolean; segs: number; feats: number; finish: boolean
}

const START: Phase = {
  badge: false, eyebrow: false, headline: false, sub: false,
  price: false, segs: 0, feats: 0, finish: false,
}

export function WelcomeModal({
  tier, username, trialActive,
}: { tier: Tier; username: string | null; trialActive: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)
  const [gone, setGone] = useState(false)
  const [p, setP] = useState<Phase>(START)
  const cardRef = useRef<HTMLDivElement>(null)
  const acked = useRef(false)
  // The 300ms "closing" animation timeout, tracked outside the animation
  // effect below because close() can fire at any point in the modal's
  // lifetime (including after that effect's own timers have all fired and
  // its cleanup has already run). ackWelcome() triggers revalidatePath, which
  // can unmount this component before the 300ms elapses, so this handle must
  // be cleared on unmount independently.
  const closeTimeout = useRef(0)

  const copy = WELCOME_TIERS[tier]
  const exempt = EXEMPT_PATHS.some((x) => pathname?.startsWith(x))
  const open = mounted && !gone && !exempt

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    return () => { if (closeTimeout.current) window.clearTimeout(closeTimeout.current) }
  }, [])

  // Free's CTA needs the handle; fall back to settings rather than /undefined.
  const href = copy.href || (username ? `/${username}` : '/settings')

  // X / Maybe later / backdrop / Escape: none of these navigate, so an
  // optimistic fire-and-forget ack is safe — a failed write costs at most one
  // repeat showing, never a stuck modal.
  const close = (action: 'later' | 'close') => {
    if (acked.current) return
    acked.current = true
    track('welcome_popup_dismissed', { tier, action })
    // Best-effort write: nothing here awaits it, so an unhandled rejection
    // (rotated service key, network blip) would otherwise surface as an
    // unhandled promise rejection — which next dev's error overlay can turn
    // into a broken page. A failure here costs at most one repeat showing.
    void ackWelcome(tier).catch(() => {})
    setClosing(true)
    closeTimeout.current = window.setTimeout(() => setGone(true), 300)
  }

  // The CTA is different: it navigates. A plain <a href> click starts a real
  // document navigation as soon as this handler returns, and Next transports
  // server actions over a plain un-keepalive fetch() — which the browser
  // aborts the instant the initiating document unloads. Firing this the same
  // fire-and-forget way as close() above would silently drop
  // welcome_tier_seen on the most common dismissal path. So: prevent the
  // native navigation, close visually right away (no perceived delay), await
  // the ack (tolerating a rejection — the user must not get stuck on a failed
  // write), then navigate ourselves via the router.
  const handleCta = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (acked.current) return
    acked.current = true
    e.preventDefault()
    track('welcome_popup_dismissed', { tier, action: 'cta' })
    setGone(true)
    try {
      await ackWelcome(tier)
    } catch {
      // Navigation must proceed even if the write failed.
    }
    router.push(href)
  }

  // The mockup fires timeouts from a bare inline script: 5 reveal timeouts, 1
  // to start the counter interval, 6 (flattened from the mockup's nested
  // per-feature timeouts into absolute-time schedules) for the feature
  // cascade, and 1 for the finish state — 13 timeouts plus the 1 interval
  // they start. In React those outlive unmount and would write to detached
  // state, so every handle is tracked and cleared.
  useEffect(() => {
    if (!open) return
    track('welcome_popup_shown', { tier })

    const timeouts: number[] = []
    let interval = 0
    const at = (ms: number, fn: () => void) => { timeouts.push(window.setTimeout(fn, ms)) }

    at(T_BADGE, () => setP((s) => ({ ...s, badge: true })))
    at(T_EYEBROW, () => setP((s) => ({ ...s, eyebrow: true })))
    at(T_HEADLINE, () => setP((s) => ({ ...s, headline: true })))
    at(T_SUB, () => setP((s) => ({ ...s, sub: true })))
    at(T_PRICE, () => setP((s) => ({ ...s, price: true })))

    // The progress track fills one segment every 260ms, same as the mockup.
    at(T_COUNTER, () => {
      let n = 0
      interval = window.setInterval(() => {
        n += 1
        setP((s) => ({ ...s, segs: n }))
        if (n >= TOTAL) window.clearInterval(interval)
      }, SEG_EVERY)
    })

    for (let i = 0; i < TOTAL; i++) {
      at(T_FEATS + i * FEAT_EVERY, () => setP((s) => ({ ...s, feats: i + 1 })))
    }
    at(T_FINISH, () => setP((s) => ({ ...s, finish: true })))

    return () => {
      for (const t of timeouts) window.clearTimeout(t)
      if (interval) window.clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Escape closes this one (unlike the end-of-trial wall), and the page behind
  // it is locked while it is up.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cardRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close('close') }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const price = trialActive ? TRIAL_PRICE : copy.price

  return createPortal(
    <div
      className={'wpop-backdrop' + (closing ? ' closing' : '')}
      onClick={(e) => { if (e.target === e.currentTarget) close('close') }}
    >
      <div
        className="wpop-modal" role="dialog" aria-modal="true" aria-label={copy.aria}
        ref={cardRef} tabIndex={-1}
      >
        <div className="wpop-banner">
          <div className="wpop-banner-noise" />
          <div className="wpop-confetti">
            {p.finish && Array.from({ length: 26 }).map((_, i) => {
              const w = 5 + ((i * 7) % 4)
              return (
                <span key={i} style={{
                  width: w, height: w * 1.6,
                  left: `${(i * 3.85) % 100}%`,
                  background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                  animationDelay: `${((i * 13) % 50) / 100}s`,
                  animationDuration: `${1.2 + ((i * 17) % 80) / 100}s`,
                }} />
              )
            })}
          </div>

          <button className="wpop-close" aria-label="Close" onClick={() => close('close')}>
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>

          <div className={'wpop-badge-wrap' + (p.badge ? ' on' : '')}>
            <svg className="wpop-ring" viewBox="0 0 96 96">
              <circle className="track" cx="48" cy="48" r="48" style={{ r: 44 } as React.CSSProperties} />
              <circle className="fill" cx="48" cy="48" r="44" />
            </svg>
            <div className="wpop-badge">
              <svg viewBox="0 0 24 24" fill="none">{copy.icon}</svg>
            </div>
            <div className="wpop-burst">
              {p.badge && Array.from({ length: 14 }).map((_, i) => {
                const ang = (i / 14) * Math.PI * 2
                const dist = 40 + ((i * 11) % 30)
                return (
                  <i key={i} style={{
                    '--bx': `${Math.cos(ang) * dist}px`,
                    '--by': `${Math.sin(ang) * dist}px`,
                    animationDelay: `${((i * 11) % 15) / 100}s`,
                  } as React.CSSProperties} />
                )
              })}
            </div>
          </div>

          <span className={'wpop-eyebrow' + (p.eyebrow ? ' in' : '')}>
            <span className="dot" />{copy.eyebrow}
          </span>
          <h1 className={p.headline ? 'in' : undefined}>
            Welcome to<br /><em>{copy.em}</em>.
          </h1>
          <p className={'wpop-sub' + (p.sub ? ' in' : '')}>{copy.sub}</p>
          <span className={'wpop-price' + (p.price ? ' in' : '')}>{price}</span>
        </div>

        <div className="wpop-body">
          <div className="wpop-progress-card">
            <div className="wpop-progress-head">
              <span className="lbl">Unlocking your plan</span>
              <span className="val">{p.segs} / {TOTAL}</span>
            </div>
            <div className="wpop-track">
              {Array.from({ length: TOTAL }).map((_, i) => (
                <div key={i} className={'wpop-seg' + (i < p.segs ? ' filled' : '')}>
                  {i < p.segs && <i />}
                </div>
              ))}
            </div>
            <div className="wpop-track-caption">{TOTAL} features just unlocked</div>
          </div>

          <ul className="wpop-feats">
            {copy.feats.map((f, i) => (
              <li key={i} className={'wpop-feat' + (i < p.feats ? ' in' : '')} style={{ ['--i' as string]: i }}>
                <span className="wpop-fic">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <b>{f.t}</b>
                  <p>{f.d}</p>
                </div>
              </li>
            ))}
          </ul>

          <a
            className={'btn btn-primary wpop-cta' + (p.finish ? ' in' : '')}
            href={href}
            onClick={handleCta}
          >
            {copy.cta}
          </a>
          <span
            className={'wpop-secondary' + (p.finish ? ' in' : '')}
            role="button" tabIndex={0}
            onClick={() => close('later')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') close('later') }}
          >
            Maybe later
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
